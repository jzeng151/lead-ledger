import { describe, it, expect } from "vitest";
import { score } from "./scoring";
import { DEFAULT_ICP } from "./icp";

const high = { icpFit: { firmographic: 0.95, role: 1, technographic: 0.9, conflicts: [] },
  engagement: { topActions: ["demo_request","pricing_page_view"], recencyDays: 3 }, verification: { contradictions: [], unsupported: 0 } };
const low = { icpFit: { firmographic: 0.05, role: 0, technographic: 0, conflicts: ["non-software"] },
  engagement: { topActions: [], recencyDays: 999 }, verification: { contradictions: [], unsupported: 0 } };
const mid = { icpFit: { firmographic: 0.8, role: 0.3, technographic: 0.3, conflicts: ["stale funding","competitor present"] },
  engagement: { topActions: ["pricing_page_view"], recencyDays: 10 }, verification: { contradictions: ["role mismatch"], unsupported: 2 }, identityUnverified: true };

describe("score", () => {
  it("clear high -> A, no review", () => { const r = score(high, DEFAULT_ICP); expect(r.priority).toBeGreaterThanOrEqual(75); expect(r.grade).toBe("A"); expect(r.needsReview).toBe(false); });
  it("clear low -> D", () => { const r = score(low, DEFAULT_ICP); expect(r.priority).toBeLessThan(35); expect(r.grade).toBe("D"); });
  it("ambiguous -> needs review, verification never moved the number", () => {
    const r = score(mid, DEFAULT_ICP);
    expect(r.needsReview).toBe(true);
    expect(r.reviewReasons).toContain("verification contradiction");
    const noVerif = score({ ...mid, verification: { contradictions: [], unsupported: 0 } }, DEFAULT_ICP);
    expect(r.priority).toBe(noVerif.priority); // verification flags, never scores
  });
});
