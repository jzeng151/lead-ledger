"use client";

import { useEffect, useRef, useState } from "react";
import { type LiveEvent } from "@/lib/liveViewModel";
import { AgentTree } from "./AgentTree";
import { AgentDetail } from "./AgentDetail";

// Events after which the server closes the stream. Closing the EventSource on
// these keeps it from auto-reconnecting and replaying the finished run.
const TERMINAL = new Set(["run_completed", "agent_error", "stream_end"]);

export function LiveView({ runId, onDone }: { runId: string; onDone?: () => void }) {
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [selected, setSelected] = useState("orchestrator");
  // Once the user clicks a node we stop auto-following the running agent.
  const userPickedRef = useRef(false);
  // Hold the latest onDone in a ref so a new callback identity does not re-open
  // the EventSource; the effect stays keyed on runId only.
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    // Reset before opening the new stream so a Re-run does not show the prior
    // run's stale statuses, output, or selection.
    setEvents([]);
    setSelected("orchestrator");
    userPickedRef.current = false;

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

  // Auto-follow: until the user clicks a node, track the newest agent to start
  // and snap back to the orchestrator on a terminal event so the final state
  // (completion or failure) is front and center. Events only append, so the
  // last one is the newest.
  useEffect(() => {
    if (userPickedRef.current || events.length === 0) return;
    const last = events[events.length - 1];
    if (last.type === "run_completed" || last.type === "agent_error") {
      setSelected("orchestrator");
    } else if ((last.type === "agent_started" || last.type === "scoring_started") && last.agent) {
      setSelected(last.agent);
    }
  }, [events]);

  const onSelect = (key: string) => {
    userPickedRef.current = true;
    setSelected(key);
  };

  // Surface a run failure as a legible banner in addition to the detail pane.
  const errorEvent = events.find((e) => e.type === "agent_error");

  return (
    <div className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950">
      {errorEvent ? (
        <div className="border-b border-red-500/30 bg-red-500/10 px-4 py-2 text-xs text-red-300">
          Run failed: {errorEvent.payload?.message ?? "unknown error"}
        </div>
      ) : null}
      <div className="grid md:grid-cols-[minmax(220px,300px)_1fr]">
        <div className="border-b border-zinc-800 md:border-b-0 md:border-r">
          <AgentTree events={events} selected={selected} onSelect={onSelect} />
        </div>
        <AgentDetail events={events} selected={selected} />
      </div>
    </div>
  );
}
