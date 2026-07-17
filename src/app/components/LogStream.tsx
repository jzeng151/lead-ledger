"use client";

import { useEffect, useRef } from "react";
import { logLines, type LiveEvent } from "@/lib/liveViewModel";

// Color the leading marker: v done green / x error red / > running amber /
// . tool call dim. Streamed assistant text (no marker) stays neutral.
function markerClass(text: string): string {
  const t = text.trimStart();
  if (t.startsWith("✓")) return "text-green-400";
  if (t.startsWith("✗")) return "text-red-400";
  if (t.startsWith("▸")) return "text-amber-400";
  if (t.startsWith("·")) return "text-zinc-500";
  return "text-zinc-300";
}

export function LogStream({ events }: { events: LiveEvent[] }) {
  const lines = logLines(events);
  const boxRef = useRef<HTMLDivElement>(null);

  // Keep the newest content in view. Keyed on the event count, not line count, so
  // the box also follows a single streamed line as tokens append to it.
  useEffect(() => {
    const el = boxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events.length]);

  return (
    <div ref={boxRef} className="h-80 overflow-y-auto bg-black px-4 py-3 font-mono text-xs leading-relaxed">
      {lines.length === 0 ? (
        <div className="text-zinc-600">waiting for the run to start...</div>
      ) : (
        lines.map((l, i) => (
          <pre key={i} className={`whitespace-pre-wrap break-words ${markerClass(l.text)}`}>
            {l.text}
          </pre>
        ))
      )}
    </div>
  );
}
