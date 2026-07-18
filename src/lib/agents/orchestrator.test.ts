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
