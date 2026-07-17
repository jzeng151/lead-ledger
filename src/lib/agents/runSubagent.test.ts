import { describe, it, expect } from "vitest";
import { runSubagent, type EventSink } from "./runSubagent";
import { ContactFindings } from "./schemas";

// A minimal, valid ContactFindings instance (hand-written).
const validContact = {
  title: { value: "VP Engineering", confidence: 0.9, source: "pdl_person_enrich" },
  seniority: { value: "VP", confidence: 0.9, source: "pdl_person_enrich" },
  department: { value: "Engineering", confidence: 0.8, source: "pdl_person_enrich" },
  tenureMonths: { value: 18, confidence: 0.7, source: "pdl_person_enrich" },
  jobChange: { value: false, confidence: 0.6, source: "pdl_person_enrich" },
  buyingRole: { value: "champion", confidence: 0.6, source: "inferred" },
  emailVerified: { value: true, confidence: 0.95, source: "hunter_verify_email" },
  identityUnverified: false,
};

// Fake objects shaped like the real SDK surface runSubagent reads:
// runner  -> AsyncIterable<stream> with a `params.messages` getter
// stream  -> AsyncIterable<event> with async finalMessage()
function fakeStream(events: unknown[], finalContent: unknown[]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const ev of events) yield ev;
    },
    async finalMessage() {
      return { role: "assistant", content: finalContent };
    },
  };
}

function fakeClient(stream: ReturnType<typeof fakeStream>, messages: unknown[]) {
  const runner = {
    params: { messages },
    async *[Symbol.asyncIterator]() {
      yield stream;
    },
  };
  return { beta: { messages: { toolRunner: () => runner } } };
}

function collectingBus() {
  const events: { agent: string; type: string; payload: unknown }[] = [];
  const bus: EventSink = { emit: (e) => events.push(e) };
  return { bus, events };
}

describe("runSubagent", () => {
  it("returns the parsed submit_findings input and emits lifecycle events", async () => {
    const { bus, events } = collectingBus();

    const stream = fakeStream(
      [
        { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_1", name: "pdl_person_enrich", input: {} } },
        { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "checking title..." } },
      ],
      [
        { type: "text", text: "done" },
        { type: "tool_use", id: "toolu_2", name: "submit_findings", input: validContact },
      ],
    );
    // A prior turn's tool result already in history exercises the tool_result cursor.
    const messages = [
      { role: "user", content: "Research the contact." },
      { role: "assistant", content: [{ type: "tool_use", id: "toolu_1", name: "pdl_person_enrich", input: {} }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "{}" }] },
    ];

    const result = await runSubagent(
      { bus, agentKey: "contact", system: "sys", schema: ContactFindings, input: "Research the contact." },
      fakeClient(stream, messages) as any,
    );

    expect(result).toEqual(validContact);

    const types = events.map((e) => e.type);
    expect(types).toContain("agent_started");
    expect(types).toContain("agent_tool_call");
    expect(types).toContain("agent_completed");
    // The tool_call event carries the requested tool name.
    expect(events.find((e) => e.type === "agent_tool_call")?.payload).toEqual({ name: "pdl_person_enrich" });
    // The completed event carries the validated findings.
    expect(events.find((e) => e.type === "agent_completed")?.payload).toEqual(validContact);
    // The prior turn's tool result was surfaced from the runner's history cursor.
    expect(events.find((e) => e.type === "agent_tool_result")?.payload).toEqual({ id: "toolu_1" });
  });

  it("throws when the subagent never calls submit_findings", async () => {
    const { bus } = collectingBus();

    const stream = fakeStream(
      [{ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "I give up" } }],
      [{ type: "text", text: "no tool call here" }],
    );
    const messages = [{ role: "user", content: "Research the contact." }];

    await expect(
      runSubagent(
        { bus, agentKey: "contact", system: "sys", schema: ContactFindings, input: "Research the contact." },
        fakeClient(stream, messages) as any,
      ),
    ).rejects.toThrow(/finished without calling submit_findings/);
  });
});
