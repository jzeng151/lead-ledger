import { and, eq, lt, ne, or } from "drizzle-orm";

import { db, schema } from "@/db";
import { applyWriteback } from "@/lib/hubspot/writeback";
import { activeRunForContact } from "@/lib/runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const { scores, runs, writebacks } = schema;

// How long a claimed write stays claimed before another request may take it over.
const WRITE_CLAIM_MS = 2 * 60 * 1000;

export async function POST(req: Request, { params }: { params: Promise<{ contactId: string }> }) {
  const { contactId } = await params;

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

    // Latest score for this contact = the score whose run started most recently,
    // matching the list/detail routes' "latest" rule.
    const scoreRows = db
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

    let score:
      | { priority: number; grade: string; rationale: string | null; nextStep: string | null; needsReview: boolean }
      | null = null;
    let latestStartedAt = -Infinity;
    let latestRunId = "";
    for (const s of scoreRows) {
      const t = s.startedAt ? s.startedAt.getTime() : 0;
      // startedAt is stored at second resolution, so a fast re-run can tie with
      // the score it replaces and leave the winner down to row order. runId
      // carries the millisecond stamp, which breaks the tie the right way; without
      // it an approval right after a re-run could send the previous verdict.
      if (t > latestStartedAt || (t === latestStartedAt && s.runId > latestRunId)) {
        latestStartedAt = t;
        latestRunId = s.runId;
        const { startedAt: _startedAt, runId: _runId, ...rest } = s;
        score = rest;
      }
    }

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
      const current = db.select().from(scores).where(eq(scores.runId, latestRunId)).get();
      if (current && (current.priority !== score.priority || current.grade !== score.grade)) {
        db.update(writebacks)
          .set({ status: "pending", approvedAt: null, writtenAt: null })
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
