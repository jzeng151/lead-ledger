import { describe, it, expect } from "vitest";
import {
  nodeStatus,
  logLines,
  traceLines,
  agentDetail,
  treeNodeStatus,
  findTreeNode,
  AGENT_TREE,
  PIPELINE_NODES,
  type LiveEvent,
  type TreeNode,
} from "./liveViewModel";

// The exact event sequence observed in this environment (no ANTHROPIC_API_KEY):
// the run starts, the plan fans out to the five retrieval agents, each emits
// agent_started synchronously, then the first API call fails and the
// orchestrator emits a terminal agent_error.
const NO_KEY_SEQUENCE: LiveEvent[] = [
  { agent: "orchestrator", type: "run_started", payload: { contactId: "c1" } },
  { agent: "orchestrator", type: "plan_ready", payload: { agents: ["company", "contact", "tech", "news", "engagement"] } },
  { agent: "company", type: "agent_started", payload: {} },
  { agent: "contact", type: "agent_started", payload: {} },
  { agent: "tech", type: "agent_started", payload: {} },
  { agent: "news", type: "agent_started", payload: {} },
  { agent: "engagement", type: "agent_started", payload: {} },
  { agent: "orchestrator", type: "agent_error", payload: { message: "missing ANTHROPIC_API_KEY" } },
];

describe("nodeStatus", () => {
  it("progresses wait -> running -> done for a single agent", () => {
    expect(nodeStatus([], "company")).toBe("wait");

    const started: LiveEvent[] = [{ agent: "company", type: "agent_started", payload: {} }];
    expect(nodeStatus(started, "company")).toBe("running");

    const streaming: LiveEvent[] = [
      ...started,
      { agent: "company", type: "agent_tool_call", payload: { name: "pdl_company_enrich" } },
      { agent: "company", type: "agent_token", payload: { text: "..." } },
    ];
    expect(nodeStatus(streaming, "company")).toBe("running");

    const done: LiveEvent[] = [...streaming, { agent: "company", type: "agent_completed", payload: {} }];
    expect(nodeStatus(done, "company")).toBe("done");
  });

  it("marks the scorer running on scoring_started and done on score_ready", () => {
    const events: LiveEvent[] = [{ agent: "scorer", type: "scoring_started", payload: {} }];
    expect(nodeStatus(events, "scorer")).toBe("running");
    events.push({ agent: "scorer", type: "score_ready", payload: { priority: 80 } });
    expect(nodeStatus(events, "scorer")).toBe("done");
  });

  it("marks the orchestrator done on run_completed", () => {
    const events: LiveEvent[] = [
      { agent: "orchestrator", type: "run_started", payload: {} },
      { agent: "orchestrator", type: "run_completed", payload: { priority: 80 } },
    ];
    expect(nodeStatus(events, "orchestrator")).toBe("done");
  });

  it("errors the orchestrator and in-flight nodes on the no-key sequence, leaves un-started nodes waiting", () => {
    const statuses = Object.fromEntries(PIPELINE_NODES.map((n) => [n, nodeStatus(NO_KEY_SEQUENCE, n)]));
    expect(statuses).toEqual({
      orchestrator: "error",
      company: "error",
      contact: "error",
      tech: "error",
      news: "error",
      engagement: "error",
      verification: "wait",
      icpfit: "wait",
      scorer: "wait",
    });
  });

  it("keeps an already-done node done even when the run later errors", () => {
    const events: LiveEvent[] = [
      { agent: "company", type: "agent_started", payload: {} },
      { agent: "company", type: "agent_completed", payload: {} },
      { agent: "orchestrator", type: "agent_error", payload: { message: "boom" } },
    ];
    expect(nodeStatus(events, "company")).toBe("done");
  });
});

