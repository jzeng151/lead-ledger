import { eq } from "drizzle-orm";

import { db, schema } from "@/db";
import { onActivity, offActivity } from "@/lib/runStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Count in-flight scoring runs, ignoring any stuck "running" run older than 10
// minutes (its process died mid-run) so a crash can't pin the dashboard.
function runningCount(): number {
  const cutoff = Date.now() - 10 * 60 * 1000;
  return db
    .select({ startedAt: schema.runs.startedAt })
    .from(schema.runs)
    .where(eq(schema.runs.status, "running"))
    .all()
    .filter((r) => (r.startedAt?.getTime() ?? 0) > cutoff).length;
}

// Server-sent stream the dashboard subscribes to. Emits the current running count
// on connect and on every run lifecycle transition (start/score/error), pushed
// via the activity hub, so the queue updates reactively without polling.
export async function GET(req: Request) {
  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      let closed = false;
      const send = () => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(`data: ${JSON.stringify({ running: runningCount() })}\n\n`));
        } catch {
          /* controller closed */
        }
      };
      const handler = () => send();
      onActivity(handler);
      send(); // initial snapshot

      const close = () => {
        if (closed) return;
        closed = true;
        offActivity(handler);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      req.signal?.addEventListener?.("abort", close);
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
  });
}
