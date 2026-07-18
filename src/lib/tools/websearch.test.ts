import { describe, it, expect, vi, afterEach } from "vitest";
import { ageInDays, webSearch } from "./websearch";

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

describe("live result freshness", () => {
  it("reads absolute and relative dates, and treats an unreadable one as stale", () => {
    const now = Date.parse("2026-07-18T00:00:00Z");
    expect(ageInDays("Jul 8, 2026", now)).toBeCloseTo(10, 0);
    expect(ageInDays("3 days ago", now)).toBe(3);
    expect(ageInDays("2 months ago", now)).toBe(60);
    expect(ageInDays("last spring", now)).toBeNull();
    expect(ageInDays(undefined, now)).toBeNull();
  });

  it("only marks a recent result fresh", async () => {
    vi.stubEnv("SERPAPI_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          news_results: [
            { title: "Raised Series B", link: "https://n/1", date: "5 days ago" },
            { title: "Raised Series A", link: "https://n/2", date: "14 months ago" },
            { title: "Undated", link: "https://n/3" },
          ],
        }),
      ),
    );

    const { events } = await webSearch("northwind.dev funding");

    // A year-old round must not claim the same timing lift as last week's.
    expect(events.map((e) => e.fresh)).toEqual([true, false, false]);
  });
});
