"use client";

import { useEffect, useRef } from "react";
import { traceLines, type LiveEvent, type TraceKind } from "@/lib/liveViewModel";

// info grey / tool amber / done green / error red.
const KIND_COLOR: Record<TraceKind, string> = {
  info: "text-zinc-400",
  tool: "text-amber-400",
  done: "text-green-400",
  error: "text-red-400",
};

export function RunTrace({ events }: { events: LiveEvent[] }) {
  const lines = traceLines(events);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll the scrollback to the newest line.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length]);

  return (
    <div ref={scrollRef} className="h-96 overflow-y-auto bg-black px-4 py-3 font-mono text-xs leading-relaxed">
      {lines.length === 0 ? (
        <div className="text-zinc-600">waiting for the run to start...</div>
      ) : (
        lines.map((l, i) => (
          <div key={i} className={KIND_COLOR[l.kind]}>
            <span className="whitespace-pre-wrap break-words">{l.text}</span>
            {l.kind === "error" && l.stack ? (
              <pre className="mt-1 whitespace-pre-wrap break-words rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-red-300">
                {l.stack}
              </pre>
            ) : null}
          </div>
        ))
      )}
    </div>
  );
}
