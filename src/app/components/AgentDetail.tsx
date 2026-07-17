"use client";

import { useEffect, useRef } from "react";
import {
  agentDetail,
  findTreeNode,
  logLines,
  treeNodeStatus,
  AGENT_TREE,
  type LiveEvent,
  type NodeStatus,
} from "@/lib/liveViewModel";

const STATUS_BADGE: Record<NodeStatus, string> = {
  wait: "border-slate-700 bg-slate-800/60 text-slate-400",
  running: "border-amber-500 bg-amber-500/15 text-amber-300",
  done: "border-emerald-500 bg-emerald-500/15 text-emerald-300",
  error: "border-rose-500 bg-rose-500/15 text-rose-300",
};

// Reuse the log's marker coloring for the orchestrator timeline.
function markerClass(text: string): string {
  const t = text.trimStart();
  if (t.startsWith("✓")) return "text-emerald-400";
  if (t.startsWith("✗")) return "text-rose-400";
  if (t.startsWith("▸")) return "text-amber-400";
  if (t.startsWith("·")) return "text-slate-500";
  return "text-slate-300";
}

function StatusBadge({ status }: { status: NodeStatus }) {
  return (
    <span className={`rounded border px-2 py-0.5 text-[10px] uppercase tracking-wide ${STATUS_BADGE[status]}`}>
      {status}
    </span>
  );
}

export function AgentDetail({ events, selected }: { events: LiveEvent[]; selected: string }) {
  const node = findTreeNode(AGENT_TREE, selected);
  const label = node?.label ?? selected;
  const detail = agentDetail(events, selected);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll the streamed output / timeline to the newest content.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [detail.text, events.length, selected]);

  return (
    <div className="flex h-96 flex-col bg-slate-950 font-mono text-xs">
      <header className="flex items-center justify-between border-b border-slate-800 px-4 py-2.5">
        <span className="font-semibold text-slate-100">{label}</span>
        <StatusBadge status={detail.status} />
      </header>

      {selected === "orchestrator" ? (
        <OrchestratorTimeline events={events} error={detail.error} scrollRef={scrollRef} />
      ) : selected === "_fanout" ? (
        <FanoutSummary events={events} />
      ) : (
        <AgentBody detail={detail} scrollRef={scrollRef} />
      )}
    </div>
  );
}

function OrchestratorTimeline({
  events,
  error,
  scrollRef,
}: {
  events: LiveEvent[];
  error: string | null;
  scrollRef: React.RefObject<HTMLDivElement | null>;
}) {
  const lines = logLines(events);
  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 leading-relaxed">
      <div className="mb-2 text-[10px] uppercase tracking-wide text-slate-600">run timeline</div>
      {lines.length === 0 ? (
        <div className="text-slate-600">waiting for the run to start...</div>
      ) : (
        lines.map((l, i) => (
          <pre key={i} className={`whitespace-pre-wrap break-words ${markerClass(l.text)}`}>
            {l.text}
          </pre>
        ))
      )}
      {error ? <ErrorBox message={error} /> : null}
    </div>
  );
}

function FanoutSummary({ events }: { events: LiveEvent[] }) {
  const node = findTreeNode(AGENT_TREE, "_fanout");
  const children = node?.children ?? [];
  const running = children.filter((c) => treeNodeStatus(events, c) === "running").length;
  const done = children.filter((c) => treeNodeStatus(events, c) === "done").length;
  const errored = children.filter((c) => treeNodeStatus(events, c) === "error").length;
  return (
    <div className="flex-1 overflow-y-auto px-4 py-3 leading-relaxed text-slate-300">
      <p className="text-slate-400">The five retrieval agents run in parallel, then feed verification and ICP-fit.</p>
      <ul className="mt-3 space-y-1">
        {children.map((c) => (
          <li key={c.key} className="flex items-center justify-between">
            <span>{c.label}</span>
            <span className="text-slate-500">{treeNodeStatus(events, c)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-slate-500">
        {done} done · {running} running · {errored} error · of {children.length}
      </p>
    </div>
  );
}

function AgentBody({
  detail,
  scrollRef,
}: {
  detail: ReturnType<typeof agentDetail>;
  scrollRef: React.RefObject<HTMLDivElement | null>;
}) {
  const idle = detail.status === "wait";
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {idle ? (
        <div className="px-4 py-3 text-slate-600">waiting for this agent to start...</div>
      ) : (
        <>
          {detail.toolCalls.length > 0 ? (
            <div className="border-b border-slate-800/70 px-4 py-2.5">
              <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-600">tool calls</div>
              <ul className="space-y-0.5">
                {detail.toolCalls.map((t, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <span className={`inline-block w-3 text-center ${t.done ? "text-emerald-400" : "text-amber-400"}`}>
                      <span className={t.done ? "" : "inline-block animate-spin"}>{t.done ? "✓" : "◐"}</span>
                    </span>
                    <span className="text-slate-300">{t.name}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-2.5 leading-relaxed">
            {detail.text ? (
              <pre className="whitespace-pre-wrap break-words text-slate-300">{detail.text}</pre>
            ) : (
              <div className="text-slate-600">no streamed output</div>
            )}
          </div>

          {detail.findings != null ? (
            <details className="border-t border-slate-800/70 px-4 py-2.5" open>
              <summary className="cursor-pointer text-[10px] uppercase tracking-wide text-slate-500">findings</summary>
              <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words text-slate-400">
                {JSON.stringify(detail.findings, null, 2)}
              </pre>
            </details>
          ) : null}

          {detail.error ? <ErrorBox message={detail.error} /> : null}
        </>
      )}
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="mx-4 my-3 rounded border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-rose-300">{message}</div>
  );
}
