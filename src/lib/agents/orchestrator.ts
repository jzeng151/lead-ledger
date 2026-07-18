import { eq } from "drizzle-orm";

import { db, schema } from "../../db";
import { makeBus, dropBus, getBus } from "../runStore";
import { score } from "../scoring";
import { checkCitations } from "../citation";
import { DEFAULT_ICP, type IcpConfig } from "../icp";
import { runSubagent, type EventSink } from "./runSubagent";
import { FANOUT, VERIFICATION, ICPFIT, MODELS, EFFORT, SYSTEM_PROMPTS } from "./config";
import { SynthesisOutput } from "./schemas";

const { contacts, runs, scores, dossiers, writebacks, icpConfig } = schema;

type Synthesis = {
  rationale?: string | null;
  nextStep?: string | null;
  citations?: { text: string; ref: string }[] | null;
};

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

// Build the set of citeable refs so the citation gate can confirm every cited
// ref is backed by a real dossier field. Top-level {value,confidence,source}
// fields are keyed by field name (funding, title, ...); each news trigger event
// is keyed news_<n> (0-indexed) mapping to that event's source.
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
  const events = partials.news?.events;
  if (Array.isArray(events)) {
    events.forEach((e: any, i: number) => {
      out[`news_${i}`] = { source: e?.source };
    });
  }
  return out;
}

// Guard against a synthesis model that leaks XML-ish tags or a citations JSON
// blob into the rationale prose: keep only the text up to the first stray tag.
function sanitizeRationale(r: string | null | undefined): string | null {
  if (!r) return null;
  const clean = r.split(/<\/?(?:rationale|parameter|citations)\b/i)[0].trim();
  return clean || null;
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
    .onConflictDoUpdate({ target: runs.id, set: { status: "running", startedAt: new Date(), finishedAt: null } })
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

    // Deterministic score. Adapt verification to the scorer's shape. A claim the
    // fact-checker marked unsupported or contradicted trips review and is stripped
    // from the rationale.
    const claims: any[] = verification.claims ?? [];
    const isRejected = (c: any) => c.verdict === "unsupported" || c.verdict === "contradicted";
    const verif = {
      contradictions: verification.contradictions ?? [],
      unsupported: claims.filter(isRejected).length,
    };
    bus.emit({ agent: "scorer", type: "scoring_started", payload: {} });
    const s = score(
      { icpFit, engagement: partials.engagement, news: partials.news, verification: verif, identityUnverified: partials.contact?.identityUnverified },
      icp,
    );

    // Synthesis + citation-integrity gate. Refs whose claim was rejected by
    // verification, or that point at no real dossier field, are stripped. Build
    // the synthesis input after scoring so the writer sees the full picture:
    // partials plus the ICP-Fit read, verification verdicts, and computed score.
    const synthesisJson = JSON.stringify({ ...partials, icpFit, verification, score: s, icp });
    // Synthesis is non-fatal: it is the rep-facing rationale layer, not scoring
    // input, so a synthesis failure must never discard an already-computed score.
    let synth: Synthesis = { rationale: null, nextStep: null, citations: [] };
    try {
      synth = await deps.synthesize({ bus, dossierJson: synthesisJson, input });
    } catch (e) {
      bus.emit({
        agent: "synthesis",
        type: "agent_error",
        payload: { message: e instanceof Error ? e.message : String(e), stack: e instanceof Error ? e.stack : undefined },
      });
    }
    const rejected = new Set<string>(claims.filter(isRejected).map((c: any) => c.claimId));
    const gate = checkCitations(synth.citations ?? [], mergeSources(partials), rejected);
    const cleanRationale = sanitizeRationale(synth.rationale);

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
      timing: s.timing,
      priority: s.priority,
      grade: s.grade,
      needsReview: s.needsReview,
      reviewReasons: s.reviewReasons,
      rationale: cleanRationale,
      nextStep: synth.nextStep ?? null,
      citations: gate.kept,
    };
    db.insert(scores)
      .values(scoreRow)
      .onConflictDoUpdate({ target: scores.runId, set: scoreRow })
      .run();

    const writeback = {
      properties: { lead_priority_score: s.priority, lead_grade: s.grade },
      note: cleanRationale ?? "",
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
    const stack = err instanceof Error ? err.stack : undefined;
    bus.emit({ agent: "orchestrator", type: "agent_error", payload: { message, stack } });
    db.update(runs).set({ status: "error" }).where(eq(runs.id, runId)).run();
  } finally {
    // Keep the bus around briefly for late SSE subscribers, then reclaim it.
    // Only drop the bus this run created: a re-run may have installed a newer bus
    // for the same runId, and this stale timer must not evict it. unref so a
    // hermetic run does not hold the process open for 30s.
    (setTimeout(() => {
      if (getBus(runId) === bus) dropBus(runId);
    }, 30000) as any).unref?.();
  }
}
