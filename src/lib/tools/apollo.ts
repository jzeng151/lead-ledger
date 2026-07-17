import { pickImpl, loadFixture, fetchWithTimeout } from "./adapter";

async function realOrg(domain: string) {
  const res = await fetchWithTimeout(
    `https://api.apollo.io/api/v1/organizations/enrich?domain=${domain}`,
    { headers: { "X-Api-Key": process.env.APOLLO_API_KEY!, "Content-Type": "application/json" } },
  );
  if (!res.ok) throw new Error(`Apollo ${res.status}`);
  const o = (await res.json()).organization ?? {};
  const src = "apollo.io";
  return {
    industry: { value: o.industry ?? null, confidence: 0.85, source: src },
    headcount: { value: o.estimated_num_employees ?? null, confidence: 0.8, source: src },
    hq: { value: o.city ?? null, confidence: 0.7, source: src },
    fundingTotal: { value: o.total_funding_printed ?? null, confidence: 0.7, source: src },
    latestRound: { value: o.latest_funding_stage ?? null, confidence: 0.7, source: src },
    latestRoundDate: { value: o.latest_funding_round_date ?? null, confidence: 0.7, source: src },
    revenueBand: { value: o.annual_revenue_printed ?? null, confidence: 0.6, source: src },
    ownership: { value: o.publicly_traded_symbol ? "public" : null, confidence: 0.6, source: src },
  };
}
async function mockOrg(domain: string) {
  const c = loadFixture(domain).company ?? {};
  const src = "fixture:apollo";
  return {
    industry: { value: c.industry ?? null, confidence: c.industry ? 0.85 : 0, source: src },
    headcount: { value: c.headcount ?? null, confidence: c.headcount ? 0.8 : 0, source: src },
    hq: { value: c.hq ?? null, confidence: 0.7, source: src },
    fundingTotal: { value: c.fundingTotal ?? null, confidence: 0.7, source: src },
    latestRound: { value: c.latestRound ?? null, confidence: 0.7, source: src },
    latestRoundDate: { value: c.latestRoundDate ?? null, confidence: 0.7, source: src },
    revenueBand: { value: c.revenueBand ?? null, confidence: 0.6, source: src },
    ownership: { value: c.ownership ?? null, confidence: 0.7, source: src },
  };
}

type MatchArgs = { name: string; domain: string };

async function realMatch({ name, domain }: MatchArgs) {
  const res = await fetchWithTimeout("https://api.apollo.io/api/v1/people/match", {
    method: "POST",
    headers: { "X-Api-Key": process.env.APOLLO_API_KEY!, "Content-Type": "application/json" },
    body: JSON.stringify({ name, domain }),
  });
  if (!res.ok) throw new Error(`Apollo ${res.status}`);
  const p = (await res.json()).person ?? {};
  const src = "apollo.io";
  return {
    title: { value: p.title ?? null, confidence: 0.85, source: src },
    seniority: { value: p.seniority ?? null, confidence: 0.8, source: src },
    department: { value: p.departments?.[0] ?? null, confidence: 0.75, source: src },
    tenureMonths: { value: null, confidence: 0, source: src },
    jobChange: { value: null, confidence: 0, source: src },
    buyingRole: { value: null, confidence: 0, source: src },
    emailVerified: { value: p.email_status ? p.email_status === "verified" : null, confidence: 0.7, source: src },
  };
}
async function mockMatch({ domain }: MatchArgs) {
  const p = loadFixture(domain).person ?? {};
  const src = "fixture:apollo";
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

export const apolloOrgEnrich = pickImpl(process.env.APOLLO_API_KEY, realOrg, mockOrg);
export const apolloPersonMatch = pickImpl(process.env.APOLLO_API_KEY, realMatch, mockMatch);
