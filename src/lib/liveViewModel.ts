// Pure, testable view-model helpers for the hybrid live view. No React, no DOM:
// these turn a raw list of streamed run events into pipeline-node statuses and
// human-readable log lines. Kept side-effect free so the logic is unit-tested
// without a browser or an API key.

export type LiveEvent = { agent?: string; type: string; payload?: any };

// Left-to-right pipeline order shown in the graph strip. The five fan-out
// retrieval agents run in parallel between the orchestrator and verification.
export const PIPELINE_NODES = [
  "orchestrator",
  "company",
  "contact",
  "tech",
  "news",
  "engagement",
  "verification",
  "icpfit",
  "scorer",
] as const;

export type NodeStatus = "wait" | "running" | "done" | "error";

/**
 * Derive a single node's status from the event list.
 *
 * Per-node rules (looking only at events whose `agent` matches `node`):
 *   - "wait"    : no events for this node yet (grey).
 *   - "running" : the node has an "agent_started" / "scoring_started" /
 *                 "run_started" event, or any intermediate event (tool call,
 *                 token) without a completion (amber).
 *   - "done"    : "agent_completed" / "score_ready" / "run_completed" (green).
 *   - "error"   : this node emitted "agent_error" or "agent_warning" (red).
 *
 * "agent_warning" is a node-local failure in an optional layer (synthesis): the
 * node itself failed, but the run carries on and still scores, so the warning is
 * deliberately excluded from the global rule below.
 *
 * Global rule: an "agent_error" anywhere aborts the run. The orchestrator emits
 * that event so it turns red via the per-node rule. Any other node still in
 * flight ("running") is marked "error" too, since it was interrupted. Nodes that
 * already finished stay "done"; nodes that never started stay "wait" (they never
 * got a turn, so painting them red would misrepresent what happened).
 */
export function nodeStatus(events: LiveEvent[], node: string): NodeStatus {
  const globalError = events.some((e) => e.type === "agent_error");
  let status: NodeStatus = "wait";

  for (const e of events) {
    if (e.agent !== node) continue;
    switch (e.type) {
      case "agent_completed":
      case "score_ready":
      case "run_completed":
        status = "done";
        break;
      case "agent_error":
      case "agent_warning":
        status = "error";
        break;
      case "agent_started":
      case "scoring_started":
      case "run_started":
        if (status !== "done") status = "running";
        break;
      default:
        // plan_ready, agent_tool_call, agent_tool_result, agent_token, ...
        if (status === "wait") status = "running";
    }
  }

  if (globalError && status === "running") status = "error";
  return status;
}

export type LogLine = { agent: string; text: string };

/**
 * Flatten events into human-readable log lines, grouped by agent so each agent's
 * tool calls read under the agent that made them rather than interleaved across
 * the parallel fan-out. Run-level lines (started, plan, completed, error) bracket
 * the per-agent groups; agents are ordered by first appearance (the fan-out, then
 * judge/score/synthesis order). Within an agent, tool calls appear in order and
 * consecutive token deltas coalesce into one streamed block. The internal
 * `submit_findings` call is hidden (the "done" line already marks completion);
 * agent_tool_result and stream_end are not logged.
 *
 * Line shapes:
 *   run_started      -> "▸ run started"
 *   plan_ready       -> "  · plan: a, b, c"
 *   agent_started    -> "▸ <agent> started"
 *   scoring_started  -> "▸ scorer started"
 *   agent_tool_call  -> "    · <name>"            (nested under its agent)
 *   agent_token      -> appended to the agent's streaming line
 *   agent_completed  -> "  ✓ <agent> done"
 *   score_ready      -> "  ✓ scorer done"
 *   run_completed    -> "  ✓ run completed"
 *   agent_error      -> "  ✗ <agent> error: <message>" (or run-level "  ✗ error: ...")
 */