describe("logLines", () => {
  it("coalesces consecutive same-agent tokens into one growing line", () => {
    const events: LiveEvent[] = [
      { agent: "company", type: "agent_started", payload: {} },
      { agent: "company", type: "agent_token", payload: { text: "Hello " } },
      { agent: "company", type: "agent_token", payload: { text: "world" } },
      { agent: "company", type: "agent_completed", payload: {} },
    ];
    expect(logLines(events)).toEqual([
      { agent: "company", text: "▸ company started" },
      { agent: "company", text: "Hello world" },
      { agent: "company", text: "  ✓ company done" },
    ]);
  });

  it("groups each agent's tokens together even when interleaved by another agent", () => {
    const events: LiveEvent[] = [
      { agent: "a", type: "agent_token", payload: { text: "1" } },
      { agent: "b", type: "agent_token", payload: { text: "2" } },
      { agent: "a", type: "agent_token", payload: { text: "3" } },
    ];
    // Grouped by agent (first-appearance order), a's deltas coalesce despite b's.
    expect(logLines(events)).toEqual([
      { agent: "a", text: "13" },
      { agent: "b", text: "2" },
    ]);
  });

  it("nests a tool call under its agent (no interleaved agent prefix)", () => {
    const events: LiveEvent[] = [{ agent: "company", type: "agent_tool_call", payload: { name: "pdl_company_enrich" } }];
    expect(logLines(events)).toEqual([{ agent: "company", text: "    · pdl_company_enrich" }]);
  });

  it("groups interleaved parallel tool calls under the agent that made them", () => {
    // Two agents fan out; their tool calls arrive interleaved chronologically.
    const events: LiveEvent[] = [
      { agent: "company", type: "agent_started", payload: {} },
      { agent: "tech", type: "agent_started", payload: {} },
      { agent: "tech", type: "agent_tool_call", payload: { name: "detect_tech_stack" } },
      { agent: "company", type: "agent_tool_call", payload: { name: "pdl_company_enrich" } },
      { agent: "tech", type: "agent_tool_call", payload: { name: "github_org_lookup" } },
      { agent: "company", type: "agent_tool_call", payload: { name: "apollo_org_enrich" } },
      { agent: "company", type: "agent_tool_call", payload: { name: "submit_findings" } },
      { agent: "tech", type: "agent_completed", payload: {} },
      { agent: "company", type: "agent_completed", payload: {} },
    ];
    // company appears first; each agent's tools sit under it, submit_findings hidden.
    expect(logLines(events)).toEqual([
      { agent: "company", text: "▸ company started" },
      { agent: "company", text: "    · pdl_company_enrich" },
      { agent: "company", text: "    · apollo_org_enrich" },
      { agent: "company", text: "  ✓ company done" },
      { agent: "tech", text: "▸ tech started" },
      { agent: "tech", text: "    · detect_tech_stack" },
      { agent: "tech", text: "    · github_org_lookup" },
      { agent: "tech", text: "  ✓ tech done" },
    ]);
  });

  it("renders the no-key sequence ending in an error line", () => {
    expect(logLines(NO_KEY_SEQUENCE)).toEqual([
      { agent: "orchestrator", text: "▸ run started" },
      { agent: "orchestrator", text: "  · plan: company, contact, tech, news, engagement" },
      { agent: "company", text: "▸ company started" },
      { agent: "contact", text: "▸ contact started" },
      { agent: "tech", text: "▸ tech started" },
      { agent: "news", text: "▸ news started" },
      { agent: "engagement", text: "▸ engagement started" },
      { agent: "orchestrator", text: "  ✗ error: missing ANTHROPIC_API_KEY" },
    ]);
  });
});

