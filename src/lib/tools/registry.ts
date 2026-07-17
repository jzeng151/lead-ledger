import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

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
    run: async ({ domain }) => JSON.stringify(await pdlCompanyEnrich(domain)),
  }),
  pdl_person_enrich: betaZodTool({
    name: "pdl_person_enrich",
    description:
      "Enrich the contact person by company domain: title, seniority, tenure, buying role, email verification.",
    inputSchema: z.object({ domain: z.string() }),
    run: async ({ domain }) => JSON.stringify(await pdlPersonEnrich(domain)),
  }),
  apollo_org_enrich: betaZodTool({
    name: "apollo_org_enrich",
    description: "Apollo company enrichment by domain.",
    inputSchema: z.object({ domain: z.string() }),
    run: async ({ domain }) => JSON.stringify(await apolloOrgEnrich(domain)),
  }),
  apollo_person_match: betaZodTool({
    name: "apollo_person_match",
    description: "Apollo person match by name + domain.",
    inputSchema: z.object({ name: z.string(), domain: z.string() }),
    run: async (i) => JSON.stringify(await apolloPersonMatch(i)),
  }),
  hunter_verify_email: betaZodTool({
    name: "hunter_verify_email",
    description: "Verify a work email deliverability/confidence.",
    inputSchema: z.object({ email: z.string() }),
    run: async ({ email }) => JSON.stringify(await hunterVerifyEmail(email)),
  }),
  gdelt_news_search: betaZodTool({
    name: "gdelt_news_search",
    description: "Recent news/trigger events for a company.",
    inputSchema: z.object({ company: z.string(), sinceDays: z.number().optional() }),
    run: async (i) => JSON.stringify(await gdeltNewsSearch(i)),
  }),
  web_search: betaZodTool({
    name: "web_search",
    description: "Open-web search. Pass the company domain to get results in demo mode.",
    inputSchema: z.object({ query: z.string() }),
    run: async ({ query }) => JSON.stringify(await webSearch(query)),
  }),
  fetch_url: betaZodTool({
    name: "fetch_url",
    description: "Fetch the text at a URL (read-only).",
    inputSchema: z.object({ url: z.string() }),
    run: async ({ url }) => JSON.stringify({ text: await fetchUrl(url) }),
  }),
  detect_tech_stack: betaZodTool({
    name: "detect_tech_stack",
    description: "Detect a company's tech stack + competitor/complement signals by domain.",
    inputSchema: z.object({ domain: z.string() }),
    run: async ({ domain }) => JSON.stringify(await detectTechStack(domain)),
  }),
  github_org_lookup: betaZodTool({
    name: "github_org_lookup",
    description: "Look up a GitHub org by login.",
    inputSchema: z.object({ org: z.string() }),
    run: async ({ org }) => JSON.stringify(await githubOrgLookup(org)),
  }),
  hubspot_get_contact: betaZodTool({
    name: "hubspot_get_contact",
    description: "Read the HubSpot contact record by id.",
    inputSchema: z.object({ id: z.string() }),
    run: async ({ id }) => JSON.stringify(await hubspotGetContact(id)),
  }),
  hubspot_get_engagements: betaZodTool({
    name: "hubspot_get_engagements",
    description: "Read the contact's engagement/activity timeline by id.",
    inputSchema: z.object({ contactId: z.string() }),
    run: async ({ contactId }) => JSON.stringify(await hubspotGetEngagements(contactId)),
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
  tech: ["fetch_url", "detect_tech_stack", "github_org_lookup"],
  news: ["gdelt_news_search", "web_search"],
  engagement: ["hubspot_get_contact", "hubspot_get_engagements"],
  verification: ["fetch_url"],
  icpfit: [],
};
