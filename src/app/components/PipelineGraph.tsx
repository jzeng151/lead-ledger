import { PIPELINE_NODES, nodeStatus, type LiveEvent, type NodeStatus } from "@/lib/liveViewModel";

// wait grey / running amber / done green / error red.
const STATUS_STYLES: Record<NodeStatus, string> = {
  wait: "border-zinc-700 bg-zinc-800/60 text-zinc-500",
  running: "border-amber-500 bg-amber-500/15 text-amber-300",
  done: "border-green-500 bg-green-500/15 text-green-300",
  error: "border-red-500 bg-red-500/15 text-red-300",
};

export function PipelineGraph({ events }: { events: LiveEvent[] }) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800 bg-zinc-950 px-4 py-3 font-mono text-xs">
      {PIPELINE_NODES.map((node, i) => (
        <div key={node} className="flex items-center gap-2">
          <span className={`rounded border px-2 py-1 transition-colors ${STATUS_STYLES[nodeStatus(events, node)]}`}>
            {node}
          </span>
          {i < PIPELINE_NODES.length - 1 && <span className="text-zinc-600">{"->"}</span>}
        </div>
      ))}
    </div>
  );
}
