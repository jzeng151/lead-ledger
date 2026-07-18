import { describe, it, expect, vi, afterEach } from "vitest";

import { detectTechStack } from "./techstack";

// The live path resolves the hostname before fetching; northwind.dev is fictional.
vi.mock("node:dns/promises", () => ({
  default: { lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]) },
}));

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
    // Field-shaped so the agent can forward it into submit_findings as-is.
    expect(t.competitorEvidence?.value).toContain("Datadog");
    expect(t.competitorEvidence?.source).toBe("https://northwind.dev");
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

describe("live scan gating and negatives", () => {
  it("stays on fixtures in demo mode even with live tools enabled", async () => {
    vi.stubEnv("LEAD_LEDGER_LIVE_TOOLS", "1");
    vi.stubEnv("LEAD_LEDGER_DEMO", "1");
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);

    // The demo domains are fictional; fingerprinting them hits whoever really
    // owns them and feeds non-fixture evidence into a showcase run.
    const t = await detectTechStack("northwind.dev");

    expect(spy).not.toHaveBeenCalled();
    expect(t.competitorPresent.source).toBe("fixture:techstack");
  });

  it("keeps a live negative instead of falling back to a fixture", async () => {
    vi.stubEnv("LEAD_LEDGER_LIVE_TOOLS", "1");
    html("<html><body>plain marketing site</body></html>");

    // A domain with no fixture: the scan found nothing, which is itself the
    // finding. Falling through reported competitorPresent: null from a fixture
    // that does not exist.
    const t = await detectTechStack("no-fixture.example");

    expect(t.competitorPresent.value).toBe(false);
    expect(t.competitorPresent.source).toBe("https://no-fixture.example");
  });
});
