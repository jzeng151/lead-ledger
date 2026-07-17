import { describe, it, expect } from "vitest";
import { z } from "zod";
import { TOOLS, TOOLSETS, submitTool } from "./registry";

describe("tool registry", () => {
  it("every toolset name references a real TOOLS key", () => {
    for (const [agent, names] of Object.entries(TOOLSETS)) {
      for (const name of names) {
        expect(TOOLS, `${agent} references unknown tool "${name}"`).toHaveProperty(name);
      }
    }
  });

  it("each TOOLS[name].name matches its key", () => {
    for (const [name, tool] of Object.entries(TOOLS)) {
      expect(tool.name).toBe(name);
    }
  });

  it("submitTool builds a tool without throwing", () => {
    expect(() => submitTool(z.object({ a: z.string() }))).not.toThrow();
    expect(submitTool(z.object({ a: z.string() })).name).toBe("submit_findings");
  });
});