describe("traceLines", () => {
  it("maps a full run sequence to kinds and carries an error stack", () => {
    const events: LiveEvent[] = [
      { agent: "orchestrator", type: "run_started", payload: { contactId: "c1" } },
      { agent: "orchestrator", type: "plan_ready", payload: { agents: ["company", "contact"] } },
      { agent: "company", type: "agent_started", payload: {} },
      { agent: "company", type: "agent_tool_call", payload: { name: "pdl_company_enrich" } },
      { agent: "company", type: "agent_tool_result", payload: { id: "toolu_1" } },
      { agent: "company", type: "agent_completed", payload: { industry: "SaaS" } },
      { agent: "scorer", type: "scoring_started", payload: {} },
      { agent: "scorer", type: "score_ready", payload: { priority: 80, grade: "A" } },
      { agent: "orchestrator", type: "agent_error", payload: { message: "boom", stack: "Error: boom\n  at x (y.ts:1:1)" } },
    ];
    expect(traceLines(events)).toEqual([
      { kind: "info", text: "run started" },
      { kind: "info", text: "plan: company, contact" },
      { kind: "info", text: "company started" },
      { kind: "tool", text: "company -> pdl_company_enrich" },
      { kind: "tool", text: "company <- result" },
      { kind: "done", text: "company done" },
      { kind: "info", text: "scoring..." },
      { kind: "done", text: "scored: priority 80 grade A" },
      { kind: "error", text: "boom", stack: "Error: boom\n  at x (y.ts:1:1)" },
    ]);
    // The error line specifically carries the raw stack for the trace tab.
    const err = traceLines(events).find((l) => l.kind === "error");
    expect(err?.stack).toBe("Error: boom\n  at x (y.ts:1:1)");
  });

  it("renders run_completed and omits stack when the error has none (no-key sequence)", () => {
    expect(traceLines(NO_KEY_SEQUENCE)).toEqual([
      { kind: "info", text: "run started" },
      { kind: "info", text: "plan: company, contact, tech, news, engagement" },
      { kind: "info", text: "company started" },
      { kind: "info", text: "contact started" },
      { kind: "info", text: "tech started" },
      { kind: "info", text: "news started" },
      { kind: "info", text: "engagement started" },
      { kind: "error", text: "missing ANTHROPIC_API_KEY" },
    ]);
    expect(traceLines([{ agent: "orchestrator", type: "run_completed", payload: {} }])).toEqual([
      { kind: "done", text: "run completed" },
    ]);
  });
});

describe("agentDetail", () => {
  it("marks an interrupted retrieval agent errored and surfaces the run-level message", () => {
    const d = agentDetail(NO_KEY_SEQUENCE, "company");
    expect(d.status).toBe("error");
    // company emitted no agent_error of its own; the orchestrator's message is shown.
    expect(d.error).toBe("missing ANTHROPIC_API_KEY");
  });

  it("carries the orchestrator's own error message", () => {
    const d = agentDetail(NO_KEY_SEQUENCE, "orchestrator");
    expect(d.status).toBe("error");
    expect(d.error).toBe("missing ANTHROPIC_API_KEY");
  });

  it("pairs tool calls with results sequentially, then closes them on completion", () => {
    const events: LiveEvent[] = [
      { agent: "company", type: "agent_started", payload: {} },
      { agent: "company", type: "agent_tool_call", payload: { name: "pdl_company_enrich" } },
      { agent: "company", type: "agent_tool_call", payload: { name: "fetch_url" } },
      { agent: "company", type: "agent_tool_result", payload: { id: "toolu_1" } },
    ];
    // the first result closes the first call; the second stays open (spinner).
    expect(agentDetail(events, "company").toolCalls).toEqual([
      { name: "pdl_company_enrich", done: true },
      { name: "fetch_url", done: false },
    ]);

    // once the agent completes, no call is left spinning and findings is captured.
    events.push({ agent: "company", type: "agent_completed", payload: { size: "mid-market" } });
    const done = agentDetail(events, "company");
    expect(done.toolCalls).toEqual([
      { name: "pdl_company_enrich", done: true },
      { name: "fetch_url", done: true },
    ]);
    expect(done.status).toBe("done");
    expect(done.findings).toEqual({ size: "mid-market" });
  });

  it("coalesces streamed tokens into one text block", () => {
    const events: LiveEvent[] = [
      { agent: "news", type: "agent_started", payload: {} },
      { agent: "news", type: "agent_token", payload: { text: "Series " } },
      { agent: "news", type: "agent_token", payload: { text: "B " } },
      { agent: "news", type: "agent_token", payload: { text: "raised" } },
    ];
    const d = agentDetail(events, "news");
    expect(d.text).toBe("Series B raised");
    expect(d.status).toBe("running");
  });

  it("returns an empty aggregate detail for the _fanout group", () => {
    const d = agentDetail(NO_KEY_SEQUENCE, "_fanout");
    expect(d.status).toBe("error");
    expect(d.toolCalls).toEqual([]);
    expect(d.text).toBe("");
  });
});

