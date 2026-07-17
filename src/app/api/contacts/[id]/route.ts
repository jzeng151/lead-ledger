import { eq } from "drizzle-orm";

import { db, schema } from "@/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const { contacts, scores, runs } = schema;

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
      fit: scores.fit,
      engagement: scores.engagement,
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

  let score: Omit<(typeof scoreRows)[number], "startedAt"> | null = null;
  let latestStartedAt = -Infinity;
  for (const s of scoreRows) {
    const t = s.startedAt ? s.startedAt.getTime() : 0;
    if (t >= latestStartedAt) {
      latestStartedAt = t;
      const { startedAt: _startedAt, ...rest } = s;
      score = rest;
    }
  }

  return Response.json({ contact, score });
}