export function logLines(events: LiveEvent[]): LogLine[] {
  const lines: LogLine[] = [];

  // Run-level header.
  if (events.some((e) => e.type === "run_started")) lines.push({ agent: "orchestrator", text: "▸ run started" });
  const plan = events.find((e) => e.type === "plan_ready");
  if (plan) lines.push({ agent: "orchestrator", text: "  · plan: " + (plan.payload?.agents ?? []).join(", ") });

  // Distinct non-orchestrator agents in first-appearance order.
  const order: string[] = [];
  for (const e of events) {
    const a = e.agent ?? "";
    if (a && a !== "orchestrator" && !order.includes(a)) order.push(a);
  }

  for (const agent of order) {
    const own = events.filter((e) => e.agent === agent);
    if (own.some((e) => e.type === "agent_started" || e.type === "scoring_started"))
      lines.push({ agent, text: "▸ " + agent + " started" });

    // Body: this agent's tool calls and streamed text, in order.
    let streaming: LogLine | null = null;
    for (const e of own) {
      if (e.type === "agent_token") {
        const text = e.payload?.text ?? "";
        if (streaming) streaming.text += text;
        else {
          streaming = { agent, text };
          lines.push(streaming);
        }
      } else if (e.type === "agent_tool_call" && e.payload?.name !== "submit_findings") {
        streaming = null;
        lines.push({ agent, text: "    · " + (e.payload?.name ?? "") });
      }
    }

    // Terminal line for the agent. A warning reads as a failure of this agent
    // only, so it is labelled differently from a run-aborting error.
    const err = own.find((e) => e.type === "agent_error" || e.type === "agent_warning");
    if (err)
      lines.push({
        agent,
        text: "  ✗ " + agent + (err.type === "agent_warning" ? " warning: " : " error: ") + (err.payload?.message ?? "unknown"),
      });
    else if (own.some((e) => e.type === "agent_completed" || e.type === "score_ready"))
      lines.push({ agent, text: "  ✓ " + agent + " done" });
  }

  // Run-level footer.
  const orchErr = events.find((e) => e.type === "agent_error" && e.agent === "orchestrator");
  if (orchErr) lines.push({ agent: "orchestrator", text: "  ✗ error: " + (orchErr.payload?.message ?? "unknown") });
  if (events.some((e) => e.type === "run_completed")) lines.push({ agent: "orchestrator", text: "  ✓ run completed" });

  return lines;
}

export type TraceKind = "info" | "tool" | "source" | "done" | "error";
export type TraceLine = { kind: TraceKind; text: string; stack?: string };

// Render a tool_source event as an indented source-access line under its tool
// call: the exact location consulted (URL or fixture path), HTTP status on live
// calls, and whether it found anything.
function sourceLine(payload: any): TraceLine {
  const verb =
    payload?.mode === "fixture" ? "read" : payload?.mode === "db" ? "query" : payload?.mode === "web" ? "echo" : "GET";
  const mark = payload?.outcome === "error" ? "✗" : payload?.outcome === "empty" ? "∅" : "✓";
  const status = typeof payload?.status === "number" ? ` [${payload.status}]` : "";
  const detail = payload?.detail ? ` — ${payload.detail}` : "";
  return {
    kind: payload?.outcome === "error" ? "error" : "source",
    text: `    ${mark} ${verb} ${payload?.location ?? "?"}${status}${detail}`,
  };
}

/**
 * Flatten events into terminal-style trace lines, one per mapped event in order.
 * Unlike logLines, tokens are not coalesced here (the trace is an event log, not
 * a streamed transcript); agent_token and stream_end have no mapping and are
 * skipped. An agent_error carries the message as text plus the raw stack, if the
 * emitter attached one, so the trace tab can print the real stack trace.
 */
