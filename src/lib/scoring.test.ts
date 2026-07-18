import { describe, it, expect } from "vitest";
import { score, computeTiming, classifyTrigger, computeEngagement } from "./scoring";
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
    // The reason carries the specific contradiction, not just a category label.
    const contradiction = flagged.reviewReasons.find((r) => r.startsWith("verification contradiction"));
    expect(contradiction).toBeDefined();
    expect(contradiction).toContain("role mismatch");
    expect(flagged.priority).toBe(clean.priority);
  });

  it("surfaces uncertain engagement attribution as its own review reason", () => {
    const r = score(
      {
        icpFit: fit(0.8),
        engagement: { topActions: ["demo_request"], recencyDays: 5, attributionUncertain: true },
        verification: noVerif,
      },
      DEFAULT_ICP,
    );
    expect(r.needsReview).toBe(true);
    expect(r.reviewReasons.some((x) => x.startsWith("engagement attribution uncertain"))).toBe(true);
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

describe("computeEngagement: decay dial is clamped", () => {
  it("survives an out-of-range engagementDecayPerMonth from the ICP editor", () => {
    // A decay above 1 makes the pow base negative; fractional months then yield
    // NaN, which used to flow straight through engagement into priority.
    const broken = { ...DEFAULT_ICP, engagementDecayPerMonth: 1.5 };
    const e = { topActions: ["demo_request"], recencyDays: 45 };
    expect(computeEngagement(e, broken)).toBe(0);

    const r = score({ icpFit: fit(0.9), engagement: e, verification: noVerif }, broken);
    expect(Number.isNaN(r.engagement)).toBe(false);
    expect(Number.isNaN(r.priority)).toBe(false);
  });

  it("a negative decay dial does not inflate engagement", () => {
    const e = { topActions: ["demo_request"], recencyDays: 30 };
    expect(computeEngagement(e, { ...DEFAULT_ICP, engagementDecayPerMonth: -2 })).toBe(30);
  });
});

describe("computeFit: axis values are bounded", () => {
  it("clamps an out-of-scale axis from a legacy dossier instead of scoring past 100", () => {
    // A 0-100 answer where the scorer expects 0-1. The schema now rejects this on
    // a live run, but a re-score replays dossiers persisted before that guard.
    const r = score(
      { icpFit: { firmographic: 80, role: 70, technographic: 60, disqualified: false, conflicts: [] }, engagement: {}, verification: noVerif },
      DEFAULT_ICP,
    );
    expect(r.fit).toBe(100);
    expect(r.priority).toBeLessThanOrEqual(100);
  });

  it("treats a missing icpFit as zero fit rather than NaN", () => {
    const r = score({ icpFit: {}, engagement: {}, verification: noVerif }, DEFAULT_ICP);
    expect(r.fit).toBe(0);
    expect(r.grade).toBe("F");
    expect(Number.isNaN(r.priority)).toBe(false);
  });
});

describe("computeFit: weights that do not sum to 1", () => {
  it("keeps fit on the 0-100 scale", () => {
    const heavy = { ...DEFAULT_ICP, weights: { firmographic: 1, role: 1, technographic: 1 } };
    const r = score({ icpFit: fit(0.9), engagement: {}, verification: noVerif }, heavy);
    expect(r.fit).toBe(100); // 0.9*3 would otherwise persist as 270
    expect(r.grade).toBe("A");
  });

  it("does not go negative on inverted weights", () => {
    const inverted = { ...DEFAULT_ICP, weights: { firmographic: -1, role: 0.3, technographic: 0.3 } };
    expect(score({ icpFit: fit(0.8), engagement: {}, verification: noVerif }, inverted).fit).toBe(0);
  });
});
