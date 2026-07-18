import { describe, it, expect } from "vitest";
import { withTrace, withTool, type ToolTrace } from "./adapter";
import { pdlCompanyEnrich } from "./pdl";
import { traceLines } from "../liveViewModel";

describe("source trace context (adapter)", () => {
  it("records a fixture read with its exact path and found sections when a tool runs in scope", async () => {
    const got: ToolTrace[] = [];
    await withTrace(
      (t) => got.push(t),
      () => withTool("pdl_company_enrich", "northwind.dev", () => pdlCompanyEnrich("northwind.dev")),
    );
    const fx = got.find((t) => t.mode === "fixture");
    expect(fx?.tool).toBe("pdl_company_enrich");
    expect(fx?.location).toBe("src/fixtures/enrichment/northwind.dev.json");
    expect(fx?.outcome).toBe("found");
    expect(fx?.detail).toContain("company");
  });

  it("records an empty outcome when the fixture file is missing", async () => {
    const got: ToolTrace[] = [];
    await withTrace(
      (t) => got.push(t),
      () => withTool("pdl_company_enrich", "nope.example", () => pdlCompanyEnrich("nope.example")),
    );
    const fx = got.find((t) => t.mode === "fixture");
    expect(fx?.outcome).toBe("empty");
    expect(fx?.detail).toContain("file not found");
  });

  it("is a no-op outside a trace scope (direct calls in tests do not throw)", async () => {
    await expect(pdlCompanyEnrich("northwind.dev")).resolves.toBeDefined();
  });
});

describe("traceLines renders tool_source events", () => {
  it("shows a fixture read as an indented source line", () => {
    const lines = traceLines([
      { agent: "company", type: "agent_tool_call", payload: { name: "pdl_company_enrich" } },
      {
        agent: "company",
        type: "tool_source",
        payload: { tool: "pdl_company_enrich", mode: "fixture", location: "src/fixtures/enrichment/northwind.dev.json", outcome: "found", detail: "sections: company, person" },
      },
    ]);
    const src = lines.find((l) => l.kind === "source");
    expect(src?.text).toContain("read src/fixtures/enrichment/northwind.dev.json");
    expect(src?.text).toContain("✓");
  });

  it("renders a failed live call as an error line with the status", () => {
    const lines = traceLines([
      { agent: "tech", type: "tool_source", payload: { mode: "live", location: "https://api.example.com/x", outcome: "error", detail: "timeout" } },
    ]);
    expect(lines[0].kind).toBe("error");
    expect(lines[0].text).toContain("api.example.com");
  });
});
