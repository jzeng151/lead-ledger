import { eq } from "drizzle-orm";

import { db, schema } from "../../db";
import { makeBus, dropBus, getBus, notifyActivity } from "../runStore";
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
  notifyActivity(); // dashboard: a run is now in flight

  try {
    bus.emit({ agent: "orchestrator", type: "plan_ready", payload: { agents: FANOUT.map((a) => a.key) } });

    // 1-5: retrieval subagents in parallel. allSettled, not all: a rejecting
    // Promise.all would return while the siblings were still streaming, so the
    // run was marked failed and its stream closed while those agents kept
    // emitting events. Replay then showed agent output after the terminal error.
    // The siblings are not cancelled (the Tool Runner call is already in flight),
    // so their calls still complete; this only makes the run's end honest.
    const settled = await Promise.allSettled(
      FANOUT.map(async (a) => [a.key, await deps.runSub({ bus, agentKey: a.key, system: a.system, schema: a.schema, input })] as const),
    );
    const failed = settled.find((r) => r.status === "rejected");
    if (failed) throw (failed as PromiseRejectedResult).reason;
    const partials: Record<string, any> = Object.fromEntries(
      settled.map((r) => (r as PromiseFulfilledResult<readonly [string, unknown]>).value),
    );

    // Verification and ICP-fit judge the raw partials in parallel.
    const dossierJson = JSON.stringify({ ...partials, icp });
    // allSettled for the same reason as the fan-out: a rejecting Promise.all
    // would end the run while the other judge was still streaming, and its events
    // would land after the terminal one.
    const judged = await Promise.allSettled([
      deps.runSub({ bus, agentKey: VERIFICATION.key, system: VERIFICATION.system, schema: VERIFICATION.schema, input: dossierJson }),
      deps.runSub({ bus, agentKey: ICPFIT.key, system: ICPFIT.system, schema: ICPFIT.schema, input: dossierJson }),
    ]);
    const judgeFailure = judged.find((r) => r.status === "rejected");
    if (judgeFailure) throw (judgeFailure as PromiseRejectedResult).reason;
    const [verification, icpFit] = judged.map((r) => (r as PromiseFulfilledResult<any>).value) as [any, any];

    // Deterministic score. Adapt verification to the scorer's shape. A claim the
    // fact-checker marked unsupported or contradicted trips review and is stripped
    // from the rationale.
    const claims: any[] = verification.claims ?? [];
    // The citation gate strips a claim that is unsupported OR contradicted. The
    // review reason, though, counts only genuinely unsupported claims: a
    // contradiction already surfaces through its own reason, so counting it here
    // too would double-report the same problem under a misleading label.
    const isRejected = (c: any) => c.verdict === "unsupported" || c.verdict === "contradicted";
    // A claim can be marked contradicted while the run-level contradictions list
    // is left empty (the detail lives in the claim's note). Without this, the
    // scorer sees no contradiction and no unsupported count, so a contradicted
    // claim could pass without review and stay batch-approvable.
    const contradictedClaims = claims
      .filter((c: any) => c.verdict === "contradicted")
      .map((c: any) => `${c.claimId}${c.note ? `: ${c.note}` : ""}`);
    const declared: string[] = verification.contradictions ?? [];
    const verif = {
      contradictions: declared.length ? declared : contradictedClaims,
      unsupported: claims.filter((c: any) => c.verdict === "unsupported").length,
      uncertain: claims.filter((c: any) => c.verdict === "uncertain").length,
    };
    bus.emit({ agent: "scorer", type: "scoring_started", payload: {} });
    // Re-read the dials rather than using the snapshot taken before the fan-out.
    // A settings save during a long run cannot be picked up by rescoreAll (this
    // run has no dossier or score row yet), so without this the run would land
    // its verdict under the old weights right after the new ones were saved.
    const scoringIcp = (db.select().from(icpConfig).where(eq(icpConfig.id, "default")).get()?.config as
      | IcpConfig
      | undefined) ?? icp;
    const s = score(
      { icpFit, engagement: partials.engagement, news: partials.news, verification: verif, identityUnverified: partials.contact?.identityUnverified },
      scoringIcp,
    );

    // Synthesis + citation-integrity gate. Refs whose claim was rejected by
    // verification, or that point at no real dossier field, are stripped. Build
    // the synthesis input after scoring so the writer sees the full picture:
    // partials plus the ICP-Fit read, verification verdicts, and computed score.
    const synthesisJson = JSON.stringify({ ...partials, icpFit, verification, score: s, icp: scoringIcp });
    // Synthesis is non-fatal: it is the rep-facing rationale layer, not scoring
    // input, so a synthesis failure must never discard an already-computed score.
    let synth: Synthesis = { rationale: null, nextStep: null, citations: [] };
    try {
      synth = await deps.synthesize({ bus, dossierJson: synthesisJson, input });
    } catch (e) {
      // agent_warning, not agent_error: the SSE route and the live view treat
      // agent_error as terminal, so reusing it here would close the stream before
      // run_completed and make a replay of a successfully scored run look failed.
      bus.emit({
        agent: "synthesis",
        type: "agent_warning",
        payload: { message: e instanceof Error ? e.message : String(e), stack: e instanceof Error ? e.stack : undefined },
      });
    }
    const rejected = new Set<string>(claims.filter(isRejected).map((c: any) => c.claimId));
    const sources = mergeSources(partials);
    const gate = checkCitations(synth.citations ?? [], sources, rejected);

    // The gate can only strip a rejected claim when its claimId is one of the
    // citeable refs, which the verification prompt requires but the schema cannot
    // enforce. If a rejected claimId matches no ref, the gate silently keeps every
    // citation, so surface that as a review reason instead of trusting a rationale
    // whose rejected claim was never matched.
    const unmatched = [...rejected].filter((id) => !(id in sources));
    const cleanRationale = sanitizeRationale(synth.rationale);

    // The gate strips a citation whose claim verification rejected, or that points
    // at no real dossier field, but the rationale prose still asserts it. Flag that
    // for review instead of quietly showing an unbacked sentence to the rep.
    const reviewReasons = [...s.reviewReasons];
    // Synthesis is non-fatal, but a score with no rationale is not something to
    // approve blind: without this a clean high-priority contact could be batch
    // approved and written to HubSpot with an empty note.
    if (!cleanRationale)
      reviewReasons.push("no rationale: the synthesis step produced no rep-facing verdict for this score");
    // A rationale with nothing backing it is prose, not evidence. The stripped
    // check below only fires when a citation was rejected, so a synthesis that
    // simply cited nothing would otherwise sail through as a clean lead.
    else if (!gate.kept.length)
      reviewReasons.push("uncited rationale: the verdict cites no dossier field");
    if (unmatched.length)
      reviewReasons.push(
        `unmatched verification claim: ${unmatched.join(", ")} was rejected but matches no cited field, so the rationale was not filtered`,
      );
    if (gate.stripped.length)
      reviewReasons.push(
        `unverified claims in rationale: ${gate.stripped.length} citation(s) stripped (${[...new Set(gate.stripped)].join(", ")})`,
      );
    const needsReview = reviewReasons.length > 0;

    bus.emit({ agent: "scorer", type: "score_ready", payload: { ...s, needsReview, reviewReasons } });

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
      needsReview,
      reviewReasons,
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
    // Leave a claimed row alone. If a rep approved just before this re-run
    // finished, resetting the claim to pending here would let that older write
    // complete and mark the contact written against the verdict this run just
    // replaced. The write-back route reconciles the row against the newest score
    // once its HubSpot call returns.
    const staged = db.select({ status: writebacks.status }).from(writebacks).where(eq(writebacks.contactId, contactId)).get();
    if (staged?.status !== "writing") {
      db.insert(writebacks)
        .values({ contactId, status: "pending", payload: writeback })
        .onConflictDoUpdate({
          target: writebacks.contactId,
          set: { status: "pending", payload: writeback, approvedAt: null, writtenAt: null },
        })
        .run();
    }

    db.update(runs).set({ status: "scored", finishedAt: new Date() }).where(eq(runs.id, runId)).run();

    bus.emit({ agent: "orchestrator", type: "run_completed", payload: { priority: s.priority } });
    notifyActivity(); // dashboard: this run scored, refresh the queue
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    bus.emit({ agent: "orchestrator", type: "agent_error", payload: { message, stack } });
    db.update(runs).set({ status: "error" }).where(eq(runs.id, runId)).run();
    notifyActivity(); // dashboard: this run failed, clear its in-flight state
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
