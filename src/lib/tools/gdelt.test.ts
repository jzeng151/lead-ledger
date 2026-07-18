import { describe, it, expect, vi, afterEach } from "vitest";

import { gdeltNewsSearch, parseSeendate } from "./gdelt";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

describe("parseSeendate", () => {
  it("reads GDELT's YYYYMMDDTHHMMSSZ stamp", () => {
    expect(parseSeendate("20260401T120000Z")?.toISOString()).toBe("2026-04-01T12:00:00.000Z");
    expect(parseSeendate("not-a-date")).toBeNull();
    expect(parseSeendate(undefined)).toBeNull();
  });
});

describe("live news freshness", () => {
  it("marks an old article stale so it cannot claim the full timing lift", async () => {
    vi.stubEnv("LEAD_LEDGER_LIVE_TOOLS", "1");
    const recent = new Date(Date.now() - 10 * 24 * 3600 * 1000);
    const old = new Date(Date.now() - 300 * 24 * 3600 * 1000);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          articles: [
            { seendate: stamp(recent), title: "Raised Series B", url: "https://news.example/new" },
            { seendate: stamp(old), title: "Raised Series A", url: "https://news.example/old" },
            { title: "Undated", url: "https://news.example/undated" },
          ],
        }),
      ),
    );

    const { events } = await gdeltNewsSearch({ domain: "northwind.dev" });

    expect(events.map((e) => e.fresh)).toEqual([true, false, false]);
  });
});
