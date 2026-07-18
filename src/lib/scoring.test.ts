import { describe, it, expect } from "vitest";
import { score, computeTiming, classifyTrigger, computeEngagement, isFreshEvent } from "./scoring";
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

describe("review band", () => {
  it("still flags an ambiguous score when the band is saved reversed", () => {
    // The editor exposes the bounds as two independent fields, so [65, 45] is an
    // easy mis-edit. Unsorted, it matched no priority and every ambiguous lead
    // became batch-approvable.
    const reversed = { ...DEFAULT_ICP, reviewBand: [65, 45] as [number, number] };
    const r = score({ icpFit: fit(0.55), engagement: {}, verification: noVerif }, reversed);
    expect(r.priority).toBeGreaterThanOrEqual(45);
    expect(r.priority).toBeLessThanOrEqual(65);
    expect(r.reviewReasons.some((x) => x.startsWith("ambiguous score band"))).toBe(true);
  });
});

describe("grade cutoffs and recency guards", () => {
  it("orders cutoffs saved out of sequence instead of inflating the letter", () => {
    // A:50 B:80 saved by mis-editing independent fields. Unsorted, the
    // first-match chain graded a 60-fit contact an A. Sorted, the four cutoffs
    // read as D:50 C:60 B:70 A:80, so a 60 is a C.
    const swapped = { ...DEFAULT_ICP, grades: { A: 50, B: 80, C: 70, D: 60 } };
    expect(score({ icpFit: fit(0.6), engagement: {}, verification: noVerif }, swapped).grade).toBe("C");
    expect(score({ icpFit: fit(0.85), engagement: {}, verification: noVerif }, swapped).grade).toBe("A");
  });

  it("does not let a negative recency push engagement past 100", () => {
    // A future timestamp upstream made the decay multiplier exceed 1.
    const e = { topActions: ["demo_request", "pricing_page_view"], recencyDays: -90 };
    const v = computeEngagement(e, DEFAULT_ICP);
    expect(v).toBeLessThanOrEqual(100);
    expect(v).toBe(50); // treated as same-day, no decay applied
  });
});

describe("unresolved verification", () => {
  it("flags a cluster of uncertain verdicts", () => {
    // Uncertain claims are never stripped (nothing rejected them), so without a
    // reason they leave no trace and the lead is batch-approvable.
    const r = score(
      { icpFit: fit(0.9), engagement: {}, verification: { contradictions: [], unsupported: 0, uncertain: 3 } },
      DEFAULT_ICP,
    );
    expect(r.reviewReasons.some((x) => x.startsWith("unresolved verification"))).toBe(true);
  });

  it("lets a single uncertain claim pass", () => {
    const r = score(
      { icpFit: fit(0.9), engagement: {}, verification: { contradictions: [], unsupported: 0, uncertain: 1 } },
      DEFAULT_ICP,
    );
    expect(r.reviewReasons.some((x) => x.startsWith("unresolved verification"))).toBe(false);
  });
});

describe("isFreshEvent", () => {
  it("lets the event date override a stale fresh flag", () => {
    const now = Date.parse("2026-07-18T00:00:00Z");
    // A flag is a claim made when the item was retrieved; it does not age, so a
    // months-old event kept collecting the full urgency weight.
    expect(isFreshEvent({ date: "2026-03-01", fresh: true }, now)).toBe(false);
    expect(isFreshEvent({ date: "2026-06-15", fresh: true }, now)).toBe(true);
    expect(isFreshEvent({ date: "2026-06-15", fresh: false }, now)).toBe(true);
  });

  it("falls back to the flag when the event carries no usable date", () => {
    expect(isFreshEvent({ fresh: true })).toBe(true);
    expect(isFreshEvent({ date: "last spring", fresh: false })).toBe(false);
  });

  it("discounts an aged trigger in the timing sum", () => {
    const aged = computeTiming({ events: [{ type: "funding", date: "2025-01-01", fresh: true }] }, DEFAULT_ICP);
    expect(aged).toBeCloseTo(0.32); // 0.8 * staleFactor, not the full 0.8
  });
});

describe("classifyTrigger: hiring is not an exec hire", () => {
  it("routes generic hiring to expansion and leadership hires to exec_hire", () => {
    // A bare "hire" used to match the exec-hire branch first, so ordinary hiring
    // took weight 0.7 instead of 0.4 and inflated priority.
    expect(classifyTrigger("hiring spree")).toBe("expansion");
    expect(classifyTrigger("hiring 40 engineers")).toBe("expansion");
    expect(classifyTrigger("new CTO hired")).toBe("exec_hire");
    expect(classifyTrigger("hires VP of Engineering")).toBe("exec_hire");
  });

  it("weights them differently", () => {
    const hiring = computeTiming({ events: [{ type: "hiring spree", fresh: true }] }, DEFAULT_ICP);
    const execHire = computeTiming({ events: [{ type: "new CTO hired", fresh: true }] }, DEFAULT_ICP);
    expect(hiring).toBeCloseTo(0.4);
    expect(execHire).toBeCloseTo(0.7);
  });
});
