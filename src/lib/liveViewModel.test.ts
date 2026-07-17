import { describe, it, expect } from "vitest";
import { nodeStatus, logLines, PIPELINE_NODES, type LiveEvent } from "./liveViewModel";

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

  it("breaks coalescing when a different agent's token interleaves", () => {
    const events: LiveEvent[] = [
      { agent: "a", type: "agent_token", payload: { text: "1" } },
      { agent: "b", type: "agent_token", payload: { text: "2" } },
      { agent: "a", type: "agent_token", payload: { text: "3" } },
    ];
    expect(logLines(events)).toEqual([
      { agent: "a", text: "1" },
      { agent: "b", text: "2" },
      { agent: "a", text: "3" },
    ]);
  });

  it("renders a tool call line", () => {
    const events: LiveEvent[] = [{ agent: "company", type: "agent_tool_call", payload: { name: "pdl_company_enrich" } }];
    expect(logLines(events)).toEqual([{ agent: "company", text: "  · company -> pdl_company_enrich" }]);
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
