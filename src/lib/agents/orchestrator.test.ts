import { describe, it, expect, beforeAll } from "vitest";
import { eq } from "drizzle-orm";

import { db, schema } from "../../db";
import { DEFAULT_ICP } from "../icp";
import { score } from "../scoring";
import { runContact, type OrchestratorDeps } from "./orchestrator";

const RUN_ID = "run-orch-test";
const CONTACT_ID = "c-test-orch";

// A field-shaped value: {value, confidence, source}. mergeSources keys off these.
const f = (value: unknown, source: string) => ({ value, confidence: 0.8, source });

// Canned subagent output keyed by agentKey. This replaces the real Tool Runner,
// so no key or network is touched. company exposes `industry` (a ref that should
// survive the gate) and `funding` (a ref verification will reject); news carries
// one event so the `news_0` ref is citeable.
const fakeRunSub: OrchestratorDeps["runSub"] = (async (opts: { agentKey: string }) => {
  switch (opts.agentKey) {
    case "company":
      return { industry: f("software", "pdl_company_enrich"), funding: f("Series B", "pdl_company_enrich"), headcount: f(120, "pdl_company_enrich") };
    case "contact":
      return { title: f("VP Engineering", "pdl_person_enrich"), identityUnverified: true };
    case "tech":
      return { technologies: ["Datadog"], competitorPresent: f(true, "detect_tech_stack") };
    case "news":
      return { events: [{ date: "2026-05-01", type: "funding", summary: "Raised Series B", source: "https://news.example/1", talkingPoint: "Congrats on the raise", fresh: true }] };
    case "engagement":
      return { topActions: [], recencyDays: 10, rawSignals: [], attributionUncertain: false };
    case "verification":
      return {
        claims: [{ claimId: "funding", verdict: "unsupported", adjustedConfidence: 0.2, note: "x" }],
        contradictions: ["role mismatch"],
      };
    case "icpfit":
      return { firmographic: 0.8, role: 0.3, technographic: 0.3, disqualified: false, dimensions: [], conflicts: ["stale funding", "competitor present"] };
    default:
      throw new Error(`unexpected agentKey ${opts.agentKey}`);
  }
}) as unknown as OrchestratorDeps["runSub"];

const fakeSynthesize: OrchestratorDeps["synthesize"] = async () => ({
  rationale: "Funded dev-tools shop, but funding claim is unverified.",
  nextStep: "Confirm the round before outreach.",
  citations: [
    { text: "Series B", ref: "funding" }, // rejected by verification -> stripped
    { text: "nope", ref: "nonexistent" }, // no dossier field -> stripped
    { text: "a software company", ref: "industry" }, // sourced + not rejected -> kept
    { text: "raised a round", ref: "news_0" }, // trigger event source -> kept
  ],
});

const fakeDeps: OrchestratorDeps = { runSub: fakeRunSub, synthesize: fakeSynthesize };

beforeAll(() => {
  db.insert(schema.contacts)
    .values({ id: CONTACT_ID, name: "Test Orch", companyName: "Northwind", companyDomain: "northwind.dev", props: {}, syncedAt: new Date() })
    .onConflictDoNothing()
    .run();
  db.insert(schema.icpConfig).values({ id: "default", config: DEFAULT_ICP }).onConflictDoNothing().run();
});

