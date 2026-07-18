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

describe("persisted dates", () => {
  it("stores an absolute date the re-scorer can still read", async () => {
    vi.stubEnv("LEAD_LEDGER_LIVE_TOOLS", "1");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ articles: [{ seendate: "20260615T120000Z", title: "Raised", url: "https://n/1" }] })),
    );

    const { events } = await gdeltNewsSearch({ domain: "northwind.dev" });

    // GDELT's own stamp is not parseable, so a re-score months later would fall
    // back to the fresh flag and hand this full urgency forever.
    expect(events[0].date).toBe("2026-06-15T12:00:00.000Z");
    expect(Number.isNaN(Date.parse(events[0].date))).toBe(false);
  });
});
