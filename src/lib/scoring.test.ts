import { describe, it, expect } from "vitest";
import { score } from "./scoring";
import { DEFAULT_ICP } from "./icp";

const high = { icpFit: { firmographic: 0.95, role: 1, technographic: 0.9, disqualified: false, conflicts: [] },
  engagement: { topActions: ["demo_request","pricing_page_view"], recencyDays: 3 }, verification: { contradictions: [], unsupported: 0 } };
const low = { icpFit: { firmographic: 0.05, role: 0, technographic: 0, disqualified: true, conflicts: ["non-software"] },
  engagement: { topActions: [], recencyDays: 999 }, verification: { contradictions: [], unsupported: 0 } };
const mid = { icpFit: { firmographic: 0.8, role: 0.3, technographic: 0.3, disqualified: false, conflicts: ["stale funding","competitor present"] },
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
  it("a non-disqualifying conflict does not floor fit (old substring bug)", () => {
    // "not engineering" used to substring-match the "no engineering org"
    // disqualifier and floor fit near zero. With disqualified driven only by the
    // explicit boolean, this conflict must leave the raw weighted sum intact.
    const pmConflict = {
      icpFit: { firmographic: 0.8, role: 0.6, technographic: 0.6, disqualified: false, conflicts: ["contact is a PM, not engineering"] },
      engagement: { topActions: ["pricing_page_view"], recencyDays: 10 },
      verification: { contradictions: [], unsupported: 0 },
    };
    const r = score(pmConflict, DEFAULT_ICP);
    // raw = 0.8*0.4 + 0.6*0.3 + 0.6*0.3 = 0.68 -> fit 68, not floored to 10.
    expect(r.fit).toBeGreaterThan(10);
    expect(r.fit).toBe(68);
  });
});
