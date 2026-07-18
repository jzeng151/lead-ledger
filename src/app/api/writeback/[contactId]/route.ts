import { eq } from "drizzle-orm";

import { db, schema } from "@/db";
import { applyWriteback } from "@/lib/hubspot/writeback";
import { activeRunForContact } from "@/lib/runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const { scores, runs, writebacks } = schema;

export async function POST(req: Request, { params }: { params: Promise<{ contactId: string }> }) {
  const { contactId } = await params;

  try {
    const body = (await req.json().catch(() => ({}))) as { batch?: boolean; skip?: boolean };

    // Persist a skip, so the decision survives a refresh and the contact stops
    // being offered as pending work in the queue and batch approval.
    if (body.skip === true) {
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
    for (const s of scoreRows) {
      const t = s.startedAt ? s.startedAt.getTime() : 0;
      if (t >= latestStartedAt) {
        latestStartedAt = t;
        const { startedAt: _startedAt, ...rest } = s;
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

    // Idempotency: if this exact score was already written, return the prior
    // result instead of posting a second HubSpot note for the same verdict. A
    // re-run that changes the score is still allowed through.
    const prior = db.select().from(writebacks).where(eq(writebacks.contactId, contactId)).get();
    const priorPayload = prior?.payload as { properties?: { lead_priority_score?: number; lead_grade?: string } } | null;
    if (
      prior?.status === "written" &&
      priorPayload?.properties?.lead_priority_score === score.priority &&
      priorPayload?.properties?.lead_grade === score.grade
    ) {
      return Response.json({ status: "written", payload: priorPayload, dryRun: false, alreadyWritten: true });
    }

    const r = await applyWriteback(contactId, score);
    return Response.json({ ...r });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
