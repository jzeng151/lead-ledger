"use client";

import { AGENT_TREE, treeNodeStatus, type LiveEvent, type NodeStatus, type TreeNode } from "@/lib/liveViewModel";

// wait grey / running amber / done green / error red.
const GLYPH: Record<NodeStatus, string> = { wait: "○", running: "◐", done: "✓", error: "✗" };
const GLYPH_COLOR: Record<NodeStatus, string> = {
  wait: "text-zinc-600",
  running: "text-amber-400",
  done: "text-green-400",
  error: "text-red-400",
};
const STATUS_COLOR: Record<NodeStatus, string> = {
  wait: "text-zinc-600",
  running: "text-amber-400",
  done: "text-green-500",
  error: "text-red-400",
};

// Flatten the static tree into rows once, each carrying its connector prefix.
// ancestorsLast[i] tells whether the ancestor at depth i was the last of its
// siblings, which decides whether to draw a continuing "│" guide or blank.
type Row = { node: TreeNode; prefix: string };

function walk(node: TreeNode, ancestorsLast: boolean[], rows: Row[]) {
  let prefix = "";
  ancestorsLast.forEach((isLast, i) => {
    const isConnector = i === ancestorsLast.length - 1;
    if (isConnector) prefix += isLast ? "└─ " : "├─ ";
    else prefix += isLast ? "   " : "│  ";
  });
  rows.push({ node, prefix });
  const children = node.children ?? [];
  children.forEach((child, i) => walk(child, [...ancestorsLast, i === children.length - 1], rows));
}

const ROWS: Row[] = (() => {
  const rows: Row[] = [];
  walk(AGENT_TREE, [], rows);
  return rows;
})();

export function AgentTree({
  events,
  selected,
  onSelect,
}: {
  events: LiveEvent[];
  selected: string;
  onSelect: (key: string) => void;
}) {
  return (
    <div className="bg-zinc-950 px-2 py-3 font-mono text-xs">
      {ROWS.map(({ node, prefix }) => {
        const status = treeNodeStatus(events, node);
        const isSelected = node.key === selected;
        return (
          <button
            key={node.key}
            type="button"
            onClick={() => onSelect(node.key)}
            aria-current={isSelected ? "true" : undefined}
            className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left transition-colors ${
              isSelected
                ? "bg-zinc-800 ring-1 ring-inset ring-zinc-600"
                : status === "running"
                  ? "bg-amber-500/5 hover:bg-zinc-900"
                  : "hover:bg-zinc-900"
            }`}
          >
            <span className="whitespace-pre text-zinc-700">{prefix}</span>
            <span
              className={`inline-block w-4 text-center ${GLYPH_COLOR[status]} ${status === "running" ? "animate-spin" : ""}`}
            >
              {GLYPH[status]}
            </span>
            <span className={`flex-1 truncate ${isSelected ? "text-zinc-100" : "text-zinc-300"}`}>{node.label}</span>
            <span className={`shrink-0 ${STATUS_COLOR[status]}`}>{status}</span>
          </button>
        );
      })}
    </div>
  );
}