export function traceLines(events: LiveEvent[]): TraceLine[] {
  const lines: TraceLine[] = [];
  for (const e of events) {
    const agent = e.agent ?? "";
    switch (e.type) {
      case "run_started":
        lines.push({ kind: "info", text: "run started" });
        break;
      case "plan_ready":
        lines.push({ kind: "info", text: "plan: " + (e.payload?.agents ?? []).join(", ") });
        break;
      case "agent_started":
        lines.push({ kind: "info", text: agent + " started" });
        break;
      case "agent_tool_call":
        lines.push({ kind: "tool", text: agent + " -> " + (e.payload?.name ?? "") });
        break;
      case "tool_source":
        lines.push(sourceLine(e.payload));
        break;
      case "agent_tool_result":
        lines.push({ kind: "tool", text: agent + " <- result" });
        break;
      case "agent_completed":
        lines.push({ kind: "done", text: agent + " done" });
        break;
      case "scoring_started":
        lines.push({ kind: "info", text: "scoring..." });
        break;
      case "score_ready":
        lines.push({ kind: "done", text: "scored: priority " + e.payload?.priority + " grade " + e.payload?.grade });
        break;
      case "run_completed":
        lines.push({ kind: "done", text: "run completed" });
        break;
      case "agent_error":
        lines.push({ kind: "error", text: e.payload?.message ?? "unknown error", stack: e.payload?.stack });
        break;
      case "agent_warning":
        lines.push({
          kind: "error",
          text: `${agent} warning (run continued): ${e.payload?.message ?? "unknown"}`,
          stack: e.payload?.stack,
        });
        break;
      default:
        // agent_token, stream_end, and any unknown types have no trace line.
        break;
    }
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Orchestration tree
// ---------------------------------------------------------------------------

export type TreeNode = { key: string; label: string; children?: TreeNode[] };

// The orchestration hierarchy shown in the interactive tree. Keys that start
// with "_" are non-agent grouping nodes: they emit no events of their own and
// derive their status from their children (see treeNodeStatus).
export const AGENT_TREE: TreeNode = {
  key: "orchestrator",
  label: "Orchestrator",
  children: [
    {
      key: "_fanout",
      label: "Retrieval (parallel)",
      children: [
        { key: "company", label: "Company" },
        { key: "contact", label: "Contact" },
        { key: "tech", label: "Tech Stack" },
        { key: "news", label: "News / Triggers" },
        { key: "engagement", label: "Engagement" },
      ],
    },
    { key: "verification", label: "Verification" },
    { key: "icpfit", label: "ICP-Fit" },
    { key: "scorer", label: "Scorer" },
    { key: "synthesis", label: "Synthesis" },
  ],
};

// A grouping node has no events of its own; its key is the "_"-prefixed marker.
function isGroupNode(node: TreeNode): boolean {
  return node.key.startsWith("_");
}

/** Depth-first lookup of a node by key. Returns null when the key is unknown. */
export function findTreeNode(node: TreeNode, key: string): TreeNode | null {
  if (node.key === key) return node;
  for (const child of node.children ?? []) {
    const found = findTreeNode(child, key);
    if (found) return found;
  }
  return null;
}

/**
 * Status of any tree node.
 *   - Agent nodes (orchestrator, retrieval agents, verification, icpfit,
 *     scorer, synthesis) read their own events via nodeStatus. The orchestrator
 *     is an agent node that also has children; its status is still its own.
 *   - Group nodes ("_fanout") aggregate their children: error if any child
 *     errored, else running if any child is running, else done when every child
 *     is done, else wait. Error wins over running so a failed fan-out reads as
 *     failed rather than hiding behind a sibling that is still streaming.
 */
export function treeNodeStatus(events: LiveEvent[], node: TreeNode): NodeStatus {
  if (isGroupNode(node)) {
    const statuses = (node.children ?? []).map((c) => treeNodeStatus(events, c));
    if (statuses.some((s) => s === "error")) return "error";
    if (statuses.some((s) => s === "running")) return "running";
    if (statuses.length > 0 && statuses.every((s) => s === "done")) return "done";
    return "wait";
  }
  return nodeStatus(events, node.key);
}

export type ToolCall = { name: string; done: boolean };

export type AgentDetailState = {
  status: NodeStatus;
  toolCalls: ToolCall[];
  text: string;
  findings: unknown | null;
  error: string | null;
};

/**
 * Derive one agent's progress from the event list, for the detail pane.
 *
 *   - toolCalls: each agent_tool_call in order; a later agent_tool_result for
 *     the same agent closes the earliest still-open call (simple sequential
 *     pairing, since a result only carries the tool_use id, not the name). When
 *     the agent reaches "done" any calls still open are closed too, so the
 *     terminal submit_findings call does not spin forever.
 *   - text: all agent_token deltas for this agent, coalesced in order.
 *   - findings: the payload of the agent's completion event
 *     (agent_completed / score_ready / run_completed).
 *   - error: the agent's own agent_error message. A retrieval child carries no
 *     error of its own but can be interrupted when the orchestrator aborts the
 *     run; in that case its status is "error" and the run-level message is
 *     surfaced so the pane explains the red status.
 *
 * The "_fanout" group has no events; it returns an aggregate status with empty
 * detail, and the pane renders a short parallel-run summary from the tree.
 */
export function agentDetail(events: LiveEvent[], agentKey: string): AgentDetailState {
  const groupNode = agentKey.startsWith("_") ? findTreeNode(AGENT_TREE, agentKey) : null;
  if (groupNode) {
    return { status: treeNodeStatus(events, groupNode), toolCalls: [], text: "", findings: null, error: null };
  }

  const status = nodeStatus(events, agentKey);
  const toolCalls: ToolCall[] = [];
  let nextOpen = 0; // index of the earliest tool call not yet closed by a result
  let text = "";
  let findings: unknown | null = null;
  let error: string | null = null;

  for (const e of events) {
    if (e.agent !== agentKey) continue;
    switch (e.type) {
      case "agent_tool_call":
        toolCalls.push({ name: e.payload?.name ?? "", done: false });
        break;
      case "agent_tool_result":
        if (nextOpen < toolCalls.length) toolCalls[nextOpen++].done = true;
        break;
      case "agent_token":
        text += e.payload?.text ?? "";
        break;
      case "agent_completed":
      case "score_ready":
      case "run_completed":
        findings = e.payload ?? null;
        break;
      case "agent_error":
      case "agent_warning":
        error = e.payload?.message ?? "unknown error";
        break;
      default:
        break;
    }
  }

  // A completed agent has no in-flight tools; close any left open (e.g. the
  // terminal submit_findings call, which never gets a matching result).
  if (status === "done") for (const c of toolCalls) c.done = true;

  // Interrupted-but-blameless child: surface the run-level failure message.
  if (!error && status === "error") {
    const globalErr = events.find((e) => e.type === "agent_error");
    if (globalErr) error = globalErr.payload?.message ?? "run failed";
  }

  return { status, toolCalls, text, findings, error };
}
