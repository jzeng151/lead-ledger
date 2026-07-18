import { and, eq, lt, ne, or } from "drizzle-orm";

import { db, schema } from "@/db";
import { applyWriteback } from "@/lib/hubspot/writeback";
import { activeRunForContact } from "@/lib/runs";
import { rejectCrossSite } from "@/lib/sameOrigin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const { scores, runs, writebacks } = schema;

// How long a claimed write stays claimed before another request may take it over.
const WRITE_CLAIM_MS = 2 * 60 * 1000;

type LatestScore = {
  priority: number;
  grade: string;
  rationale: string | null;
  nextStep: string | null;
  needsReview: boolean;
};

/**
 * The contact's current verdict: the score whose run started most recently,
 * matching the queue and detail routes. startedAt is stored at second
 * resolution, so a fast re-run can tie with the score it replaces; runId carries
 * the millisecond stamp and breaks the tie the right way.
 *
 * Read fresh each time it is needed: a re-run or a settings save can land while
 * a HubSpot call is in flight.
 */
function latestScoreForContact(contactId: string): LatestScore | null {
  const rows = db
    .select({
      runId: scores.runId,
      priority: scores.priority,
      grade: scores.grade,
      rationale: scores.rationale,
      nextStep: scores.nextStep,
      needsReview: scores.needsReview,
      startedAt: runs.startedAt,
    })
    .from(scores)
    .innerJoin(runs, eq(scores.runId, runs.id))
    .where(eq(scores.contactId, contactId))
    .all();

  let best: LatestScore | null = null;
  let bestAt = -Infinity;
  let bestRunId = "";
  for (const s of rows) {
    const t = s.startedAt ? s.startedAt.getTime() : 0;
    if (t > bestAt || (t === bestAt && s.runId > bestRunId)) {
      bestAt = t;
      bestRunId = s.runId;
      const { startedAt: _startedAt, runId: _runId, ...rest } = s;
      best = rest;
    }
  }
  return best;
}

export async function POST(req: Request, { params }: { params: Promise<{ contactId: string }> }) {
  const { contactId } = await params;

  const crossSite = rejectCrossSite(req);
  if (crossSite) return crossSite;

  try {
    const body = (await req.json().catch(() => ({}))) as { batch?: boolean; skip?: boolean };

    // Persist a skip, so the decision survives a refresh and the contact stops
    // being offered as pending work in the queue and batch approval.
    if (body.skip === true) {
      // Same conflict as approval: the finishing run upserts this row back to
      // pending, so a skip recorded against the old score would silently vanish.
      if (activeRunForContact(contactId))
        return Response.json({ error: "scoring in progress, try again when the run finishes" }, { status: 409 });
      const now = new Date();
      db.insert(writebacks)
        .values({ contactId, status: "skipped", payload: null, approvedAt: now })
        .onConflictDoUpdate({ target: writebacks.contactId, set: { status: "skipped", approvedAt: now, writtenAt: null } })
        .run();
      return Response.json({ status: "skipped" });
    }

    const score = latestScoreForContact(contactId);
    if (!score) return Response.json({ error: "not scored" }, { status: 400 });

    // A re-run in flight has no score row yet, so the lookup above returns the
    // previous run's verdict. Writing it would push a priority and note that the
    // rescore is about to replace. Make the caller wait instead.
    if (activeRunForContact(contactId))
      return Response.json({ error: "scoring in progress, try again when the run finishes" }, { status: 409 });

    // Batch approval skips needs-review leads; individual approval is always allowed.
    if (body.batch === true && score.needsReview) {
      return Response.json({ error: "needs manual review" }, { status: 409 });
    }

    const prior = db.select().from(writebacks).where(eq(writebacks.contactId, contactId)).get();

    // A batch approval can be launched from a tab whose row list predates a skip
    // made elsewhere. Skip is an explicit human decision, so the batch must not
    // quietly overwrite it; an individual approve still can, since the rep is
    // looking at that contact.
    if (body.batch === true && prior?.status === "skipped")
      return Response.json({ error: "skipped by a human" }, { status: 409 });

    // Idempotency: if this exact score was already written, return the prior
    // result instead of posting a second HubSpot note for the same verdict. A
    // re-run that changes the score is still allowed through.
    const priorPayload = prior?.payload as { properties?: { lead_priority_score?: number; lead_grade?: string } } | null;
    if (
      prior?.status === "written" &&
      priorPayload?.properties?.lead_priority_score === score.priority &&
      priorPayload?.properties?.lead_grade === score.grade
    ) {
      return Response.json({ status: "written", payload: priorPayload, dryRun: false, alreadyWritten: true });
    }

    // Claim the row before the HubSpot call. Two approvals for the same contact
    // (two tabs, a double submit) both read this row as pending and both reach
    // the write, posting duplicate timeline notes for one score. The conditional
    // update is the claim: only one request can win it. A claim older than the
    // window is reclaimable, so a process that dies mid-write does not leave the
    // contact permanently unapprovable.
    if (prior) {
      const reclaimable = new Date(Date.now() - WRITE_CLAIM_MS);
      const claimed = db
        .update(writebacks)
        .set({ status: "writing", approvedAt: new Date() })
        .where(
          and(
            eq(writebacks.contactId, contactId),
            or(ne(writebacks.status, "writing"), lt(writebacks.approvedAt, reclaimable)),
          ),
        )
        .run();
      if (claimed.changes === 0) return Response.json({ error: "a write is already in progress" }, { status: 409 });
    }

    try {
      const r = await applyWriteback(contactId, score);

      // A settings save can land while the HubSpot call is in flight. rescoreAll
      // leaves a claimed row alone, so reconcile here: if the score moved while
      // we were writing, HubSpot now holds the old numbers, and the row must go
      // back to pending rather than claim the contact is synced.
      // Compare the review flag too, not just the numbers: a save that only moves
      // the review band leaves the priority alone but newly flags the lead, and
      // "written" outranks needsReview in the queue, so recording this approval
      // would hide it as synced.
      const newest = latestScoreForContact(contactId);
      // The note counts as part of the verdict: a re-run can land the same
      // numbers with a different rationale, and HubSpot would then hold the old
      // note while the queue called the contact synced.
      const moved =
        newest &&
        (newest.priority !== score.priority ||
          newest.grade !== score.grade ||
          Boolean(newest.needsReview) !== Boolean(score.needsReview) ||
          newest.rationale !== score.rationale ||
          newest.nextStep !== score.nextStep);
      if (newest && moved) {
        db.update(writebacks)
          .set({
            status: "pending",
            // Stage the current verdict, not the one just sent: a re-run may have
            // finished while this call was out.
            payload: {
              properties: { lead_priority_score: newest.priority, lead_grade: newest.grade },
              note: newest.rationale ?? "",
            },
            approvedAt: null,
            writtenAt: null,
          })
          .where(eq(writebacks.contactId, contactId))
          .run();
        return Response.json({ ...r, restaged: true });
      }
      return Response.json({ ...r });
    } catch (e) {
      // Put the row back the way it was so a failed write does not strand it.
      if (prior)
        db.update(writebacks)
          .set({ status: prior.status, approvedAt: prior.approvedAt })
          .where(eq(writebacks.contactId, contactId))
          .run();
      throw e;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
