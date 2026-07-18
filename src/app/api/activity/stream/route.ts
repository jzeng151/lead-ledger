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
      let heartbeat: ReturnType<typeof setInterval> | undefined;

      // A function declaration, and defined before send(): the initial snapshot
      // below can fail on an already-gone client, and a const arrow would still
      // be in its temporal dead zone at that point.
      function close() {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        offActivity(handler);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }

      const send = () => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(`data: ${JSON.stringify({ running: activeRuns().length })}\n\n`));
        } catch {
          // The tab is gone and the abort listener has not fired yet. Tear down
          // here too, or every such disconnect leaves a listener and a 30s timer
          // behind, querying activeRuns() for a client that no longer exists.
          close();
        }
      };
      const handler = () => send();
      onActivity(handler);
      send(); // initial snapshot

      // A crashed run emits no lifecycle notification when its row merely ages
      // past the stale cutoff, so an open dashboard would keep the last nonzero
      // count and leave Sync disabled until a reload. Re-send periodically so the
      // count drops on its own.
      heartbeat = setInterval(send, 30_000);
      (heartbeat as unknown as { unref?: () => void }).unref?.();

      req.signal?.addEventListener?.("abort", close);
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
  });
}
