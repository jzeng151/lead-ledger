import { z } from "zod";

// Every retrieved field carries value + confidence + source so the orchestrator
// resolves conflicts by confidence and the rationale can cite each claim.
export const field = <T extends z.ZodTypeAny>(t: T) =>
  z.object({ value: t.nullable(), confidence: z.number(), source: z.string() });

// Retrieval schemas are deliberately lenient: a subagent that omits a field
// (for example on an obviously out-of-ICP company where the model shortcuts)
// must not throw and abort the whole contact run. Missing fields become
// undefined / empty; the orchestrator and deterministic scorer tolerate that.
//
// NOTE: the field() fields below are the citeable dossier keys shown in the
// report. Their display labels live in ./citationLabels.ts - add a label there
// when you add a citeable field, or the report shows the raw internal key.

// 1. Company / Firmographics
export const CompanyFindings = z.object({
  industry: field(z.string()).optional(),
  headcount: field(z.number()).optional(),
  revenueBand: field(z.string()).optional(),
  funding: field(z.string()).optional(),
  latestRoundDate: field(z.string()).optional(),
  headcountGrowth90d: field(z.number()).optional(),
});

// 2. Contact / Profile
export const ContactFindings = z.object({
  title: field(z.string()).optional(),
  seniority: field(z.string()).optional(),
  department: field(z.string()).optional(),
  tenureMonths: field(z.number()).optional(),
  jobChange: field(z.boolean()).optional(),
  buyingRole: field(z.string()).optional(),
  emailVerified: field(z.boolean()).optional(),
  identityUnverified: z.boolean().optional().default(false),
});

// 3. Tech Stack
export const TechFindings = z.object({
  technologies: z.array(z.string()).default([]),
  competitorPresent: field(z.boolean()).optional(),
  // nullish, not optional: detect_tech_stack returns competitorEvidence: null on
  // the ordinary no-competitor path and the shared contract tells agents to use
  // null for missing data, so an agent forwarding the tool result verbatim would
  // otherwise fail validation and abort the whole run.
  competitorEvidence: field(z.string()).nullish(),
  // Whether the domain actually served a page over HTTPS. A field() so the result
  // is citeable and reaches the report rather than dying in a free-text note.
  httpsLive: field(z.boolean()).optional(),
  complementSignals: z.array(z.string()).default([]),
  // Same reason. No .transform() to coerce null into "": every one of these
  // schemas is converted to JSON Schema to build the submit_findings tool, and a
  // transform cannot be represented there, which fails the whole agent.
  notes: z.string().nullish(),
});

// 4. News / Trigger Signals
export const NewsFindings = z.object({
  events: z
    .array(
      z.object({
        date: z.string().optional(),
        type: z.string().optional(),
        summary: z.string().optional(),
        source: z.string().optional(),
        talkingPoint: z.string().optional(),
        fresh: z.boolean().optional(),
      }),
    )
    .default([]),
});

// 5. Engagement
export const EngagementFindings = z.object({
  topActions: z.array(z.string()).default([]),
  recencyDays: z.number().nullable().optional(),
  rawSignals: z.array(z.any()).default([]),
  attributionUncertain: z.boolean().optional().default(false),
});

// 6. Verification (adversarial fact-check)
export const VerificationFindings = z.object({
  claims: z
    .array(
      z.object({
        claimId: z.string(),
        verdict: z.enum(["supported", "unsupported", "contradicted", "uncertain"]),
        adjustedConfidence: z.number().optional(),
        note: z.string().optional(),
      }),
    )
    .default([]),
  contradictions: z.array(z.string()).default([]),
});

// 7. ICP-Fit. The three axis scores feed the deterministic scorer, so they
// default to a neutral 0.5 if a model omits them rather than crashing the run.
// They are bounded to 0-1 because computeFit multiplies them directly: a model
// answering on a 0-100 scale would otherwise validate and persist an impossible
// fit and grade. Out of range fails the run, which is visible, rather than
// silently promoting the lead. The bounds also reach the model through the tool
// JSON schema, so the mistake is unlikely in the first place.
export const IcpFitFindings = z.object({
  firmographic: z.number().min(0).max(1).optional().default(0.5),
  role: z.number().min(0).max(1).optional().default(0.5),
  technographic: z.number().min(0).max(1).optional().default(0.5),
  disqualified: z.boolean().optional().default(false),
  dimensions: z
    .array(
      z.object({
        dimension: z.string().optional(),
        assessment: z.number().optional(),
        justification: z.string().optional(),
        confidence: z.number().optional(),
      }),
    )
    .default([]),
  bantMeddic: z.record(z.string(), z.string()).optional(),
  conflicts: z.array(z.string()).default([]),
});

// 8. Synthesis (Opus rep-facing verdict). Fields are lenient: synthesis is the
// rep-facing enhancement layer, not scoring input, so a model that omits nextStep
// or citations must not fail validation and abort a run whose score is already
// computed. The orchestrator coalesces missing fields to null / [].
export const SynthesisOutput = z.object({
  rationale: z.string().nullish(),
  nextStep: z.string().nullish(),
  citations: z.array(z.object({ text: z.string(), ref: z.string() })).nullish(),
});