describe("treeNodeStatus", () => {
  const fanout = findTreeNode(AGENT_TREE, "_fanout") as TreeNode;

  it("is wait before any fan-out child starts", () => {
    expect(treeNodeStatus([], fanout)).toBe("wait");
  });

  it("aggregates a running child as running and all-done children as done", () => {
    const partial: LiveEvent[] = [
      { agent: "company", type: "agent_completed", payload: {} },
      { agent: "contact", type: "agent_started", payload: {} },
    ];
    expect(treeNodeStatus(partial, fanout)).toBe("running");

    const allDone: LiveEvent[] = (fanout.children ?? []).map((c) => ({
      agent: c.key,
      type: "agent_completed",
      payload: {},
    }));
    expect(treeNodeStatus(allDone, fanout)).toBe("done");
  });

  it("surfaces a child error as the group's status, including the no-key fan-out", () => {
    // company done, contact still running when the orchestrator aborts -> contact
    // is interrupted (error via the global rule), so the group is error.
    const oneError: LiveEvent[] = [
      { agent: "company", type: "agent_completed", payload: {} },
      { agent: "contact", type: "agent_started", payload: {} },
      { agent: "orchestrator", type: "agent_error", payload: { message: "boom" } },
    ];
    expect(treeNodeStatus(oneError, fanout)).toBe("error");
    expect(treeNodeStatus(NO_KEY_SEQUENCE, fanout)).toBe("error");
  });

  it("reads the orchestrator root from its own events, not the fan-out aggregate", () => {
    expect(treeNodeStatus(NO_KEY_SEQUENCE, AGENT_TREE)).toBe("error");
    expect(treeNodeStatus([{ agent: "orchestrator", type: "run_started", payload: {} }], AGENT_TREE)).toBe("running");
  });
});

// A synthesis failure is non-fatal: the run keeps its deterministic score and
// still reaches run_completed, so agent_warning must not read as a run abort.
const SYNTHESIS_WARNING: LiveEvent[] = [
  { agent: "orchestrator", type: "run_started", payload: { contactId: "c1" } },
  { agent: "company", type: "agent_completed", payload: {} },
  { agent: "synthesis", type: "agent_warning", payload: { message: "overloaded", stack: "Error: overloaded" } },
  { agent: "scorer", type: "score_ready", payload: { priority: 91, grade: "A" } },
  { agent: "orchestrator", type: "run_completed", payload: { priority: 91 } },
];

describe("agent_warning: node-local failure, not a run abort", () => {
  it("marks only the warning node as error", () => {
    expect(nodeStatus(SYNTHESIS_WARNING, "synthesis")).toBe("error");
    expect(nodeStatus(SYNTHESIS_WARNING, "company")).toBe("done");
    expect(nodeStatus(SYNTHESIS_WARNING, "scorer")).toBe("done");
    expect(nodeStatus(SYNTHESIS_WARNING, "orchestrator")).toBe("done");
  });

  it("labels the log line as a warning and keeps the completed run footer", () => {
    const texts = logLines(SYNTHESIS_WARNING).map((l) => l.text);
    expect(texts).toContain("  ✗ synthesis warning: overloaded");
    expect(texts).toContain("  ✓ run completed");
  });

  it("traces the warning with its stack and says the run continued", () => {
    const warn = traceLines(SYNTHESIS_WARNING).find((l) => l.text.includes("overloaded"));
    expect(warn?.text).toBe("synthesis warning (run continued): overloaded");
    expect(warn?.stack).toBe("Error: overloaded");
  });

  it("surfaces the message in the synthesis detail pane", () => {
    expect(agentDetail(SYNTHESIS_WARNING, "synthesis").error).toBe("overloaded");
  });
});
