import { eq } from "drizzle-orm";

import { db, schema } from "@/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const { contacts, scores, runs, writebacks } = schema;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const contact = db.select().from(contacts).where(eq(contacts.id, id)).get();
  if (!contact) {
    return Response.json({ error: "contact not found" }, { status: 404 });
  }

  // Latest score for this contact = the score whose run started most recently.
  // A re-run adds another (runId, contactId) score row; join to `runs` for each
  // run's startedAt and keep the newest, matching the list route's "latest" rule.
  const scoreRows = db
    .select({
      runId: scores.runId,
      fit: scores.fit,
      engagement: scores.engagement,
      timing: scores.timing,
      priority: scores.priority,
      grade: scores.grade,
      needsReview: scores.needsReview,
      reviewReasons: scores.reviewReasons,
      rationale: scores.rationale,
      nextStep: scores.nextStep,
      citations: scores.citations,
      startedAt: runs.startedAt,
    })
    .from(scores)
    .innerJoin(runs, eq(scores.runId, runs.id))
    .where(eq(scores.contactId, id))
    .all();

  let score: Omit<(typeof scoreRows)[number], "startedAt" | "runId"> | null = null;
  let latestStartedAt = -Infinity;
  let latestScoredRunId = "";
  for (const s of scoreRows) {
    const t = s.startedAt ? s.startedAt.getTime() : 0;
    // startedAt is second-resolution; runId carries the millisecond stamp, so it
    // breaks a tie between a fast re-run and the score it replaces.
    if (t > latestStartedAt || (t === latestStartedAt && s.runId > latestScoredRunId)) {
      latestStartedAt = t;
      latestScoredRunId = s.runId;
      const { startedAt: _startedAt, runId: _runId, ...rest } = s;
      score = rest;
    }
  }

  // The newest run row, scored or not. Deriving this from the scored row instead
  // would pin the detail page to the last successful run: a re-run still in
  // flight, or one that errored before writing a score, would replay the older
  // completed trace and hide what is actually happening.
  let latestRunId: string | null = null;
  let newest = -Infinity;
  for (const r of db.select({ id: runs.id, startedAt: runs.startedAt }).from(runs).where(eq(runs.contactId, id)).all()) {
    const t = r.startedAt ? r.startedAt.getTime() : 0;
    // Same second-resolution tie-break as the score selection above, or the page
    // can replay the previous run's trace instead of the one now in flight.
    if (t > newest || (t === newest && r.id > (latestRunId ?? ""))) {
      newest = t;
      latestRunId = r.id;
    }
  }

  // The persisted approve/skip decision, so the panel can rehydrate it instead of
  // offering the buttons again after a refresh.
  const wb = db.select({ status: writebacks.status }).from(writebacks).where(eq(writebacks.contactId, id)).get();

  return Response.json({ contact, score, latestRunId, writebackStatus: wb?.status ?? null });
}
