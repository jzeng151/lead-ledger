// Human-readable labels + provenance for citation refs shown in the report.
// KEEP IN SYNC with the citeable fields in ./schemas.ts: every field() field on
// the Company / Contact / Tech retrieval schemas (the ones mergeSources exposes),
// plus news_<n> for News events. If you add a citeable field to a schema, add its
// label here or the report will fall back to showing the raw internal key.
export type CitationMeta = { label: string; agent: string };

const FIELD_LABELS: Record<string, CitationMeta> = {
  // Company (CompanyFindings)
  industry: { label: "Industry", agent: "Company" },
  headcount: { label: "Headcount", agent: "Company" },
  revenueBand: { label: "Revenue band", agent: "Company" },
  funding: { label: "Funding", agent: "Company" },
  latestRoundDate: { label: "Latest round date", agent: "Company" },
  headcountGrowth90d: { label: "Headcount growth (90d)", agent: "Company" },
  // Contact (ContactFindings)
  title: { label: "Title", agent: "Contact" },
  seniority: { label: "Seniority", agent: "Contact" },
  department: { label: "Department", agent: "Contact" },
  tenureMonths: { label: "Tenure", agent: "Contact" },
  jobChange: { label: "Recent job change", agent: "Contact" },
  buyingRole: { label: "Buying role", agent: "Contact" },
  emailVerified: { label: "Email verified", agent: "Contact" },
  // Tech (TechFindings)
  competitorPresent: { label: "Competitor presence", agent: "Tech" },
  competitorEvidence: { label: "Competitor evidence", agent: "Tech" },
};

/**
 * Resolve a citation ref to a display label and the subagent that produced it.
 * News refs are `news_<n>` (0-indexed) and render as a 1-indexed "Signal N".
 * Unknown refs fall back to the raw ref with no agent so nothing is ever hidden.
 */
export function citationLabel(ref: string): CitationMeta {
  const news = /^news_(\d+)$/.exec(ref);
  if (news) return { label: `Signal ${Number(news[1]) + 1}`, agent: "News" };
  return FIELD_LABELS[ref] ?? { label: ref, agent: "" };
}
