"use client";

import { useEffect, useRef, useState } from "react";
import { type LiveEvent } from "@/lib/liveViewModel";
import { PipelineGraph } from "./PipelineGraph";
import { LogStream } from "./LogStream";

// Events after which the server closes the stream. Closing the EventSource on
// these keeps it from auto-reconnecting and replaying the finished run.
const TERMINAL = new Set(["run_completed", "agent_error", "stream_end"]);

export function LiveView({ runId, onDone }: { runId: string; onDone?: () => void }) {
  const [events, setEvents] = useState<LiveEvent[]>([]);
  // Hold the latest onDone in a ref so a new callback identity does not re-open
  // the EventSource; the effect stays keyed on runId only.
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    const es = new EventSource(`/api/runs/${runId}/stream`);
    es.onmessage = (m) => {
      const ev: LiveEvent = JSON.parse(m.data);
      setEvents((prev) => [...prev, ev]);
      if (TERMINAL.has(ev.type)) {
        es.close();
        onDoneRef.current?.();
      }
    };
    // A dropped connection would otherwise trigger EventSource's auto-reconnect;
    // close so a finished or failed run is not re-subscribed.
    es.onerror = () => es.close();
    return () => es.close();
  }, [runId]);

  return (
    <div className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950">
      <PipelineGraph events={events} />
      <LogStream events={events} />
    </div>
  );
}
