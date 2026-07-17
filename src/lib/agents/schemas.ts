import { z } from "zod";

// Every retrieved field carries value + confidence + source so the orchestrator
// resolves conflicts by confidence and the rationale can cite each claim.
export const field = <T extends z.ZodTypeAny>(t: T) =>
  z.object({ value: t.nullable(), confidence: z.number(), source: z.string() });

// 1. Company / Firmographics
export const CompanyFindings = z.object({
  industry: field(z.string()),
  headcount: field(z.number()),
  revenueBand: field(z.string()),
  funding: field(z.string()),
  latestRoundDate: field(z.string()),
  headcountGrowth90d: field(z.number()),
});

// 2. Contact / Profile
export const ContactFindings = z.object({
  title: field(z.string()),
  seniority: field(z.string()),
  department: field(z.string()),
  tenureMonths: field(z.number()),
  jobChange: field(z.boolean()),
  buyingRole: field(z.string()),
  emailVerified: field(z.boolean()),
  identityUnverified: z.boolean(),
});

// 3. Tech Stack
export const TechFindings = z.object({
  technologies: z.array(z.string()),
  competitorPresent: field(z.boolean()),
  competitorEvidence: field(z.string()),
  complementSignals: z.array(z.string()),
  notes: z.string(),
});

// 4. News / Trigger Signals
export const NewsFindings = z.object({
  events: z.array(
    z.object({
      date: z.string(),
      type: z.string(),
      summary: z.string(),
      source: z.string(),
      talkingPoint: z.string(),
      fresh: z.boolean(),
    }),
  ),
});

// 5. Engagement
export const EngagementFindings = z.object({
  topActions: z.array(z.string()),
  recencyDays: z.number(),
  rawSignals: z.array(z.any()),
  attributionUncertain: z.boolean(),
});

// 6. Verification (adversarial fact-check)
export const VerificationFindings = z.object({
  claims: z.array(
    z.object({
      claimId: z.string(),
      verdict: z.enum(["supported", "unsupported", "contradicted", "uncertain"]),
      adjustedConfidence: z.number(),
      note: z.string(),
    }),
  ),
  contradictions: z.array(z.string()),
});

// 7. ICP-Fit
export const IcpFitFindings = z.object({
  firmographic: z.number(),
  role: z.number(),
  technographic: z.number(),
  disqualified: z.boolean(),
  dimensions: z.array(
    z.object({
      dimension: z.string(),
      assessment: z.number(),
      justification: z.string(),
      confidence: z.number(),
    }),
  ),
  bantMeddic: z.record(z.string(), z.string()).optional(),
  conflicts: z.array(z.string()),
});

// 8. Synthesis (Opus rep-facing verdict)
export const SynthesisOutput = z.object({
  rationale: z.string(),
  nextStep: z.string(),
  citations: z.array(z.object({ text: z.string(), ref: z.string() })),
});
