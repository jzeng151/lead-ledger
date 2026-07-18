import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";

import { db, schema } from "../db";
import { DEFAULT_ICP } from "./icp";
import { rescoreAll, scoreFromDossier } from "./rescore";

const { runs, scores, dossiers, writebacks } = schema;

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

describe("rescoreAll write-back sync", () => {
  const now = new Date();

  it("reopens a written contact whose values moved, and refreshes a pending payload", () => {
    db.insert(runs).values({ id: "wb-run", contactId: "wb-c", status: "scored", startedAt: now }).run();
    db.insert(dossiers).values({ runId: "wb-run", ...dossier }).run();
    db.insert(scores)
      .values({ runId: "wb-run", contactId: "wb-c", fit: 90, engagement: 0, timing: 80, priority: 100, grade: "A", needsReview: false, reviewReasons: [], citations: [] })
      .run();
    // Already written to HubSpot under the old dials.
    db.insert(writebacks)
      .values({
        contactId: "wb-c",
        status: "written",
        payload: { properties: { lead_priority_score: 100, lead_grade: "A" }, note: "old note" },
        approvedAt: now,
        writtenAt: now,
      })
      .run();

    rescoreAll({ ...DEFAULT_ICP, grades: { A: 95, B: 85, C: 75, D: 65 } });

    const wb = db.select().from(writebacks).where(eq(writebacks.contactId, "wb-c")).get()!;
    expect(wb.status).toBe("pending"); // HubSpot holds a stale grade, so approval reopens
    expect((wb.payload as any).properties.lead_grade).toBe("B");
    expect((wb.payload as any).note).toBe("old note"); // rationale is not recomputed here
    expect(wb.writtenAt).toBeNull();
  });

  it("leaves a skipped contact alone", () => {
    db.insert(runs).values({ id: "wb-skip-run", contactId: "wb-skip", status: "scored", startedAt: now }).run();
    db.insert(dossiers).values({ runId: "wb-skip-run", ...dossier }).run();
    db.insert(scores)
      .values({ runId: "wb-skip-run", contactId: "wb-skip", fit: 90, engagement: 0, timing: 80, priority: 100, grade: "A", needsReview: false, reviewReasons: [], citations: [] })
      .run();
    db.insert(writebacks).values({ contactId: "wb-skip", status: "skipped", payload: null, approvedAt: now }).run();

    rescoreAll({ ...DEFAULT_ICP, grades: { A: 95, B: 85, C: 75, D: 65 } });

    // A skip is a human decision, not a stale score.
    expect(db.select().from(writebacks).where(eq(writebacks.contactId, "wb-skip")).get()?.status).toBe("skipped");
  });
});

describe("rescoreAll: review status alone reopens a written row", () => {
  it("reopens when the values hold but the contact now needs review", () => {
    const now = new Date();
    db.insert(runs).values({ id: "wb-rev-run", contactId: "wb-rev", status: "scored", startedAt: now }).run();
    db.insert(dossiers).values({ runId: "wb-rev-run", ...dossier }).run();
    db.insert(scores)
      .values({ runId: "wb-rev-run", contactId: "wb-rev", fit: 90, engagement: 0, timing: 80, priority: 100, grade: "A", needsReview: false, reviewReasons: [], citations: [] })
      .run();
    db.insert(writebacks)
      .values({
        contactId: "wb-rev",
        status: "written",
        payload: { properties: { lead_priority_score: 100, lead_grade: "A" }, note: "n" },
        approvedAt: now,
        writtenAt: now,
      })
      .run();

    // Move the review band over this priority: same numbers, but it now needs a
    // human look. The queue ranks "written" above needsReview, so leaving the row
    // written would hide it from the Needs review tab entirely.
    rescoreAll({ ...DEFAULT_ICP, reviewBand: [95, 100] });

    const wb = db.select().from(writebacks).where(eq(writebacks.contactId, "wb-rev")).get()!;
    expect(wb.status).toBe("pending");
    expect((wb.payload as any).properties.lead_priority_score).toBe(100); // values unchanged
  });
});

