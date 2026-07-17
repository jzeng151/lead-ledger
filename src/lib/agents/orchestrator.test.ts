import { describe, it, expect, beforeAll } from "vitest";
import { eq } from "drizzle-orm";

import { db, schema } from "../../db";
import { DEFAULT_ICP } from "../icp";
import { runContact, type OrchestratorDeps } from "./orchestrator";

const RUN_ID = "run-orch-test";
const CONTACT_ID = "c-test-orch";

// A field-shaped value: {value, confidence, source}. mergeSources keys off these.
const f = (value: unknown, source: string) => ({ value, confidence: 0.8, source });

// Canned subagent output keyed by agentKey. This replaces the real Tool Runner,
// so no key or network is touched. company exposes a `funding` field so the
// citation gate has a real source to (then) reject.
const fakeRunSub: OrchestratorDeps["runSub"] = (async (opts: { agentKey: string }) => {
  switch (opts.agentKey) {
    case "company":
      return { funding: f("Series B", "pdl_company_enrich"), headcount: f(120, "pdl_company_enrich") };
    case "contact":
      return { title: f("VP Engineering", "pdl_person_enrich"), identityUnverified: true };
    case "tech":
      return { technologies: ["Datadog"], competitorPresent: f(true, "detect_tech_stack") };
    case "news":
      return { events: [] };
    case "engagement":
      return { topActions: [], recencyDays: 10, rawSignals: [], attributionUncertain: false };
    case "verification":
      return {
        claims: [{ claimId: "funding", verdict: "unsupported", adjustedConfidence: 0.2, note: "x" }],
        contradictions: ["role mismatch"],
      };
    case "icpfit":
      return { firmographic: 0.8, role: 0.3, technographic: 0.3, dimensions: [], conflicts: ["stale funding", "competitor present"] };
    default:
      throw new Error(`unexpected agentKey ${opts.agentKey}`);
  }
}) as unknown as OrchestratorDeps["runSub"];

const fakeSynthesize: OrchestratorDeps["synthesize"] = async () => ({
  rationale: "Funded dev-tools shop, but funding claim is unverified.",
  nextStep: "Confirm the round before outreach.",
  citations: [
    { text: "Series B", ref: "funding" },
    { text: "nope", ref: "nonexistent" },
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
    expect(scoreRow!.reviewReasons).toContain("verification contradiction");

    // Citation gate: "nonexistent" has no dossier field and "funding" was
    // rejected by verification, so both are stripped and kept is empty.
    const kept = scoreRow!.citations as { text: string; ref: string }[];
    expect(kept.some((c) => c.ref === "nonexistent")).toBe(false);
    expect(kept).toHaveLength(0);

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
