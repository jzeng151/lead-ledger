import { eq } from "drizzle-orm";

import { db, schema } from "@/db";
import { buildQueue } from "@/lib/queueModel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const { contacts, scores, runs, writebacks } = schema;

export async function GET() {
  const contactRows = db.select().from(contacts).all();

  // Latest score per contact = the score whose run started most recently. A
  // contact can be re-scored, producing multiple (runId, contactId) score rows;
  // join to `runs` for each run's startedAt and keep the newest per contact.
  const scoreRows = db
    .select({
      contactId: scores.contactId,
      fit: scores.fit,
      priority: scores.priority,
      grade: scores.grade,
      needsReview: scores.needsReview,
      startedAt: runs.startedAt,
    })
    .from(scores)
    .innerJoin(runs, eq(scores.runId, runs.id))
    .all();

  const latestScoreByContact: Record<
    string,
    { fit: number; priority: number; grade: string; needsReview: boolean } | undefined
  > = {};
  const latestStartedAt: Record<string, number> = {};
  for (const s of scoreRows) {
    const t = s.startedAt ? s.startedAt.getTime() : 0;
    if (latestStartedAt[s.contactId] === undefined || t >= latestStartedAt[s.contactId]) {
      latestStartedAt[s.contactId] = t;
      latestScoreByContact[s.contactId] = {
        fit: s.fit,
        priority: s.priority,
        grade: s.grade,
        needsReview: s.needsReview,
      };
    }
  }

  const writebackByContact: Record<string, { status: string } | undefined> = {};
  for (const w of db.select().from(writebacks).all()) {
    writebackByContact[w.contactId] = { status: w.status };
  }

  const queue = buildQueue(
    contactRows.map((c) => ({ id: c.id, name: c.name, companyName: c.companyName })),
    latestScoreByContact,
    writebackByContact,
  );
  return Response.json(queue);
}
