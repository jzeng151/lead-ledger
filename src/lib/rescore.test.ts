import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";

import { db, schema } from "../db";
import { DEFAULT_ICP } from "./icp";
import { rescoreAll, scoreFromDossier } from "./rescore";

const { runs, scores, dossiers } = schema;

// A dossier shaped like what the orchestrator persists: per-agent partials, the
// verification verdicts, and merged (which carries icpFit).
const dossier = {
  perAgent: {
    engagement: { topActions: [], recencyDays: 999 },
    news: { events: [{ type: "funding", fresh: true }] },
    contact: { identityUnverified: false },
  },
  verification: { claims: [], contradictions: [] },
  merged: { icpFit: { firmographic: 0.9, role: 0.9, technographic: 0.9, disqualified: false, conflicts: [] } },
};

describe("scoreFromDossier", () => {
  it("replays the deterministic scorer from persisted inputs", () => {
    const s = scoreFromDossier(dossier, DEFAULT_ICP);
    expect(s.fit).toBe(90);
    expect(s.grade).toBe("A");
    // fresh funding trigger lifts priority above the fit baseline
    expect(s.priority).toBeGreaterThan(90);
  });

  it("follows changed dials without re-running any agent", () => {
    const strict = { ...DEFAULT_ICP, grades: { A: 95, B: 85, C: 75, D: 65 } };
    expect(scoreFromDossier(dossier, strict).grade).toBe("B"); // fit 90 is no longer an A
  });
});

describe("rescoreAll", () => {
  it("rewrites stored score rows under the new ICP and keeps gate-derived reasons", () => {
    const now = new Date();
    db.insert(runs).values({ id: "rs-run", contactId: "rs-c", status: "scored", startedAt: now }).run();
    db.insert(dossiers).values({ runId: "rs-run", ...dossier }).run();
    db.insert(scores)
      .values({
        runId: "rs-run",
        contactId: "rs-c",
        fit: 90,
        engagement: 0,
        timing: 80,
        priority: 100,
        grade: "A",
        needsReview: true,
        reviewReasons: ["unverified claims in rationale: 1 citation(s) stripped (funding)"],
        citations: [],
      })
      .run();

    const strict = { ...DEFAULT_ICP, grades: { A: 95, B: 85, C: 75, D: 65 } };
    expect(rescoreAll(strict)).toBeGreaterThan(0);

    const row = db.select().from(scores).where(eq(scores.runId, "rs-run")).get();
    expect(row!.grade).toBe("B"); // re-graded under the stricter band
    // the synthesis-stage warning survives a re-score
    expect((row!.reviewReasons as string[]).some((r) => r.startsWith("unverified claims in rationale"))).toBe(true);
  });
});
