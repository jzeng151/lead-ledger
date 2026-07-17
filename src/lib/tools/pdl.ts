import { pickImpl, loadFixture, fetchWithTimeout, type FieldVal } from "./adapter";

async function realCompany(domain: string) {
  const res = await fetchWithTimeout(
    `https://api.peopledatalabs.com/v5/company/enrich?website=${domain}`,
    { headers: { "X-Api-Key": process.env.PDL_API_KEY! } },
  );
  if (!res.ok) throw new Error(`PDL ${res.status}`);
  const d = await res.json();
  const src = "peopledatalabs.com";
  return {
    industry: { value: d.industry ?? null, confidence: 0.9, source: src },
    headcount: { value: d.employee_count ?? null, confidence: 0.85, source: src },
    headcountGrowth90d: { value: d.employee_growth_rate_90d ?? null, confidence: 0.7, source: src },
    revenueBand: { value: d.inferred_revenue ?? null, confidence: 0.6, source: src },
    hq: { value: d.location?.name ?? null, confidence: 0.7, source: src },
    ownership: { value: d.type ?? null, confidence: 0.7, source: src },
    fundingTotal: { value: d.total_funding_raised ?? null, confidence: 0.7, source: src },
    latestRound: { value: d.latest_funding_stage ?? null, confidence: 0.7, source: src },
    latestRoundDate: { value: d.last_funding_date ?? null, confidence: 0.7, source: src },
  };
}
async function mockCompany(domain: string) {
  const c = loadFixture(domain).company ?? {};
  const src = "fixture:pdl";
  return {
    industry: { value: c.industry ?? null, confidence: c.industry ? 0.9 : 0, source: src },
    headcount: { value: c.headcount ?? null, confidence: c.headcount ? 0.85 : 0, source: src },
    headcountGrowth90d: { value: c.headcountGrowth90d ?? null, confidence: 0.7, source: src },
    revenueBand: { value: c.revenueBand ?? null, confidence: 0.6, source: src },
    hq: { value: c.hq ?? null, confidence: 0.7, source: src },
    ownership: { value: c.ownership ?? null, confidence: 0.7, source: src },
    fundingTotal: { value: c.fundingTotal ?? null, confidence: 0.7, source: src },
    latestRound: { value: c.latestRound ?? null, confidence: 0.7, source: src },
    latestRoundDate: { value: c.latestRoundDate ?? null, confidence: 0.7, source: src },
  };
}

async function realPerson(domain: string) {
  const res = await fetchWithTimeout(
    `https://api.peopledatalabs.com/v5/person/enrich?company=${domain}`,
    { headers: { "X-Api-Key": process.env.PDL_API_KEY! } },
  );
  if (!res.ok) throw new Error(`PDL ${res.status}`);
  const d = await res.json();
  const src = "peopledatalabs.com";
  return {
    title: { value: d.job_title ?? null, confidence: 0.85, source: src },
    seniority: { value: d.job_title_levels?.[0] ?? null, confidence: 0.8, source: src },
    department: { value: d.job_title_role ?? null, confidence: 0.75, source: src },
    tenureMonths: { value: d.job_tenure_months ?? null, confidence: 0.6, source: src },
    jobChange: { value: d.job_started_recently ?? null, confidence: 0.6, source: src },
    buyingRole: { value: null, confidence: 0, source: src },
    emailVerified: { value: d.email_verified ?? null, confidence: 0.7, source: src },
  };
}
async function mockPerson(domain: string) {
  const p = loadFixture(domain).person ?? {};
  const src = "fixture:pdl";
  return {
    title: { value: p.title ?? null, confidence: p.title ? 0.85 : 0, source: src },
    seniority: { value: p.seniority ?? null, confidence: p.seniority ? 0.8 : 0, source: src },
    department: { value: p.department ?? null, confidence: p.department ? 0.75 : 0, source: src },
    tenureMonths: { value: p.tenureMonths ?? null, confidence: 0.7, source: src },
    jobChange: { value: p.jobChange ?? null, confidence: 0.7, source: src },
    buyingRole: { value: p.buyingRole ?? null, confidence: 0.6, source: src },
    emailVerified: { value: p.emailVerified ?? null, confidence: 0.8, source: src },
  };
}

export const pdlCompanyEnrich = pickImpl(process.env.PDL_API_KEY, realCompany, mockCompany);
export const pdlPersonEnrich = pickImpl(process.env.PDL_API_KEY, realPerson, mockPerson);
