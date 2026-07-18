import { db, schema } from "@/db";
import { eq, asc, and, gt } from "drizzle-orm";
import { getBus } from "@/lib/runStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: runId } = await params;
  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      let closed = false;
      const close = () => { if (!closed) { closed = true; try { controller.close(); } catch {} } };
      // Never let a write failure escape. send() runs inside the RunBus listener,
      // which runs inside bus.emit() inside runContact, so a viewer closing the
      // page mid-run would throw all the way back and mark a healthy scoring run
      // as failed. A dead client just ends this subscription.
      const send = (e: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
        } catch {
          close();
        }
      };

      // 1. replay persisted history
      const rows = db.select().from(schema.runEvents).where(eq(schema.runEvents.runId, runId)).orderBy(asc(schema.runEvents.id)).all();
      for (const r of rows) send({ agent: r.agent, type: r.type, payload: r.payload });
      let lastId = rows.length ? rows[rows.length - 1].id : 0;

      // 2. attach to live bus, or end if the run is done. A finished run keeps its
      // bus alive for a 30s tail; subscribing to that idle bus would hang forever
      // since the terminal event already fired, so end on a terminal status too.
      const runRow = db.select().from(schema.runs).where(eq(schema.runs.id, runId)).get();
      const terminal = runRow?.status === "scored" || runRow?.status === "error";
      const bus = getBus(runId);
      if (terminal) { send({ type: "stream_end" }); close(); return; }
      if (!bus) {
        // The row says running but nothing is driving it: the process that owned
        // this run is gone (a restart, a killed background task). stream_end alone
        // reads as a successful finish in the live view, which would show the
        // contact as done with no score and no failure.
        send({
          agent: "orchestrator",
          type: "agent_error",
          payload: { message: "this run is no longer being processed; start a new one" },
        });
        send({ type: "stream_end" });
        close();
        return;
      }
      const handler = (e: { type: string }) => {
        send(e);
        if (e.type === "run_completed" || e.type === "agent_error") { bus.off(handler); stopWatch(); setTimeout(close, 50); }
      };
      bus.on(handler);

      // Anything persisted between the replay query and this subscription reached
      // neither: not the replay, not the handler. Flush that gap now. emit()
      // persists before it notifies, and nothing can run between bus.on and this
      // query in the same tick, so this cannot deliver an event twice.
      const gap = db
        .select()
        .from(schema.runEvents)
        .where(and(eq(schema.runEvents.runId, runId), gt(schema.runEvents.id, lastId)))
        .orderBy(asc(schema.runEvents.id))
        .all();
      for (const r of gap) send({ agent: r.agent, type: r.type, payload: r.payload });
      if (gap.length) lastId = gap[gap.length - 1].id;

      // A run can finish between the status read above and this subscription. The
      // terminal event is then neither replayed nor observed, and the connection
      // hangs with the live view stuck on "running". Poll the run row: if it has
      // finished without this handler seeing the end, flush whatever was
      // persisted after the replay and close. The handler only misses events when
      // it attached late, so this cannot double-send.
      const watch = setInterval(() => {
        if (closed) return stopWatch();
        const row = db.select().from(schema.runs).where(eq(schema.runs.id, runId)).get();
        if (row?.status !== "scored" && row?.status !== "error") return;
        const missed = db
          .select()
          .from(schema.runEvents)
          .where(and(eq(schema.runEvents.runId, runId), gt(schema.runEvents.id, lastId)))
          .orderBy(asc(schema.runEvents.id))
          .all();
        for (const r of missed) send({ agent: r.agent, type: r.type, payload: r.payload });
        if (missed.length) lastId = missed[missed.length - 1].id;
        bus.off(handler);
        stopWatch();
        send({ type: "stream_end" });
        close();
      }, 2000);
      (watch as unknown as { unref?: () => void }).unref?.();
      function stopWatch() {
        clearInterval(watch);
      }

      req.signal?.addEventListener?.("abort", () => { bus.off(handler); stopWatch(); close(); });
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
  });
}
