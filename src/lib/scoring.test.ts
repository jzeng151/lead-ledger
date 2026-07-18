import { describe, it, expect } from "vitest";
import { score, computeTiming, classifyTrigger } from "./scoring";
import { DEFAULT_ICP } from "./icp";

const fit = (v: number) => ({ firmographic: v, role: v, technographic: v, disqualified: false, conflicts: [] });
const noVerif = { contradictions: [], unsupported: 0 };

describe("score: grade reflects fit only (US academic scale)", () => {
  const bands: [number, string][] = [
    [0.9, "A"],
    [0.8, "B"],
    [0.7, "C"],
    [0.6, "D"],
    [0.59, "F"],
  ];
  for (const [v, grade] of bands) {
    it(`fit ${Math.round(v * 100)} -> ${grade}`, () => {
      const r = score({ icpFit: fit(v), engagement: {}, verification: noVerif }, DEFAULT_ICP);
      expect(r.fit).toBe(Math.round(v * 100));
      expect(r.grade).toBe(grade);
    });
  }
});

describe("score: cold leads are not capped, urgency only lifts from the fit baseline", () => {
  it("cold great-fit lead scores its fit and grades A (the whole point)", () => {
    const r = score({ icpFit: fit(0.9), engagement: { topActions: [], recencyDays: 999 }, verification: noVerif }, DEFAULT_ICP);
    expect(r.fit).toBe(90);
    expect(r.priority).toBe(90); // no engagement, no news -> no lift
    expect(r.grade).toBe("A");
  });

  it("a fresh funding trigger lifts a cold mid-fit lead above its fit", () => {
    const base = score({ icpFit: fit(0.7), engagement: {}, verification: noVerif }, DEFAULT_ICP);
    const withNews = score(
      { icpFit: fit(0.7), engagement: {}, verification: noVerif, news: { events: [{ type: "funding", fresh: true }] } },
      DEFAULT_ICP,
    );
    expect(base.priority).toBe(70);
    // timing 0.8 -> lift 20*0.8 = 16
    expect(withNews.priority).toBe(86);
    expect(withNews.grade).toBe("C"); // grade is fit-based, unchanged by the lift
  });
});

describe("score: negative triggers dampen but are floored", () => {
  it("fresh layoffs pull priority below fit, but only modestly", () => {
    const r = score(
      { icpFit: fit(0.9), engagement: {}, verification: noVerif, news: { events: [{ type: "layoffs", fresh: true }] } },
      DEFAULT_ICP,
    );
    expect(r.priority).toBe(84); // 90 + 20*(-0.3)
    expect(r.grade).toBe("A"); // fit unchanged
  });

  it("a pile of bad news cannot pull priority more than liftMax*floor below fit", () => {
    const r = score(
      {
        icpFit: fit(0.9),
        engagement: {},
        verification: noVerif,
        news: { events: Array.from({ length: 5 }, () => ({ type: "layoffs", fresh: true })) },
      },
      DEFAULT_ICP,
    );
    expect(r.priority).toBe(80); // floor -0.5 -> 90 - 10, not lower
  });
});

describe("score: disqualified and verification behavior", () => {
  it("disqualified floors fit -> F, low priority", () => {
    const r = score(
      { icpFit: { firmographic: 0.05, role: 0, technographic: 0, disqualified: true, conflicts: [] }, engagement: {}, verification: noVerif },
      DEFAULT_ICP,
    );
    expect(r.grade).toBe("F");
    expect(r.priority).toBeLessThan(35);
  });

  it("verification flags for review but never moves the number", () => {
    const base = { icpFit: fit(0.5), engagement: { topActions: ["pricing_page_view"], recencyDays: 10 } };
    const flagged = score({ ...base, verification: { contradictions: ["role mismatch"], unsupported: 2 } }, DEFAULT_ICP);
    const clean = score({ ...base, verification: noVerif }, DEFAULT_ICP);
    expect(flagged.needsReview).toBe(true);
    expect(flagged.reviewReasons).toContain("verification contradiction");
    expect(flagged.priority).toBe(clean.priority);
  });

  it("a non-disqualifying conflict does not floor fit (old substring bug)", () => {
    const r = score(
      { icpFit: { firmographic: 0.8, role: 0.6, technographic: 0.6, disqualified: false, conflicts: ["contact is a PM, not engineering"] }, engagement: {}, verification: noVerif },
      DEFAULT_ICP,
    );
    expect(r.fit).toBe(68); // 0.8*0.4 + 0.6*0.3 + 0.6*0.3 = 0.68
  });
});

describe("computeTiming / classifyTrigger", () => {
  it("classifies free-form event types, including distress signals", () => {
    expect(classifyTrigger("Series B funding")).toBe("funding");
    expect(classifyTrigger("down round")).toBe("down_round");
    expect(classifyTrigger("new CTO hired")).toBe("exec_hire");
    expect(classifyTrigger("major outage")).toBe("incident");
    expect(classifyTrigger("acquired by BigCo")).toBe("mna");
    expect(classifyTrigger("product launch")).toBe("product_launch");
    expect(classifyTrigger("office expansion")).toBe("expansion");
    expect(classifyTrigger("layoffs announced")).toBe("layoffs");
    expect(classifyTrigger("quarterly webinar")).toBe("default");
  });

  it("is signed and clamped to [-1, 1], with stale events discounted", () => {
    expect(computeTiming({ events: [{ type: "funding", fresh: true }] }, DEFAULT_ICP)).toBeCloseTo(0.8);
    expect(computeTiming({ events: [{ type: "funding", fresh: false }] }, DEFAULT_ICP)).toBeCloseTo(0.32); // 0.8 * staleFactor 0.4
    expect(computeTiming({ events: [{ type: "layoffs", fresh: true }] }, DEFAULT_ICP)).toBeCloseTo(-0.3);
    expect(computeTiming({ events: [{ type: "funding", fresh: true }, { type: "funding", fresh: true }] }, DEFAULT_ICP)).toBe(1);
    expect(computeTiming({ events: [] }, DEFAULT_ICP)).toBe(0);
  });
});