describe("runContact", () => {
  it("fans out, scores, gates citations, and persists (no key required)", async () => {
    await runContact(RUN_ID, CONTACT_ID, fakeDeps);

    const scoreRow = db.select().from(schema.scores).where(eq(schema.scores.runId, RUN_ID)).get();
    expect(scoreRow).toBeTruthy();
    expect(scoreRow!.needsReview).toBe(true);
    // Reasons carry their specifics, so match the label prefix.
    expect((scoreRow!.reviewReasons as string[]).some((r) => r.startsWith("verification contradiction"))).toBe(true);

    // Numeric scores must equal the real scorer on the same canned inputs (which
    // include the news trigger the orchestrator passes through), so a swapped
    // score() argument cannot pass silently. For this dossier: fit 50, engagement
    // 0, timing +80 (fresh funding), priority 66, grade F.
    const expected = score(
      {
        icpFit: { firmographic: 0.8, role: 0.3, technographic: 0.3, disqualified: false, dimensions: [], conflicts: ["stale funding", "competitor present"] },
        engagement: { topActions: [], recencyDays: 10, rawSignals: [], attributionUncertain: false },
        news: { events: [{ type: "funding", fresh: true }] },
        verification: { contradictions: ["role mismatch"], unsupported: 1 },
        identityUnverified: true,
      },
      DEFAULT_ICP,
    );
    expect(scoreRow!.fit).toBe(expected.fit);
    expect(scoreRow!.engagement).toBe(expected.engagement);
    expect(scoreRow!.timing).toBe(expected.timing);
    expect(scoreRow!.priority).toBe(expected.priority);
    expect(scoreRow!.grade).toBe(expected.grade);

    // Citation gate: "nonexistent" (no dossier field) and "funding" (rejected by
    // verification) are stripped; "industry" (sourced, not rejected) and "news_0"
    // (a trigger event's source) survive.
    const kept = scoreRow!.citations as { text: string; ref: string }[];
    const keptRefs = kept.map((c) => c.ref);
    expect(keptRefs).not.toContain("nonexistent");
    expect(keptRefs).not.toContain("funding");
    expect(keptRefs).toContain("industry");
    expect(keptRefs).toContain("news_0");
    expect(kept).toHaveLength(2);

    const wb = db.select().from(schema.writebacks).where(eq(schema.writebacks.contactId, CONTACT_ID)).get();
    expect(wb!.status).toBe("pending");

    const runRow = db.select().from(schema.runs).where(eq(schema.runs.id, RUN_ID)).get();
    expect(runRow!.status).toBe("scored");

    // RunBus persists every event; the orchestrator lifecycle types must appear.
    const types = db.select().from(schema.runEvents).where(eq(schema.runEvents.runId, RUN_ID)).all().map((e) => e.type);
    expect(types).toContain("run_started");
    expect(types).toContain("plan_ready");
    expect(types).toContain("score_ready");
    expect(types).toContain("run_completed");
  });
});

describe("fan-out failure", () => {
  it("lets the slower siblings finish before the run is marked failed", async () => {
    const RUN = "run-orch-fanout-fail";
    const CONTACT = "c-orch-fanout-fail";
    db.insert(schema.contacts)
      .values({ id: CONTACT, name: "Fanout Fail", companyDomain: "northwind.dev", props: {}, syncedAt: new Date() })
      .onConflictDoNothing()
      .run();

    // company rejects immediately; contact resolves on a later tick. With
    // Promise.all the run recorded its terminal error while contact was still
    // going, and contact's completion landed after it.
    const deps: OrchestratorDeps = {
      runSub: (async (opts: { agentKey: string; bus: { emit: (e: unknown) => void } }) => {
        if (opts.agentKey === "company") throw new Error("company blew up");
        await new Promise((r) => setTimeout(r, 20));
        opts.bus.emit({ agent: opts.agentKey, type: "agent_completed", payload: {} });
        return {};
      }) as unknown as OrchestratorDeps["runSub"],
      synthesize: fakeSynthesize,
    };

    await runContact(RUN, CONTACT, deps);

    const events = db
      .select()
      .from(schema.runEvents)
      .where(eq(schema.runEvents.runId, RUN))
      .all()
      .map((e) => `${e.agent}:${e.type}`);
    const terminal = events.lastIndexOf("orchestrator:agent_error");
    expect(terminal).toBeGreaterThan(-1);
    expect(events.indexOf("contact:agent_completed")).toBeGreaterThan(-1);
    expect(events.indexOf("contact:agent_completed")).toBeLessThan(terminal);
    expect(db.select().from(schema.runs).where(eq(schema.runs.id, RUN)).get()?.status).toBe("error");
  });
});

describe("verification claim ids that match no citeable ref", () => {
  it("flags the run instead of silently keeping an unfiltered rationale", async () => {
    const RUN = "run-orch-unmatched";
    const CONTACT = "c-orch-unmatched";
    db.insert(schema.contacts)
      .values({ id: CONTACT, name: "Unmatched Claim", companyDomain: "northwind.dev", props: {}, syncedAt: new Date() })
      .onConflictDoNothing()
      .run();

    // The verifier rejects "company_funding", but the citeable refs are dossier
    // field names, so the gate can match nothing and strips nothing.
    const deps: OrchestratorDeps = {
      runSub: (async (opts: { agentKey: string }) => {
        if (opts.agentKey === "verification")
          return { claims: [{ claimId: "company_funding", verdict: "unsupported" }], contradictions: [] };
        return (await (fakeRunSub as any)(opts)) as unknown;
      }) as unknown as OrchestratorDeps["runSub"],
      synthesize: fakeSynthesize,
    };

    await runContact(RUN, CONTACT, deps);

    const row = db.select().from(schema.scores).where(eq(schema.scores.runId, RUN)).get()!;
    expect(row.needsReview).toBe(true);
    expect((row.reviewReasons as string[]).some((r) => r.startsWith("unmatched verification claim"))).toBe(true);
  });
});

