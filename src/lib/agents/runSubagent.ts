import { anthropic } from "../anthropic";
import { TOOLS, TOOLSETS, submitTool } from "../tools/registry";
import { MODELS, EFFORT } from "../models";
import type { z } from "zod";

// Minimal event sink; Task 11's RunBus will implement this.
export interface EventSink {
  emit(e: { agent: string; type: string; payload: unknown }): void;
}

export interface RunSubagentOpts {
  bus: EventSink;
  agentKey: string;
  system: string;
  schema: z.ZodTypeAny;
  input: string;
  // Optional overrides. Defaults reproduce the Sonnet subagent behavior; the
  // orchestrator's synthesis step passes Opus config plus adaptive thinking.
  model?: string;
  effort?: string;
  thinking?: unknown;
  toolNames?: string[];
}

/**
 * Drive one subagent as a single Tool Runner invocation. It calls its retrieval
 * tools, then calls `submit_findings` exactly once with its final structured
 * findings; that captured tool input, validated against `schema`, is returned.
 *
 * The Anthropic client is injected so tests can pass a fake (no key required).
 */
export async function runSubagent(opts: RunSubagentOpts, client = anthropic) {
  const {
    bus,
    agentKey,
    system,
    schema,
    input,
    model = MODELS.subagent,
    effort = EFFORT.subagent,
    thinking,
    toolNames = TOOLSETS[agentKey] ?? [],
  } = opts;
  const tools = [...toolNames.map((n) => TOOLS[n as keyof typeof TOOLS]), submitTool(schema)];
  let findings: unknown;

  bus.emit({ agent: agentKey, type: "agent_started", payload: {} });

  const runner = client.beta.messages.toolRunner({
    model,
    max_tokens: 8000,
    output_config: { effort: effort as "low" | "medium" | "high" | "xhigh" | "max" },
    system,
    tools,
    messages: [{ role: "user", content: input }],
    stream: true,
    ...(thinking !== undefined ? { thinking: thinking as any } : {}),
  });

  // The runner appends each executed turn's tool results as a user message to its
  // conversation after our loop body yields control back; a cursor over that
  // accumulated history is the only public surface that exposes tool completions
  // in streaming mode.
  let seenMessages = 0;

  outer: for await (const stream of runner) {
    const history = runner.params?.messages ?? [];
    for (; seenMessages < history.length; seenMessages++) {
      const m = history[seenMessages];
      if (m.role === "user" && Array.isArray(m.content)) {
        for (const b of m.content) {
          if (b.type === "tool_result")
            bus.emit({ agent: agentKey, type: "agent_tool_result", payload: { id: b.tool_use_id } });
        }
      }
    }

    for await (const ev of stream) {
      if (ev.type === "content_block_start" && ev.content_block.type === "tool_use")
        bus.emit({ agent: agentKey, type: "agent_tool_call", payload: { name: ev.content_block.name } });
      if (ev.type === "content_block_delta" && ev.delta.type === "text_delta")
        bus.emit({ agent: agentKey, type: "agent_token", payload: { text: ev.delta.text } });
    }

    // finalMessage() is the assistant turn; the assembled submit_findings input
    // lives on its tool_use block. Record it and stop so the model does not take
    // an extra wrap-up turn.
    const msg = await stream.finalMessage();
    for (const b of msg.content) {
      if (b.type === "tool_use" && b.name === "submit_findings") {
        findings = b.input;
        break outer;
      }
    }
  }

  if (findings === undefined)
    throw new Error(`${agentKey}: subagent finished without calling submit_findings`);

  const parsed = schema.parse(findings);
  bus.emit({ agent: agentKey, type: "agent_completed", payload: parsed });
  return parsed;
}
