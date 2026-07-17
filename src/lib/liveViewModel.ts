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
 *   - "error"   : this node emitted "agent_error" (red).
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
 * Flatten events into human-readable log lines, newest last. Consecutive
 * "agent_token" deltas from the same agent coalesce into one growing line so a
 * streamed response reads as a single block. Any non-token event (or a token
 * from a different agent) breaks the current streaming line.
 *
 * Line shapes:
 *   run_started      -> "* run started"           (rendered "▸ run started")
 *   plan_ready       -> "* plan: a, b, c"
 *   agent_started    -> "* <agent> started"
 *   scoring_started  -> "* scorer started"
 *   agent_tool_call  -> "  . <agent> -> <name>"
 *   agent_token      -> appended to current streaming line
 *   agent_completed  -> "  v <agent> done"
 *   score_ready      -> "  v scorer done"
 *   run_completed    -> "  v run completed"
 *   agent_error      -> "  x error: <message>"
 * (agent_tool_result and stream_end are intentionally not logged.)
 */
export function logLines(events: LiveEvent[]): LogLine[] {
  const lines: LogLine[] = [];
  // The line currently being appended to by consecutive same-agent tokens, or
  // null when the previous event was not a token from that agent.
  let streaming: LogLine | null = null;

  const push = (agent: string, text: string) => {
    lines.push({ agent, text });
    streaming = null;
  };

  for (const e of events) {
    const agent = e.agent ?? "";
    switch (e.type) {
      case "agent_token": {
        const text = e.payload?.text ?? "";
        if (streaming && streaming.agent === agent) {
          streaming.text += text;
        } else {
          streaming = { agent, text };
          lines.push(streaming);
        }
        break;
      }
      case "run_started":
        push(agent, "▸ run started");
        break;
      case "plan_ready":
        push(agent, "  · plan: " + (e.payload?.agents ?? []).join(", "));
        break;
      case "agent_started":
      case "scoring_started":
        push(agent, "▸ " + agent + " started");
        break;
      case "agent_tool_call":
        push(agent, "  · " + agent + " -> " + (e.payload?.name ?? ""));
        break;
      case "agent_completed":
      case "score_ready":
        push(agent, "  ✓ " + agent + " done");
        break;
      case "run_completed":
        push(agent, "  ✓ run completed");
        break;
      case "agent_error":
        push(agent, "  ✗ error: " + (e.payload?.message ?? "unknown"));
        break;
      default:
        // agent_tool_result, stream_end, and any unknown types are not logged.
        break;
    }
  }

  return lines;
}