describe("contradicted claims with no run-level contradiction", () => {
  it("still flags the run for review", async () => {
    const RUN = "run-orch-contradicted";
    const CONTACT = "c-orch-contradicted";
    db.insert(schema.contacts)
      .values({ id: CONTACT, name: "Contradicted", companyDomain: "northwind.dev", props: {}, syncedAt: new Date() })
      .onConflictDoNothing()
      .run();

    // The verifier puts the detail in the claim note and leaves contradictions[]
    // empty, which the schema allows. The scorer used to see nothing at all.
    const deps: OrchestratorDeps = {
      runSub: (async (opts: { agentKey: string }) => {
        if (opts.agentKey === "verification")
          return { claims: [{ claimId: "industry", verdict: "contradicted", note: "site sells freight, not software" }], contradictions: [] };
        return (await (fakeRunSub as any)(opts)) as unknown;
      }) as unknown as OrchestratorDeps["runSub"],
      synthesize: fakeSynthesize,
    };

    await runContact(RUN, CONTACT, deps);

    const row = db.select().from(schema.scores).where(eq(schema.scores.runId, RUN)).get()!;
    expect(row.needsReview).toBe(true);
    const reasons = row.reviewReasons as string[];
    expect(reasons.some((r) => r.startsWith("verification contradiction"))).toBe(true);
    expect(reasons.some((r) => r.includes("freight"))).toBe(true); // the note reaches the rep
  });
});

describe("synthesis produced no rationale", () => {
  it("flags the run so an empty note cannot be batch approved", async () => {
    const RUN = "run-orch-no-rationale";
    const CONTACT = "c-orch-no-rationale";
    db.insert(schema.contacts)
      .values({ id: CONTACT, name: "No Rationale", companyDomain: "northwind.dev", props: {}, syncedAt: new Date() })
      .onConflictDoNothing()
      .run();

    // A clean dossier: nothing else would trip review, so without the synthesis
    // check this scores high and goes straight into batch approval with an empty
    // HubSpot note.
    const deps: OrchestratorDeps = {
      runSub: (async (opts: { agentKey: string }) => {
        switch (opts.agentKey) {
          case "verification":
            return { claims: [], contradictions: [] };
          case "icpfit":
            return { firmographic: 0.9, role: 0.9, technographic: 0.9, disqualified: false, dimensions: [], conflicts: [] };
          case "contact":
            return { title: f("VP Engineering", "pdl_person_enrich"), identityUnverified: false };
          default:
            return {};
        }
      }) as unknown as OrchestratorDeps["runSub"],
      synthesize: async () => {
        throw new Error("synthesis overloaded");
      },
    };

    await runContact(RUN, CONTACT, deps);

    const row = db.select().from(schema.scores).where(eq(schema.scores.runId, RUN)).get()!;
    expect(row.rationale).toBeNull();
    expect(row.needsReview).toBe(true);
    expect((row.reviewReasons as string[]).some((r) => r.startsWith("no rationale"))).toBe(true);
    // The run itself still completes and keeps its deterministic score.
    expect(db.select().from(schema.runs).where(eq(schema.runs.id, RUN)).get()?.status).toBe("scored");
  });
});

describe("synthesis wrote a rationale but cited nothing", () => {
  it("flags the run so unbacked prose is not batch approved", async () => {
    const RUN = "run-orch-uncited";
    const CONTACT = "c-orch-uncited";
    db.insert(schema.contacts)
      .values({ id: CONTACT, name: "Uncited", companyDomain: "northwind.dev", props: {}, syncedAt: new Date() })
      .onConflictDoNothing()
      .run();

    const deps: OrchestratorDeps = {
      runSub: (async (opts: { agentKey: string }) => {
        switch (opts.agentKey) {
          case "verification":
            return { claims: [], contradictions: [] };
          case "icpfit":
            return { firmographic: 0.9, role: 0.9, technographic: 0.9, disqualified: false, dimensions: [], conflicts: [] };
          case "contact":
            return { title: f("VP Engineering", "pdl_person_enrich"), identityUnverified: false };
          default:
            return {};
        }
      }) as unknown as OrchestratorDeps["runSub"],
      // A confident-sounding verdict with no citations at all, which the
      // synthesis schema permits.
      synthesize: async () => ({ rationale: "Great fit, move fast.", nextStep: "Email today.", citations: [] }),
    };

    await runContact(RUN, CONTACT, deps);

    const row = db.select().from(schema.scores).where(eq(schema.scores.runId, RUN)).get()!;
    expect(row.rationale).toBe("Great fit, move fast.");
    expect(row.needsReview).toBe(true);
    expect((row.reviewReasons as string[]).some((r) => r.startsWith("uncited rationale"))).toBe(true);
  });
});

