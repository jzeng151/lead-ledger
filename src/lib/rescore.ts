import { eq } from "drizzle-orm";

import { db, schema } from "../db";
import { score } from "./scoring";
import type { IcpConfig } from "./icp";

const { dossiers, scores, writebacks, runs } = schema;

type WritebackPayload = { properties?: { lead_priority_score?: number; lead_grade?: string }; note?: string };

/**
 * Keep the staged write-back in step with a re-scored contact.
 *
 * A pending payload is refreshed in place, so approving after a settings change
 * writes the current numbers rather than the ones computed under the old dials.
 * A contact that was already written is reopened as pending when its values
 * moved, because HubSpot still holds the old priority and grade and the queue
 * would otherwise treat it as synced and hide approval. A skip is left alone:
 * that is a human decision, not a stale score.
 */
function syncWriteback(contactId: string, priority: number, grade: string, needsReview: boolean) {
  const wb = db.select().from(writebacks).where(eq(writebacks.contactId, contactId)).get();
  if (!wb || wb.status === "skipped") return;

  const prior = (wb.payload ?? {}) as WritebackPayload;
  const sameValues = prior.properties?.lead_priority_score === priority && prior.properties?.lead_grade === grade;
  // A written contact that now needs review has to be reopened even when its
  // numbers did not move: the queue gives "written" precedence over needsReview,
  // so it would otherwise stay hidden from the Needs review tab with the panel
  // still showing Written.
  if (sameValues && !(wb.status === "written" && needsReview)) return;

  const payload: WritebackPayload = { properties: { lead_priority_score: priority, lead_grade: grade }, note: prior.note ?? "" };
  db.update(writebacks)
    .set({ status: "pending", payload, approvedAt: null, writtenAt: null })
    .where(eq(writebacks.contactId, contactId))
    .run();
}

/**
 * Recompute one run's score from its persisted dossier. Every input score() needs
 * (the ICP-fit axes, engagement, news triggers, verification verdicts) was stored
 * at run time, so a settings change can be re-scored deterministically with no
 * agent calls and no API spend.
 */
export function scoreFromDossier(
  d: { perAgent: unknown; verification: unknown; merged: unknown },
  icp: IcpConfig,
) {
  const partials = (d.perAgent ?? {}) as any;
  const merged = (d.merged ?? {}) as any;
  const v = (d.verification ?? {}) as any;
  const claims: any[] = v.claims ?? [];
  return score(
    {
      icpFit: merged.icpFit ?? {},
      engagement: partials.engagement,
      news: partials.news,
      verification: {
        contradictions: v.contradictions ?? [],
        unsupported: claims.filter((c) => c.verdict === "unsupported").length,
      },
      identityUnverified: partials.contact?.identityUnverified,
    },
    icp,
  );
}

/**
 * Re-score every stored run against `icp` and update its score row, so changing
 * the scoring dials does not leave the queue serving verdicts computed under the
 * old weights until each contact is manually re-run. Returns how many rows moved.
 *
 * Gate-derived review reasons (citations stripped from a rationale) are carried
 * over from the existing row: they come from the synthesis pass, not from score(),
 * so recomputing alone would silently drop that warning.
 */
export function rescoreAll(icp: IcpConfig): number {
  // When a contact has several runs, only its newest one may drive the staged
  // write-back; an older run's re-scored values must not overwrite it.
  const startedAt = new Map(
    db.select({ id: runs.id, startedAt: runs.startedAt }).from(runs).all().map((r) => [r.id, r.startedAt?.getTime() ?? 0]),
  );
  const newest = new Map<string, { at: number; priority: number; grade: string; needsReview: boolean }>();

  let updated = 0;
  for (const d of db.select().from(dossiers).all()) {
    const existing = db.select().from(scores).where(eq(scores.runId, d.runId)).get();
    if (!existing) continue;

    const s = scoreFromDossier(d, icp);
    // Reasons the scorer cannot recompute: both come from the synthesis and
    // citation-gate stage, so dropping them here would quietly clear needsReview
    // and make an unfiltered rationale batch-approvable after a settings edit.
    const carried = ((existing.reviewReasons as string[] | null) ?? []).filter(
      (r) => r.startsWith("unverified claims in rationale") || r.startsWith("unmatched verification claim"),
    );
    const reviewReasons = [...s.reviewReasons, ...carried];

    db.update(scores)
      .set({
        fit: s.fit,
        engagement: s.engagement,
        timing: s.timing,
        priority: s.priority,
        grade: s.grade,
        needsReview: reviewReasons.length > 0,
        reviewReasons,
      })
      .where(eq(scores.runId, d.runId))
      .run();

    const at = startedAt.get(d.runId) ?? 0;
    const seen = newest.get(existing.contactId);
    if (!seen || at >= seen.at)
      newest.set(existing.contactId, { at, priority: s.priority, grade: s.grade, needsReview: reviewReasons.length > 0 });
    updated++;
  }

  for (const [contactId, v] of newest) syncWriteback(contactId, v.priority, v.grade, v.needsReview);
  return updated;
}