describe("rescoreAll: an approved needs-review contact is left alone", () => {
  it("does not reopen a written row that already needed review when it was approved", () => {
    const now = new Date();
    db.insert(runs).values({ id: "wb-keep-run", contactId: "wb-keep", status: "scored", startedAt: now }).run();
    db.insert(dossiers).values({ runId: "wb-keep-run", ...dossier }).run();
    // Flagged at the time the rep approved it anyway (individual approval is
    // allowed for needs-review leads).
    db.insert(scores)
      .values({ runId: "wb-keep-run", contactId: "wb-keep", fit: 90, engagement: 0, timing: 80, priority: 100, grade: "A", needsReview: true, reviewReasons: ["identity unverified: x"], citations: [] })
      .run();
    db.insert(writebacks)
      .values({
        contactId: "wb-keep",
        status: "written",
        payload: { properties: { lead_priority_score: 100, lead_grade: "A" }, note: "n" },
        approvedAt: now,
        writtenAt: now,
      })
      .run();

    // An unrelated settings save: same values, still flagged. Re-raising it here
    // would undo the human's call on every future save.
    rescoreAll(DEFAULT_ICP);

    expect(db.select().from(writebacks).where(eq(writebacks.contactId, "wb-keep")).get()?.status).toBe("written");
  });
});

describe("rescoreAll: contradicted claims survive", () => {
  it("keeps a run flagged when the contradiction lives only on the claim", () => {
    const now = new Date();
    const contradicted = {
      ...dossier,
      // The verifier put the detail in the claim note and left contradictions[] empty.
      verification: { claims: [{ claimId: "industry", verdict: "contradicted", note: "sells freight" }], contradictions: [] },
    };
    db.insert(runs).values({ id: "rs-contra-run", contactId: "rs-contra", status: "scored", startedAt: now }).run();
    db.insert(dossiers).values({ runId: "rs-contra-run", ...contradicted }).run();
    db.insert(scores)
      .values({ runId: "rs-contra-run", contactId: "rs-contra", fit: 90, engagement: 0, timing: 80, priority: 100, grade: "A", needsReview: true, reviewReasons: ["verification contradiction: industry: sells freight"], citations: [] })
      .run();

    rescoreAll(DEFAULT_ICP);

    const row = db.select().from(scores).where(eq(scores.runId, "rs-contra-run")).get()!;
    expect(row.needsReview).toBe(true);
    expect((row.reviewReasons as string[]).some((r) => r.startsWith("verification contradiction"))).toBe(true);
  });
});

describe("rescoreAll: reason carrying and run ties", () => {
  it("keeps the uncited-rationale warning across a settings save", () => {
    const now = new Date();
    db.insert(runs).values({ id: "rs-unc-run", contactId: "rs-unc", status: "scored", startedAt: now }).run();
    db.insert(dossiers).values({ runId: "rs-unc-run", ...dossier }).run();
    db.insert(scores)
      .values({ runId: "rs-unc-run", contactId: "rs-unc", fit: 90, engagement: 0, timing: 80, priority: 100, grade: "A", needsReview: true, reviewReasons: ["uncited rationale: the verdict cites no dossier field"], citations: [] })
      .run();

    rescoreAll(DEFAULT_ICP);

    const row = db.select().from(scores).where(eq(scores.runId, "rs-unc-run")).get()!;
    // Dropping it would clear needsReview and make unbacked prose approvable.
    expect(row.needsReview).toBe(true);
    expect((row.reviewReasons as string[]).some((r) => r.startsWith("uncited rationale"))).toBe(true);
  });

  it("stages the newer of two runs that share a stored second", () => {
    // Both runs land in the same SQLite second; only the runId distinguishes them.
    const sameSecond = new Date(1_700_000_000_000);
    for (const [id, fitAxis] of [["rs-tie-1000", 0.9], ["rs-tie-2000", 0.6]] as const) {
      db.insert(runs).values({ id, contactId: "rs-tie", status: "scored", startedAt: sameSecond }).run();
      db.insert(dossiers)
        .values({
          runId: id,
          ...dossier,
          merged: { icpFit: { firmographic: fitAxis, role: fitAxis, technographic: fitAxis, disqualified: false, conflicts: [] } },
        })
        .run();
      db.insert(scores)
        .values({ runId: id, contactId: "rs-tie", fit: 0, engagement: 0, timing: 0, priority: 0, grade: "F", needsReview: false, reviewReasons: [], citations: [] })
        .run();
    }
    db.insert(writebacks)
      .values({ contactId: "rs-tie", status: "pending", payload: { properties: { lead_priority_score: 1, lead_grade: "F" }, note: "" } })
      .run();

    rescoreAll(DEFAULT_ICP);

    // rs-tie-2000 sorts last, so its verdict (fit 60 -> D) is the staged one.
    expect((db.select().from(writebacks).where(eq(writebacks.contactId, "rs-tie")).get()!.payload as any).properties.lead_grade).toBe("D");
  });
});