describe("a re-run finishing during an approval", () => {
  it("leaves a claimed write-back row alone", async () => {
    const RUN = "run-orch-claimed";
    const CONTACT = "c-orch-claimed";
    db.insert(schema.contacts)
      .values({ id: CONTACT, name: "Claimed", companyDomain: "northwind.dev", props: {}, syncedAt: new Date() })
      .onConflictDoNothing()
      .run();
    // A HubSpot call is out for the previous score.
    db.insert(schema.writebacks)
      .values({ contactId: CONTACT, status: "writing", payload: { properties: { lead_priority_score: 70, lead_grade: "C" }, note: "old" }, approvedAt: new Date() })
      .run();

    await runContact(RUN, CONTACT, fakeDeps);

    // Resetting the claim here would let that older write finish and mark the
    // contact written against the verdict this run just replaced.
    const wb = db.select().from(schema.writebacks).where(eq(schema.writebacks.contactId, CONTACT)).get()!;
    expect(wb.status).toBe("writing");
    expect((wb.payload as any).properties.lead_priority_score).toBe(70);
    // The run itself still scored normally.
    expect(db.select().from(schema.runs).where(eq(schema.runs.id, RUN)).get()?.status).toBe("scored");
  });
});

describe("an old run finishing after a newer one", () => {
  it("does not restage the write-back from the superseded run", async () => {
    const CONTACT = "c-orch-superseded";
    const OLD = "run-superseded-1000";
    const NEW = "run-superseded-2000";
    db.insert(schema.contacts)
      .values({ id: CONTACT, name: "Superseded", companyDomain: "northwind.dev", props: {}, syncedAt: new Date() })
      .onConflictDoNothing()
      .run();
    // A newer run already finished and its verdict was approved and written.
    db.insert(schema.runs).values({ id: NEW, contactId: CONTACT, status: "scored", startedAt: new Date() }).run();
    db.insert(schema.writebacks)
      .values({ contactId: CONTACT, status: "written", payload: { properties: { lead_priority_score: 90, lead_grade: "A" }, note: "new" }, writtenAt: new Date() })
      .run();

    // The older run, long outlived, finally returns.
    await runContact(OLD, CONTACT, fakeDeps);

    const wb = db.select().from(schema.writebacks).where(eq(schema.writebacks.contactId, CONTACT)).get()!;
    // Reopening this would show an already-synced contact as pending work again.
    expect(wb.status).toBe("written");
    expect((wb.payload as any).properties.lead_priority_score).toBe(90);
  });
});

describe("write-back staging respects prior decisions", () => {
  const seed = (id: string, status: string, payload: unknown) => {
    db.insert(schema.contacts)
      .values({ id, name: id, companyDomain: "northwind.dev", props: {}, syncedAt: new Date() })
      .onConflictDoNothing()
      .run();
    db.insert(schema.writebacks).values({ contactId: id, status, payload, approvedAt: new Date() }).run();
  };

  it("leaves a skip in place when a re-run lands a clean score", async () => {
    seed("c-orch-skipped", "skipped", null);
    await runContact("run-orch-skipped", "c-orch-skipped", fakeDeps);
    // The rep decided not to write this contact; only the rep undoes that.
    expect(db.select().from(schema.writebacks).where(eq(schema.writebacks.contactId, "c-orch-skipped")).get()?.status).toBe("skipped");
  });

  it("keeps an unchanged written row synced", async () => {
    // Precisely what fakeDeps produces for this dossier.
    const s = score(
      {
        icpFit: { firmographic: 0.8, role: 0.3, technographic: 0.3, disqualified: false, conflicts: ["stale funding", "competitor present"] },
        engagement: { topActions: [], recencyDays: 10 },
        news: { events: [{ type: "funding", fresh: true }] },
        verification: { contradictions: ["role mismatch"], unsupported: 1 },
        identityUnverified: true,
      },
      DEFAULT_ICP,
    );
    seed("c-orch-same", "written", {
      properties: { lead_priority_score: s.priority, lead_grade: s.grade },
      note: "Funded dev-tools shop, but funding claim is unverified.",
    });

    await runContact("run-orch-same", "c-orch-same", fakeDeps);

    // Reopening it would offer a button that posts a second note for a score
    // HubSpot already holds.
    const wb = db.select().from(schema.writebacks).where(eq(schema.writebacks.contactId, "c-orch-same")).get()!;
    expect(wb.status).toBe("written");
  });

  it("does reopen when the re-run changes the verdict", async () => {
    seed("c-orch-moved", "written", { properties: { lead_priority_score: 1, lead_grade: "F" }, note: "old" });
    await runContact("run-orch-moved", "c-orch-moved", fakeDeps);
    expect(db.select().from(schema.writebacks).where(eq(schema.writebacks.contactId, "c-orch-moved")).get()?.status).toBe("pending");
  });
});

