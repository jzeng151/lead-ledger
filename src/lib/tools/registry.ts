import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

import { withTool } from "./adapter";
import { pdlCompanyEnrich, pdlPersonEnrich } from "./pdl";
import { apolloOrgEnrich, apolloPersonMatch } from "./apollo";
import { hunterVerifyEmail } from "./hunter";
import { gdeltNewsSearch } from "./gdelt";
import { webSearch } from "./websearch";
import { fetchUrl } from "./fetchUrl";
import { detectTechStack } from "./techstack";
import { githubOrgLookup } from "./github";
import { hubspotGetContact, hubspotGetEngagements } from "./hubspotTools";

export const TOOLS = {
  pdl_company_enrich: betaZodTool({
    name: "pdl_company_enrich",
    description: "Enrich a company by domain: industry, headcount, revenue, funding, growth.",
    inputSchema: z.object({ domain: z.string() }),
    run: ({ domain }) => withTool("pdl_company_enrich", domain, async () => JSON.stringify(await pdlCompanyEnrich(domain))),
  }),
  pdl_person_enrich: betaZodTool({
    name: "pdl_person_enrich",
    description:
      "Enrich the contact person by company domain: title, seniority, tenure, buying role, email verification.",
    inputSchema: z.object({ domain: z.string() }),
    run: ({ domain }) => withTool("pdl_person_enrich", domain, async () => JSON.stringify(await pdlPersonEnrich(domain))),
  }),
  apollo_org_enrich: betaZodTool({
    name: "apollo_org_enrich",
    description: "Apollo company enrichment by domain.",
    inputSchema: z.object({ domain: z.string() }),
    run: ({ domain }) => withTool("apollo_org_enrich", domain, async () => JSON.stringify(await apolloOrgEnrich(domain))),
  }),
  apollo_person_match: betaZodTool({
    name: "apollo_person_match",
    description: "Apollo person match by name + domain.",
    inputSchema: z.object({ name: z.string(), domain: z.string() }),
    run: (i) => withTool("apollo_person_match", i.domain, async () => JSON.stringify(await apolloPersonMatch(i))),
  }),
  hunter_verify_email: betaZodTool({
    name: "hunter_verify_email",
    description: "Verify a work email deliverability/confidence.",
    inputSchema: z.object({ email: z.string() }),
    run: ({ email }) => withTool("hunter_verify_email", email, async () => JSON.stringify(await hunterVerifyEmail(email))),
  }),
  gdelt_news_search: betaZodTool({
    name: "gdelt_news_search",
    description: "Recent news / trigger events for a company - pass the company DOMAIN.",
    inputSchema: z.object({ domain: z.string(), sinceDays: z.number().optional() }),
    run: ({ domain, sinceDays }) =>
      withTool("gdelt_news_search", domain, async () => JSON.stringify(await gdeltNewsSearch({ domain, sinceDays }))),
  }),
  web_search: betaZodTool({
    name: "web_search",
    description: "Open-web news search. Pass the search `query` and the company `domain` (the domain drives demo results).",
    inputSchema: z.object({ query: z.string(), domain: z.string().optional() }),
    run: ({ query, domain }) =>
      withTool("web_search", domain ?? query, async () => JSON.stringify(await webSearch(query, domain))),
  }),
  fetch_url: betaZodTool({
    name: "fetch_url",
    description: "Fetch the text at a URL (read-only).",
    inputSchema: z.object({ url: z.string() }),
    run: ({ url }) => withTool("fetch_url", url, async () => JSON.stringify({ text: await fetchUrl(url) })),
  }),
  detect_tech_stack: betaZodTool({
    name: "detect_tech_stack",
    description: "Detect a company's tech stack + competitor/complement signals by domain.",
    inputSchema: z.object({ domain: z.string() }),
    run: ({ domain }) => withTool("detect_tech_stack", domain, async () => JSON.stringify(await detectTechStack(domain))),
  }),
  github_org_lookup: betaZodTool({
    name: "github_org_lookup",
    description: "Look up a GitHub org by login.",
    inputSchema: z.object({ org: z.string() }),
    run: ({ org }) => withTool("github_org_lookup", org, async () => JSON.stringify(await githubOrgLookup(org))),
  }),
  hubspot_get_contact: betaZodTool({
    name: "hubspot_get_contact",
    description: "Read the HubSpot contact record by id.",
    inputSchema: z.object({ id: z.string() }),
    run: ({ id }) => withTool("hubspot_get_contact", id, async () => JSON.stringify(await hubspotGetContact(id))),
  }),
  hubspot_get_engagements: betaZodTool({
    name: "hubspot_get_engagements",
    description: "Read the contact's engagement/activity timeline by id.",
    inputSchema: z.object({ contactId: z.string() }),
    run: ({ contactId }) =>
      withTool("hubspot_get_engagements", contactId, async () => JSON.stringify(await hubspotGetEngagements(contactId))),
  }),
};

export function submitTool(schema: z.ZodTypeAny) {
  return betaZodTool({
    name: "submit_findings",
    description:
      "Call exactly once when done to return your final structured findings. This ends your work.",
    inputSchema: schema as any,
    run: async () => "submitted",
  });
}

export const TOOLSETS: Record<string, (keyof typeof TOOLS)[]> = {
  company: ["pdl_company_enrich", "apollo_org_enrich"],
  contact: ["pdl_person_enrich", "apollo_person_match", "hunter_verify_email", "hubspot_get_contact"],
  // fetch_url is the only tool that reaches a third-party site directly, so it is
  // gated like the other live tools: in fixture/demo mode the fictional domains
  // either do not resolve or belong to unrelated real owners, and fingerprinting
  // those would both pollute the demo and hit strangers' servers.
  tech:
    process.env.LEAD_LEDGER_LIVE_TOOLS === "1"
      ? ["fetch_url", "detect_tech_stack", "github_org_lookup"]
      : ["detect_tech_stack", "github_org_lookup"],
  news: ["gdelt_news_search", "web_search"],
  engagement: ["hubspot_get_contact", "hubspot_get_engagements"],
  // Verification may re-fetch a cited source only when live tools are enabled.
  // In fixture/demo mode the seed URLs are fictional and return nothing, so a
  // live re-fetch would wrongly mark every claim unverifiable; there it judges
  // from the provided claims and cross-source consistency instead.
  verification: process.env.LEAD_LEDGER_LIVE_TOOLS === "1" ? ["fetch_url"] : [],
  icpfit: [],
};
