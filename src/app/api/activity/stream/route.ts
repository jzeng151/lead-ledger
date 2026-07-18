import { onActivity, offActivity } from "@/lib/runStore";
import { activeRuns } from "@/lib/runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
          controller.enqueue(enc.encode(`data: ${JSON.stringify({ running: activeRuns().length })}\n\n`));
        } catch {
          /* controller closed */
        }
      };
      const handler = () => send();
      onActivity(handler);
      send(); // initial snapshot

      // A crashed run emits no lifecycle notification when its row merely ages
      // past the stale cutoff, so an open dashboard would keep the last nonzero
      // count and leave Sync disabled until a reload. Re-send periodically so the
      // count drops on its own.
      const heartbeat = setInterval(send, 30_000);
      (heartbeat as unknown as { unref?: () => void }).unref?.();

      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
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