describe("a contact purged mid-run", () => {
  it("discards the score instead of orphaning it", async () => {
    const RUN = "run-orch-purged";
    const CONTACT = "c-orch-purged";
    db.insert(schema.contacts)
      .values({ id: CONTACT, name: "Purged", companyDomain: "northwind.dev", props: {}, syncedAt: new Date() })
      .run();

    // The sync that archives this contact lands while the run is in flight.
    const deps: OrchestratorDeps = {
      runSub: (async (opts: { agentKey: string }) => {
        if (opts.agentKey === "engagement") db.delete(schema.contacts).where(eq(schema.contacts.id, CONTACT)).run();
        return (await (fakeRunSub as any)(opts)) as unknown;
      }) as unknown as OrchestratorDeps["runSub"],
      synthesize: fakeSynthesize,
    };

    await runContact(RUN, CONTACT, deps);

    // A score for a contact that no longer exists cannot be rendered and blocks
    // a restored contact from being auto-queued.
    expect(db.select().from(schema.scores).where(eq(schema.scores.runId, RUN)).get()).toBeUndefined();
    expect(db.select().from(schema.writebacks).where(eq(schema.writebacks.contactId, CONTACT)).get()).toBeUndefined();
  });
});

describe("a re-run that newly flags an already-written contact", () => {
  it("reopens the row so the hold is visible", async () => {
    const CONTACT = "c-orch-newflag";
    db.insert(schema.contacts)
      .values({ id: CONTACT, name: "New Flag", companyDomain: "northwind.dev", props: {}, syncedAt: new Date() })
      .onConflictDoNothing()
      .run();
    // Written when the verdict was clean. fakeDeps produces the same numbers and
    // note but trips review (contradiction, identity unverified).
    const s = score(
      {
        icpFit: { firmographic: 0.8, role: 0.3, technographic: 0.3, disqualified: false, conflicts: ["stale funding", "competitor present"] },
        engagement: { topActions: [], recencyDays: 10 },
        news: { events: [{ type: "funding", fresh: true }] },
        verification: { contradictions: ["role mismatch"], unsupported: 1 },
        identityUnverified: true,
      },
      DEFAULT_ICP,
    );
    db.insert(schema.writebacks)
      .values({
        contactId: CONTACT,
        status: "written",
        payload: {
          properties: { lead_priority_score: s.priority, lead_grade: s.grade },
          note: "Funded dev-tools shop, but funding claim is unverified.",
          needsReview: false,
        },
        approvedAt: new Date(),
        writtenAt: new Date(),
      })
      .run();

    await runContact("run-orch-newflag", CONTACT, fakeDeps);

    // The queue calls a written contact synced before it looks at needsReview,
    // so leaving it written would hide the new hold entirely.
    expect(db.select().from(schema.writebacks).where(eq(schema.writebacks.contactId, CONTACT)).get()?.status).toBe("pending");
  });
});

describe("a run for a contact that no longer exists", () => {
  it("ends before any subagent is invoked", async () => {
    let calls = 0;
    const deps: OrchestratorDeps = {
      runSub: (async () => {
        calls++;
        return {};
      }) as unknown as OrchestratorDeps["runSub"],
      synthesize: fakeSynthesize,
    };

    await runContact("run-orch-ghost", "c-does-not-exist", deps);

    // Fanning out would spend model quota on a lead that cannot be scored.
    expect(calls).toBe(0);
    expect(db.select().from(schema.runs).where(eq(schema.runs.id, "run-orch-ghost")).get()?.status).toBe("error");
  });
});
