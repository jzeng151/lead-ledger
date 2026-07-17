import { eq } from "drizzle-orm";

import { db, schema } from "../../db";
import { makeBus, dropBus } from "../runStore";
import { score } from "../scoring";
import { checkCitations } from "../citation";
import { DEFAULT_ICP, type IcpConfig } from "../icp";
import { runSubagent, type EventSink } from "./runSubagent";
import { FANOUT, VERIFICATION, ICPFIT, MODELS, EFFORT, SYSTEM_PROMPTS } from "./config";
import { SynthesisOutput } from "./schemas";

const { contacts, runs, scores, dossiers, writebacks, icpConfig } = schema;

type Synthesis = { rationale: string; nextStep: string; citations: { text: string; ref: string }[] };

export type OrchestratorDeps = {
  runSub: typeof runSubagent;
  synthesize: (args: { bus: EventSink; dossierJson: string; input: string }) => Promise<Synthesis>;
};

/**
 * Default synthesis step: the Opus rep-facing verdict. Reuses the extended
 * runSubagent with no retrieval tools and adaptive thinking.
 */
export async function synthesize(args: { bus: EventSink; dossierJson: string; input: string }): Promise<Synthesis> {
  return (await runSubagent({
    bus: args.bus,
    agentKey: "synthesis",
    system: SYSTEM_PROMPTS.synthesis,
    schema: SynthesisOutput,
    input: args.dossierJson,
    model: MODELS.synthesis,
    effort: EFFORT.synthesis,
    thinking: { type: "adaptive", display: "summarized" },
    toolNames: [],
  })) as Synthesis;
}

// Flatten each partial's {value,confidence,source} fields into a field-name ->
// {source} map so the citation gate can confirm every cited ref is backed by a
// real dossier field.
function mergeSources(partials: Record<string, any>): Record<string, { source?: string }> {
  const out: Record<string, { source?: string }> = {};
  for (const partial of Object.values(partials)) {
    if (!partial || typeof partial !== "object") continue;
    for (const [key, val] of Object.entries(partial)) {
      if (val && typeof val === "object" && "value" in val && "confidence" in val && "source" in val) {
        out[key] = { source: (val as { source?: string }).source };
      }
    }
  }
  return out;
}

export async function runContact(
  runId: string,
  contactId: string,
  deps: OrchestratorDeps = { runSub: runSubagent, synthesize },
) {
  const bus = makeBus(runId);

  const contact = db.select().from(contacts).where(eq(contacts.id, contactId)).get();
  const icpRow = db.select().from(icpConfig).where(eq(icpConfig.id, "default")).get();
  const icp = (icpRow?.config as IcpConfig | undefined) ?? DEFAULT_ICP;
  const input = JSON.stringify({ contact, domain: contact?.companyDomain, icp });

  // Own the run row's lifecycle so runContact is self-contained; a re-run reuses
  // the same runId, and the start-run route (Task 13) may have created it already.
  db.insert(runs)
    .values({ id: runId, contactId, status: "running", startedAt: new Date() })
    .onConflictDoUpdate({ target: runs.id, set: { status: "running" } })
    .run();
  bus.emit({ agent: "orchestrator", type: "run_started", payload: { contactId } });

  try {
    bus.emit({ agent: "orchestrator", type: "plan_ready", payload: { agents: FANOUT.map((a) => a.key) } });

    // 1-5: retrieval subagents in parallel.
    const entries = await Promise.all(
      FANOUT.map(async (a) => [a.key, await deps.runSub({ bus, agentKey: a.key, system: a.system, schema: a.schema, input })] as const),
    );
    const partials: Record<string, any> = Object.fromEntries(entries);

    // Verification and ICP-fit judge the raw partials in parallel.
    const dossierJson = JSON.stringify({ ...partials, icp });
    const [verification, icpFit] = (await Promise.all([
      deps.runSub({ bus, agentKey: VERIFICATION.key, system: VERIFICATION.system, schema: VERIFICATION.schema, input: dossierJson }),
      deps.runSub({ bus, agentKey: ICPFIT.key, system: ICPFIT.system, schema: ICPFIT.schema, input: dossierJson }),
    ])) as [any, any];

    // Deterministic score. Adapt verification to the scorer's shape.
    const verif = {
      contradictions: verification.contradictions ?? [],
      unsupported: (verification.claims ?? []).filter((c: any) => c.verdict === "unsupported").length,
    };
    bus.emit({ agent: "scorer", type: "scoring_started", payload: {} });
    const s = score({ icpFit, engagement: partials.engagement, verification: verif, identityUnverified: partials.contact?.identityUnverified }, icp);

    // Synthesis + citation-integrity gate. Refs whose claim was rejected by
    // verification, or that point at no real dossier field, are stripped.
    const synth = await deps.synthesize({ bus, dossierJson, input });
    const rejected = new Set<string>(
      (verification.claims ?? []).filter((c: any) => c.verdict === "unsupported").map((c: any) => c.claimId),
    );
    const gate = checkCitations(synth.citations, mergeSources(partials), rejected);

    bus.emit({ agent: "scorer", type: "score_ready", payload: s });

    const merged = { ...partials, icpFit };
    db.insert(dossiers)
      .values({ runId, perAgent: partials, verification, merged })
      .onConflictDoUpdate({ target: dossiers.runId, set: { perAgent: partials, verification, merged } })
      .run();

    const scoreRow = {
      runId,
      contactId,
      fit: s.fit,
      engagement: s.engagement,
      priority: s.priority,
      grade: s.grade,
      needsReview: s.needsReview,
      reviewReasons: s.reviewReasons,
      rationale: synth.rationale,
      nextStep: synth.nextStep,
      citations: gate.kept,
    };
    db.insert(scores)
      .values(scoreRow)
      .onConflictDoUpdate({ target: scores.runId, set: scoreRow })
      .run();

    const writeback = {
      properties: { lead_priority_score: s.priority, lead_grade: s.grade },
      note: synth.rationale,
    };
    db.insert(writebacks)
      .values({ contactId, status: "pending", payload: writeback })
      .onConflictDoUpdate({
        target: writebacks.contactId,
        set: { status: "pending", payload: writeback, approvedAt: null, writtenAt: null },
      })
      .run();

    db.update(runs).set({ status: "scored", finishedAt: new Date() }).where(eq(runs.id, runId)).run();

    bus.emit({ agent: "orchestrator", type: "run_completed", payload: { priority: s.priority } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    bus.emit({ agent: "orchestrator", type: "agent_error", payload: { message } });
    db.update(runs).set({ status: "error" }).where(eq(runs.id, runId)).run();
  } finally {
    // Keep the bus around briefly for late SSE subscribers, then reclaim it.
    // unref so a hermetic run does not hold the process open for 30s.
    (setTimeout(() => dropBus(runId), 30000) as any).unref?.();
  }
}
