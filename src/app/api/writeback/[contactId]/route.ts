import { eq } from "drizzle-orm";

import { db, schema } from "@/db";
import { applyWriteback } from "@/lib/hubspot/writeback";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const { scores, runs } = schema;

export async function POST(req: Request, { params }: { params: Promise<{ contactId: string }> }) {
  const { contactId } = await params;

  try {
    const body = (await req.json().catch(() => ({}))) as { batch?: boolean };

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

    // Batch approval skips needs-review leads; individual approval is always allowed.
    if (body.batch === true && score.needsReview) {
      return Response.json({ error: "needs manual review" }, { status: 409 });
    }

    const r = await applyWriteback(contactId, score);
    return Response.json({ ...r });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
