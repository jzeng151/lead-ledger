"use client";

import { useEffect, useRef, useState } from "react";
import { type LiveEvent } from "@/lib/liveViewModel";
import { AgentTree } from "./AgentTree";
import { AgentDetail } from "./AgentDetail";
import { RunTrace } from "./RunTrace";

// Events after which the server closes the stream. Closing the EventSource on
// these keeps it from auto-reconnecting and replaying the finished run.
const TERMINAL = new Set(["run_completed", "agent_error", "stream_end"]);

type RunStatus = "connecting" | "running" | "done" | "error";

const STATUS_META: Record<RunStatus, { label: string; dot: string; text: string; pulse: boolean }> = {
  connecting: { label: "connecting", dot: "bg-slate-500", text: "text-slate-400", pulse: false },
  running: { label: "running", dot: "bg-amber-400", text: "text-amber-300", pulse: true },
  done: { label: "done", dot: "bg-emerald-400", text: "text-emerald-300", pulse: false },
  error: { label: "failed", dot: "bg-rose-400", text: "text-rose-300", pulse: false },
};

export function LiveView({ runId, onDone }: { runId: string; onDone?: () => void }) {
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [selected, setSelected] = useState("orchestrator");
  const [tab, setTab] = useState<"tree" | "trace">("tree");
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
  const status: RunStatus = errorEvent
    ? "error"
    : events.some((e) => e.type === "run_completed" || e.type === "stream_end")
      ? "done"
      : events.length > 0
        ? "running"
        : "connecting";
  const meta = STATUS_META[status];

  return (
    <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950 shadow-lg shadow-slate-900/10">
      <div className="flex items-center justify-between gap-3 border-b border-slate-800 px-3.5 py-2.5">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-rose-500/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-amber-500/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/70" />
          <span className="ml-2 font-mono text-[11px] text-slate-500">run {runId.slice(0, 8)}</span>
          <span className={`ml-1.5 flex items-center gap-1.5 text-[11px] font-medium ${meta.text}`}>
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${meta.dot} ${meta.pulse ? "animate-pulse" : ""}`} />
            {meta.label}
          </span>
        </div>
        <div className="flex gap-0.5 rounded-lg bg-slate-900 p-0.5">
          {(["tree", "trace"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              aria-current={tab === t ? "true" : undefined}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                tab === t ? "bg-slate-800 text-slate-100" : "text-slate-500 hover:text-slate-300"
              }`}
            >
              {t === "tree" ? "Tree" : "Trace"}
            </button>
          ))}
        </div>
      </div>

      {errorEvent ? (
        <div className="border-b border-rose-500/30 bg-rose-500/10 px-4 py-2 text-xs text-rose-300">
          Run failed: {errorEvent.payload?.message ?? "unknown error"}
        </div>
      ) : null}

      {tab === "tree" ? (
        <div className="grid md:grid-cols-[minmax(220px,300px)_1fr]">
          <div className="border-b border-slate-800 md:border-b-0 md:border-r">
            <AgentTree events={events} selected={selected} onSelect={onSelect} />
          </div>
          <AgentDetail events={events} selected={selected} />
        </div>
      ) : (
        <RunTrace events={events} />
      )}
    </div>
  );
}
