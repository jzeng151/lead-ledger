import { eq } from "drizzle-orm";

import { db, schema } from "../db";
import { score } from "./scoring";
import type { IcpConfig } from "./icp";

const { dossiers, scores } = schema;

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
  let updated = 0;
  for (const d of db.select().from(dossiers).all()) {
    const existing = db.select().from(scores).where(eq(scores.runId, d.runId)).get();
    if (!existing) continue;

    const s = scoreFromDossier(d, icp);
    const carried = ((existing.reviewReasons as string[] | null) ?? []).filter((r) =>
      r.startsWith("unverified claims in rationale"),
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
    updated++;
  }
  return updated;
}
