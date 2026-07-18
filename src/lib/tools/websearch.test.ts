import { describe, it, expect, vi, afterEach } from "vitest";
import { webSearch } from "./websearch";

// No SERPAPI_KEY in the test env, so these exercise the fixture path.
describe("webSearch fixture resolution", () => {
  it("resolves the news fixture from an explicit domain argument", async () => {
    const { events } = await webSearch("any query", "northwind.dev");
    expect(events.length).toBeGreaterThan(0);
  });

  it("extracts the domain from a natural-language query so the fixture still resolves", async () => {
    const { events } = await webSearch("Northwind Labs funding OR hire OR launch northwind.dev");
    expect(events.length).toBeGreaterThan(0);
  });

  it("returns empty when neither a domain arg nor a domain in the query is present", async () => {
    const { events } = await webSearch("Northwind Labs funding OR hire OR launch");
    expect(events).toEqual([]);
  });
});

describe("webSearch demo mode", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("uses the fixture even when SERPAPI_KEY is set", async () => {
    vi.stubEnv("SERPAPI_KEY", "test-key");
    vi.stubEnv("LEAD_LEDGER_DEMO", "1");
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);

    await webSearch("northwind.dev funding");

    expect(spy).not.toHaveBeenCalled(); // a live lookup would break repeatable demo scoring
  });
});
