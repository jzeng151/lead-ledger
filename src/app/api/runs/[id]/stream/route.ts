import { db, schema } from "@/db";
import { eq, asc } from "drizzle-orm";
import { getBus } from "@/lib/runStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: runId } = await params;
  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      let closed = false;
      const send = (e: unknown) => { if (!closed) controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`)); };
      const close = () => { if (!closed) { closed = true; try { controller.close(); } catch {} } };

      // 1. replay persisted history
      const rows = db.select().from(schema.runEvents).where(eq(schema.runEvents.runId, runId)).orderBy(asc(schema.runEvents.id)).all();
      for (const r of rows) send({ agent: r.agent, type: r.type, payload: r.payload });

      // 2. attach to live bus, or end if the run is done. A finished run keeps its
      // bus alive for a 30s tail; subscribing to that idle bus would hang forever
      // since the terminal event already fired, so end on a terminal status too.
      const runRow = db.select().from(schema.runs).where(eq(schema.runs.id, runId)).get();
      const terminal = runRow?.status === "scored" || runRow?.status === "error";
      const bus = getBus(runId);
      if (terminal || !bus) { send({ type: "stream_end" }); close(); return; }
      const handler = (e: { type: string }) => {
        send(e);
        if (e.type === "run_completed" || e.type === "agent_error") { bus.off(handler); setTimeout(close, 50); }
      };
      bus.on(handler);
      req.signal?.addEventListener?.("abort", () => { bus.off(handler); close(); });
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
  });
}
