import { describe, it, expect, vi, afterEach } from "vitest";

import { detectTechStack } from "./techstack";

const html = (body: string) => vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status: 200 })));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("detectTechStack live scan", () => {
  it("reports a competitor whose script is on the page, not a bare framework negative", async () => {
    vi.stubEnv("LEAD_LEDGER_LIVE_TOOLS", "1");
    html('<html><script src="/_next/static/x.js"></script><script src="https://www.datadoghq-browser-agent.com/rum.js"></script></html>');

    const t = await detectTechStack("northwind.dev");

    expect(t.competitorPresent.value).toBe(true);
    expect(t.competitorEvidence).toContain("Datadog");
    expect(t.technologies).toContain("Next.js");
    expect(t.technologies).toContain("Datadog");
  });

  it("keeps a competitor-free page as a low-confidence negative", async () => {
    vi.stubEnv("LEAD_LEDGER_LIVE_TOOLS", "1");
    html('<html><script src="/_next/static/x.js"></script></html>');

    const t = await detectTechStack("northwind.dev");

    expect(t.competitorPresent.value).toBe(false);
    expect(t.competitorPresent.confidence).toBeLessThan(0.5); // one page is weak evidence of absence
    expect(t.competitorEvidence).toBeNull();
  });
});
