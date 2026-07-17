# Lead Ledger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Next.js dashboard that syncs HubSpot contacts and runs an orchestrator + 7 specialized subagents (via the Anthropic SDK Tool Runner) on each contact to produce a cited priority score, streamed live in a CLI-harness view, with human-approved write-back to HubSpot.

**Architecture:** Next.js App Router (TypeScript) full-stack. SQLite (Drizzle + better-sqlite3) for contacts/runs/scores. Agents run in Next API routes on `@anthropic-ai/sdk` with the beta Tool Runner; orchestration (plan → parallel fan-out → verify → score → synthesize) is explicit TypeScript, not model self-delegation. Every enrichment tool is a provider adapter that calls a real free API when its key is present and returns a fixture otherwise, so the demo is deterministic. A per-run `EventEmitter` streams typed events to an SSE endpoint feeding the live view; events persist to `run_events` for replay. Scoring is deterministic code; the Verification agent only flags, never moves the score.

**Tech Stack:** Next.js 15 (App Router), TypeScript, Tailwind, Drizzle ORM + better-sqlite3, `@anthropic-ai/sdk` (beta Tool Runner + `betaZodTool`), Zod, Server-Sent Events. Reference the design spec `docs/superpowers/specs/2026-07-17-lead-ledger-design.md` for the ICP definition, the verbatim system prompts, and the seed-contact archetypes.

---

## File Structure

```
package.json  tsconfig.json  next.config.mjs  tailwind.config.ts  drizzle.config.ts  .env.example
src/
  db/
    schema.ts            # Drizzle tables
    index.ts             # better-sqlite3 client + db export
    seed.ts              # npm run seed → insert 12 fixture contacts + default ICP
  fixtures/
    contacts.ts          # 12 seed contacts (Northwind, Vertex, Harborview, +9)
    enrichment/          # <domain>.json per seed company — deterministic tool data
  lib/
    icp.ts               # IcpConfig type + DEFAULT_ICP (from spec ICP section)
    models.ts            # model-id + effort constants
    anthropic.ts         # shared Anthropic client
    tools/
      adapter.ts         # pickImpl(envKey, realFn, mockFn) helper
      pdl.ts apollo.ts hunter.ts gdelt.ts websearch.ts fetchUrl.ts techstack.ts github.ts hubspotTools.ts
      registry.ts        # betaZodTool definitions keyed by name; TOOLSETS per agent
    agents/
      schemas.ts         # Zod output schema per agent
      prompts.ts         # SYSTEM_PROMPTS (verbatim from spec)
      config.ts          # AGENTS: declarative config array
      runSubagent.ts     # generic subagent runner (Tool Runner + submit tool)
      orchestrator.ts    # runContact(): plan → fan out → verify → fit → score → synthesize
    events.ts            # RunEvent type + RunBus (EventEmitter) + persist to run_events
    runStore.ts          # in-memory Map<runId, RunBus>; getOrCreate / get
    scoring.ts           # computeFit / computeEngagement / blend / grade / needsReview
    scoring.test.ts
    citation.ts          # citation-integrity gate
    citation.test.ts
    hubspot/
      sync.ts            # syncContacts(): real HubSpot or fixtures → contacts table
      writeback.ts       # applyWriteback(): properties + note, real or dry-run
  app/
    layout.tsx  globals.css  page.tsx           # dashboard (ranked queue + tabs)
    contacts/[id]/page.tsx                       # detail + live view + approval
    api/
      sync/route.ts                              # POST → sync + queue runs
      contacts/route.ts                          # GET ranked list
      runs/[contactId]/route.ts                  # POST → start a run, returns runId
      runs/[runId]/stream/route.ts               # GET → SSE stream (replay + live)
      writeback/[contactId]/route.ts             # POST → approve & write
      icp/route.ts                               # GET/PUT ICP config
    components/
      RankedQueue.tsx  StatusTabs.tsx  ScoreBars.tsx
      LiveView.tsx  PipelineGraph.tsx  LogStream.tsx
      WritebackPanel.tsx  IcpEditor.tsx
```

---

## Phase 1 — Scaffold + data

### Task 1: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.mjs`, `tailwind.config.ts`, `src/app/globals.css`, `src/app/layout.tsx`, `src/app/page.tsx`, `.env.example`, `.gitignore`

- [ ] **Step 1: Scaffold and install.**

Run:
```bash
cd /home/steve/Projects/lead-ledger
npx create-next-app@latest . --ts --tailwind --app --src-dir --no-eslint --use-npm --yes
npm i @anthropic-ai/sdk zod drizzle-orm better-sqlite3
npm i -D drizzle-kit @types/better-sqlite3 vitest
```

- [ ] **Step 2: Add scripts and `.env.example`.**

Add to `package.json` `"scripts"`:
```json
"seed": "tsx src/db/seed.ts",
"test": "vitest run",
"db:push": "drizzle-kit push"
```
Install tsx: `npm i -D tsx`.

Create `.env.example`:
```
ANTHROPIC_API_KEY=
HUBSPOT_TOKEN=
PDL_API_KEY=
APOLLO_API_KEY=
HUNTER_API_KEY=
GITHUB_TOKEN=
# GDELT + website scrape need no key. Leave any blank → that source uses fixtures.
```
Append `data.sqlite` and `.superpowers/` to `.gitignore`.

- [ ] **Step 3: Verify it runs.**

Run: `npm run dev` and open http://localhost:3000
Expected: default Next.js page renders with no errors. Stop the server.

### Task 2: Database schema

**Files:**
- Create: `src/db/schema.ts`, `src/db/index.ts`, `drizzle.config.ts`

- [ ] **Step 1: Write `src/db/schema.ts`.**

```ts
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const contacts = sqliteTable("contacts", {
  id: text("id").primaryKey(),                 // hubspot id or fixture id
  name: text("name").notNull(),
  email: text("email"),
  title: text("title"),
  companyName: text("company_name"),
  companyDomain: text("company_domain"),
  props: text("props", { mode: "json" }).$type<Record<string, unknown>>(),
  syncedAt: integer("synced_at", { mode: "timestamp" }).notNull(),
});

export const runs = sqliteTable("runs", {
  id: text("id").primaryKey(),
  contactId: text("contact_id").notNull(),
  status: text("status").notNull(),            // queued|running|scored|error
  plan: text("plan", { mode: "json" }),
  startedAt: integer("started_at", { mode: "timestamp" }),
  finishedAt: integer("finished_at", { mode: "timestamp" }),
});

export const runEvents = sqliteTable("run_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  runId: text("run_id").notNull(),
  agent: text("agent").notNull(),
  type: text("type").notNull(),
  payload: text("payload", { mode: "json" }),
  ts: integer("ts", { mode: "timestamp" }).notNull(),
});

export const dossiers = sqliteTable("dossiers", {
  runId: text("run_id").primaryKey(),
  perAgent: text("per_agent", { mode: "json" }),
  verification: text("verification", { mode: "json" }),
  merged: text("merged", { mode: "json" }),
});

export const scores = sqliteTable("scores", {
  runId: text("run_id").primaryKey(),
  contactId: text("contact_id").notNull(),
  fit: integer("fit").notNull(),
  engagement: integer("engagement").notNull(),
  priority: integer("priority").notNull(),
  grade: text("grade").notNull(),
  needsReview: integer("needs_review", { mode: "boolean" }).notNull(),
  reviewReasons: text("review_reasons", { mode: "json" }).$type<string[]>(),
  rationale: text("rationale"),
  nextStep: text("next_step"),
  citations: text("citations", { mode: "json" }),
});

export const writebacks = sqliteTable("writebacks", {
  contactId: text("contact_id").primaryKey(),
  status: text("status").notNull(),            // pending|approved|written|skipped
  payload: text("payload", { mode: "json" }),
  approvedAt: integer("approved_at", { mode: "timestamp" }),
  writtenAt: integer("written_at", { mode: "timestamp" }),
});

export const icpConfig = sqliteTable("icp_config", {
  id: text("id").primaryKey(),                 // always "default"
  config: text("config", { mode: "json" }).notNull(),
});
```

- [ ] **Step 2: Write `src/db/index.ts`.**

```ts
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

const sqlite = new Database(process.env.SQLITE_PATH ?? "data.sqlite");
sqlite.pragma("journal_mode = WAL");
export const db = drizzle(sqlite, { schema });
export { schema };
```

- [ ] **Step 3: Write `drizzle.config.ts`** and push the schema.

```ts
import type { Config } from "drizzle-kit";
export default {
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: { url: "data.sqlite" },
} satisfies Config;
```

Run: `npm run db:push`
Expected: creates `data.sqlite` with all tables, no errors.

### Task 3: ICP config + seed contacts + fixtures

**Files:**
- Create: `src/lib/icp.ts`, `src/fixtures/contacts.ts`, `src/fixtures/enrichment/northwind.dev.json` (and one per seed domain), `src/db/seed.ts`

- [ ] **Step 1: Write `src/lib/icp.ts`.**

Encode the spec's ICP section as a typed default. Keep scoring weights here so the ICP editor can tune them.
```ts
export type IcpConfig = {
  industries: string[];
  headcount: { min: number; max: number; sweet: [number, number] };
  fundingStages: string[];       // ["seed","series_a","series_b"]
  fundingRecencyMonths: number;  // 12
  competitors: string[];         // ["Datadog","New Relic"]
  buyerTitles: string[];         // technical leadership
  disqualifiers: string[];
  weights: { firmographic: number; role: number; technographic: number };
  blend: { fit: number; engagement: number };   // 0.6 / 0.4
  engagementDecayPerMonth: number;              // 0.15
  reviewBand: [number, number];                 // [45, 65]
};

export const DEFAULT_ICP: IcpConfig = {
  industries: ["software", "saas", "internet", "ai"],
  headcount: { min: 20, max: 300, sweet: [30, 150] },
  fundingStages: ["seed", "series_a", "series_b"],
  fundingRecencyMonths: 12,
  competitors: ["Datadog", "New Relic"],
  buyerTitles: ["CTO", "VP Engineering", "Head of Platform", "SRE", "DevOps", "Staff Engineer"],
  disqualifiers: ["no engineering org", "pre-product under 15", "1000+ enterprise incumbent", "offline business"],
  weights: { firmographic: 0.4, role: 0.3, technographic: 0.3 },
  blend: { fit: 0.6, engagement: 0.4 },
  engagementDecayPerMonth: 0.15,
  reviewBand: [45, 65],
};
```

- [ ] **Step 2: Write `src/fixtures/contacts.ts`** — the 12 seed contacts.

Use the three anchor archetypes from the spec (Northwind Labs / Priya Nair ~88, Vertex AI Studio / Alex Chen ~55 needs-review, Harborview Dental / Pat Ruiz ~18) plus 9 more spanning B/C with one or two extra borderline cases. Each entry: `{ id, name, email, title, companyName, companyDomain }`.
```ts
export const SEED_CONTACTS = [
  { id: "c-northwind", name: "Priya Nair", email: "priya@northwind.dev", title: "VP Engineering", companyName: "Northwind Labs", companyDomain: "northwind.dev" },
  { id: "c-vertex", name: "Alex Chen", email: "alex.chen91@gmail.com", title: "Product Manager", companyName: "Vertex AI Studio", companyDomain: "vertexai.studio" },
  { id: "c-harborview", name: "Pat Ruiz", email: "pat@harborviewdental.com", title: "Practice Administrator", companyName: "Harborview Dental Group", companyDomain: "harborviewdental.com" },
  // ...9 more spanning grades B and C; include one extra needs-review case.
] as const;
```

- [ ] **Step 3: Write one enrichment fixture per domain.**

`src/fixtures/enrichment/northwind.dev.json` shape (this is the shared ground truth every tool adapter reads from in mock mode — see Phase 2):
```json
{
  "company": { "industry": "software", "headcount": 140, "headcountGrowth90d": 0.35, "revenueBand": "$10M-$50M", "hq": "SF", "ownership": "private", "fundingTotal": "$55M", "latestRound": "Series B", "latestRoundDate": "2026-03-01" },
  "person": { "title": "VP Engineering", "seniority": "VP", "department": "Engineering", "tenureMonths": 2, "jobChange": true, "buyingRole": "champion", "emailVerified": true },
  "tech": { "technologies": ["Next.js","Node","AWS","Vercel","Prometheus"], "competitorPresent": false, "competitorEvidence": null, "githubOrg": "northwind", "statusPage": true, "recentIncident": true },
  "news": [{ "date": "2026-03-01", "type": "funding", "summary": "Series B $40M", "source": "https://example.com/northwind-series-b", "talkingPoint": "Congrats on the Series B — scaling reliability?", "fresh": true }],
  "engagement": { "topActions": ["pricing_page_view","email_open"], "recencyDays": 3, "rawSignals": [{ "type": "pricing_page_view", "count": 1 }, { "type": "email_open", "count": 3 }], "attributionUncertain": false }
}
```
For `vertexai.studio`, encode the planted conflicts (funding 8 months old, `competitorPresent: true` with `competitorEvidence: "single job posting"`, person title "Product Manager" with `buyingRole: "user"`, `emailVerified: false`, `attributionUncertain: true`). For `harborviewdental.com`, encode the disqualifiers (non-software, no github, empty news).

- [ ] **Step 4: Write `src/db/seed.ts`** — insert contacts + default ICP.

```ts
import { db, schema } from "./index";
import { SEED_CONTACTS } from "../fixtures/contacts";
import { DEFAULT_ICP } from "../lib/icp";

const now = new Date();
db.insert(schema.contacts).values(SEED_CONTACTS.map(c => ({ ...c, props: {}, syncedAt: now }))).run();
db.insert(schema.icpConfig).values({ id: "default", config: DEFAULT_ICP }).onConflictDoNothing().run();
console.log(`Seeded ${SEED_CONTACTS.length} contacts.`);
```

Run: `npm run seed`
Expected: `Seeded 12 contacts.` Verify with `sqlite3 data.sqlite "select count(*) from contacts;"` → `12`.

---

## Phase 2 — Provider adapters

Each tool has a real impl (calls the free API) and a mock impl (reads the domain fixture). `pickImpl` chooses at call time by env-key presence, so a demo with no keys is fully deterministic, and adding a key "lights up" that source.

### Task 4: Adapter helper + fixture loader

**Files:**
- Create: `src/lib/tools/adapter.ts`
- Test: `src/lib/tools/adapter.test.ts`

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, it, expect } from "vitest";
import { pickImpl } from "./adapter";

describe("pickImpl", () => {
  it("uses mock when key absent", async () => {
    const fn = pickImpl(undefined, async () => "real", async () => "mock");
    expect(await fn()).toBe("mock");
  });
  it("uses real when key present", async () => {
    const fn = pickImpl("k", async () => "real", async () => "mock");
    expect(await fn()).toBe("real");
  });
});
```

- [ ] **Step 2: Run it — fails (module missing).** Run: `npm test -- adapter`. Expected: FAIL "Cannot find module './adapter'".

- [ ] **Step 3: Implement `src/lib/tools/adapter.ts`.**

```ts
import fs from "node:fs";
import path from "node:path";

export function pickImpl<A extends unknown[], R>(
  key: string | undefined,
  real: (...a: A) => Promise<R>,
  mock: (...a: A) => Promise<R>,
) {
  return (...a: A) => (key ? real(...a) : mock(...a));
}

const dir = path.join(process.cwd(), "src/fixtures/enrichment");
export function loadFixture(domain: string): Record<string, any> {
  const f = path.join(dir, `${domain}.json`);
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : {};
}
```

- [ ] **Step 4: Run test — passes.** Run: `npm test -- adapter`. Expected: PASS 2/2.

### Task 5: The nine tool adapters

**Files:**
- Create: `src/lib/tools/{pdl,apollo,hunter,gdelt,websearch,fetchUrl,techstack,github,hubspotTools}.ts`

Each file exports one async function following the same shape: real path calls the API, mock path returns the relevant slice of `loadFixture(domain)`, and both wrap fields as `{ value, confidence, source }` where the spec requires per-field provenance.

- [ ] **Step 1: Implement one adapter fully as the reference — `src/lib/tools/pdl.ts`.**

```ts
import { pickImpl, loadFixture } from "./adapter";

export type FieldVal<T> = { value: T; confidence: number; source: string };

async function realCompany(domain: string) {
  const res = await fetch(`https://api.peopledatalabs.com/v5/company/enrich?website=${domain}`, {
    headers: { "X-Api-Key": process.env.PDL_API_KEY! },
  });
  if (!res.ok) throw new Error(`PDL ${res.status}`);
  const d = await res.json();
  return {
    industry: { value: d.industry, confidence: 0.9, source: "peopledatalabs.com" },
    headcount: { value: d.employee_count, confidence: 0.85, source: "peopledatalabs.com" },
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
  };
}
export const pdlCompanyEnrich = pickImpl(process.env.PDL_API_KEY, realCompany, mockCompany);
```

- [ ] **Step 2: Implement the other eight adapters on the same pattern.** Real/mock function names and the fixture slice each reads:

| File | Export | Env key | Fixture slice | Real endpoint (free) |
|---|---|---|---|---|
| `apollo.ts` | `apolloOrgEnrich`, `apolloPersonMatch` | `APOLLO_API_KEY` | `.company`, `.person` | `api.apollo.io/v1/organizations/enrich`, `/people/match` |
| `hunter.ts` | `hunterVerifyEmail` | `HUNTER_API_KEY` | `.person.emailVerified` | `api.hunter.io/v2/email-verifier` |
| `gdelt.ts` | `gdeltNewsSearch` | *(none — always real)* | `.news` (fallback) | `api.gdeltproject.org/api/v2/doc/doc?format=json` |
| `websearch.ts` | `webSearch` | `SERPAPI_KEY` (optional) | `.news` | SerpAPI or Brave free tier |
| `fetchUrl.ts` | `fetchUrl` | *(none — always real)* | n/a — real HTTP GET, returns text | `fetch(url)` |
| `techstack.ts` | `detectTechStack` | *(none — scrape based)* | `.tech` | `fetchUrl(domain)` + regex/header fingerprint |
| `github.ts` | `githubOrgLookup` | `GITHUB_TOKEN` (optional) | `.tech.githubOrg` | `api.github.com/orgs/{org}` |
| `hubspotTools.ts` | `hubspotGetContact`, `hubspotGetEngagements` | `HUBSPOT_TOKEN` | contact row + `.engagement` | `api.hubapi.com/crm/v3/objects/contacts/{id}` |

`gdeltNewsSearch` and `fetchUrl` are genuinely keyless: implement the real path, and for the fictional seed domains (which GDELT won't have) fall back to the fixture `.news` when the live call returns nothing.

- [ ] **Step 3: Verify each adapter returns fixture data for a seed domain.** Write `src/lib/tools/adapters.smoke.test.ts` that calls each adapter with `northwind.dev` and asserts a non-null field. Run: `npm test -- adapters.smoke`. Expected: PASS.

### Task 6: Tool registry (betaZodTool) + per-agent toolsets

**Files:**
- Create: `src/lib/tools/registry.ts`, `src/lib/agents/schemas.ts`

- [ ] **Step 1: Write `src/lib/agents/schemas.ts`** — one Zod schema per subagent output, matching the "Returns" line in the spec's roster. Example for the Company agent:

```ts
import { z } from "zod";
const field = <T extends z.ZodTypeAny>(t: T) =>
  z.object({ value: t.nullable(), confidence: z.number(), source: z.string() });

export const CompanyFindings = z.object({
  industry: field(z.string()), headcount: field(z.number()),
  revenueBand: field(z.string()), funding: field(z.string()),
  latestRoundDate: field(z.string()), headcountGrowth90d: field(z.number()),
});
// ...Contact, Tech, News, Engagement, Verification, IcpFit schemas per spec.
```

- [ ] **Step 2: Write `src/lib/tools/registry.ts`** — wrap each adapter as a `betaZodTool`, and export the per-agent toolset arrays plus a strict `submit_findings` tool factory.

```ts
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { pdlCompanyEnrich } from "./pdl";
// ...other adapter imports

export const TOOLS = {
  pdl_company_enrich: betaZodTool({
    name: "pdl_company_enrich",
    description: "Enrich a company by domain: industry, headcount, revenue, funding, growth.",
    inputSchema: z.object({ domain: z.string() }),
    run: async ({ domain }) => JSON.stringify(await pdlCompanyEnrich(domain)),
  }),
  // ...one entry per adapter
};

// submit tool: the subagent's terminal action returns its structured findings.
export function submitTool(schema: z.ZodTypeAny) {
  return betaZodTool({
    name: "submit_findings",
    description: "Call exactly once when done to return your final structured findings.",
    inputSchema: schema as any,
    run: async () => "submitted",
  });
}

export const TOOLSETS: Record<string, (keyof typeof TOOLS)[]> = {
  company: ["pdl_company_enrich", "apollo_org_enrich", "crunchbase_funding"],
  contact: ["pdl_person_enrich", "apollo_person_match", "hunter_verify_email", "hubspot_get_contact"],
  tech: ["fetch_url", "detect_tech_stack", "github_org_lookup"],
  news: ["gdelt_news_search", "web_search"],
  engagement: ["hubspot_get_contact", "hubspot_get_engagements"],
  verification: ["fetch_url"],
  icpfit: [],
};
```

Note the `submit_findings` pattern: rather than mixing `output_config.format` with the tool loop, each subagent's last action is calling `submit_findings` with schema-validated input. The runner (Task 8) captures that call's `input` as the structured result.

- [ ] **Step 3: Verify registry loads.** Run: `npx tsx -e "import('./src/lib/tools/registry.ts').then(m=>console.log(Object.keys(m.TOOLS)))"`. Expected: prints the tool names.

---

## Phase 3 — Agents

### Task 7: Prompts, models, agent config

**Files:**
- Create: `src/lib/models.ts`, `src/lib/anthropic.ts`, `src/lib/agents/prompts.ts`, `src/lib/agents/config.ts`

- [ ] **Step 1: `src/lib/models.ts`.**

```ts
export const MODELS = { orchestrator: "claude-opus-4-8", subagent: "claude-sonnet-5", synthesis: "claude-opus-4-8" } as const;
export const EFFORT = { orchestrator: "high", subagent: "low", synthesis: "high" } as const;
```

- [ ] **Step 2: `src/lib/anthropic.ts`.**

```ts
import Anthropic from "@anthropic-ai/sdk";
export const anthropic = new Anthropic(); // reads ANTHROPIC_API_KEY
```

- [ ] **Step 3: `src/lib/agents/prompts.ts`** — paste the eight system prompts **verbatim** from the spec's "System prompts" section (Orchestrator, Company, Contact, Tech, News, Engagement, Verification, ICP-Fit, Synthesis).

```ts
export const SYSTEM_PROMPTS = {
  orchestrator: `You are the lead orchestrator for Tracepoint's sales-research system...`,
  company: `You research the company behind a lead for a dev-tools vendor...`,
  // ...verbatim from docs/superpowers/specs/2026-07-17-lead-ledger-design.md
} as const;
```

- [ ] **Step 4: `src/lib/agents/config.ts`** — the declarative roster. Fan-out agents 1–5 run in parallel; verification (6) and icpfit (7) run after; synthesis is separate.

```ts
import { MODELS, EFFORT } from "../models";
import { SYSTEM_PROMPTS } from "./prompts";
import * as S from "./schemas";

export const FANOUT = [
  { key: "company",    system: SYSTEM_PROMPTS.company,    schema: S.CompanyFindings },
  { key: "contact",    system: SYSTEM_PROMPTS.contact,    schema: S.ContactFindings },
  { key: "tech",       system: SYSTEM_PROMPTS.tech,       schema: S.TechFindings },
  { key: "news",       system: SYSTEM_PROMPTS.news,       schema: S.NewsFindings },
  { key: "engagement", system: SYSTEM_PROMPTS.engagement, schema: S.EngagementFindings },
] as const;
export const VERIFICATION = { key: "verification", system: SYSTEM_PROMPTS.verification, schema: S.VerificationFindings };
export const ICPFIT = { key: "icpfit", system: SYSTEM_PROMPTS.icpfit, schema: S.IcpFitFindings };
export { MODELS, EFFORT };
```

### Task 8: Generic subagent runner

**Files:**
- Create: `src/lib/agents/runSubagent.ts`

- [ ] **Step 1: Implement `runSubagent`.** It builds the tool list (agent toolset + submit tool), streams the Tool Runner, emits live events, and returns the schema-validated `submit_findings` input.

```ts
import { anthropic } from "../anthropic";
import { TOOLS, TOOLSETS, submitTool } from "../tools/registry";
import { MODELS, EFFORT } from "../models";
import type { RunBus } from "../events";

export async function runSubagent(opts: {
  bus: RunBus; agentKey: string; system: string; schema: any;
  input: string;
}) {
  const { bus, agentKey, system, schema, input } = opts;
  const toolNames = TOOLSETS[agentKey] ?? [];
  const tools = [...toolNames.map(n => TOOLS[n]), submitTool(schema)];
  let findings: unknown = null;

  bus.emit({ agent: agentKey, type: "agent_started", payload: {} });
  const runner = anthropic.beta.messages.toolRunner({
    model: MODELS.subagent,
    max_tokens: 8000,
    output_config: { effort: EFFORT.subagent },
    system,
    tools,
    messages: [{ role: "user", content: input }],
    stream: true,
  });

  for await (const stream of runner) {
    for await (const ev of stream) {
      if (ev.type === "content_block_start" && ev.content_block.type === "tool_use") {
        bus.emit({ agent: agentKey, type: "agent_tool_call", payload: { name: ev.content_block.name } });
        if (ev.content_block.name === "submit_findings") findings = ev.content_block.input;
      }
      if (ev.type === "content_block_delta" && ev.delta.type === "text_delta")
        bus.emit({ agent: agentKey, type: "agent_token", payload: { text: ev.delta.text } });
    }
    const msg = await stream.finalMessage();
    for (const b of msg.content)
      if (b.type === "tool_result") bus.emit({ agent: agentKey, type: "agent_tool_result", payload: {} });
  }

  const parsed = schema.parse(findings);
  bus.emit({ agent: agentKey, type: "agent_completed", payload: parsed });
  return parsed;
}
```

- [ ] **Step 2: Verify one subagent end-to-end.** Requires `ANTHROPIC_API_KEY` (agents are the one part that needs the real key; enrichment stays on fixtures). Write `scripts/try-contact-agent.ts` that builds a no-op `RunBus`, seeds the DB, and runs the contact agent on Priya Nair with input `JSON.stringify({ contact, domain: "northwind.dev" })`.

Run: `npx tsx scripts/try-contact-agent.ts`
Expected: prints a `ContactFindings`-valid object with `title.value === "VP Engineering"` and per-field `{value,confidence,source}`. If it throws on `schema.parse`, the prompt or submit tool needs adjustment — iterate until valid.

---

## Phase 4 — Orchestrate + score

### Task 9: Deterministic scorer (TDD)

**Files:**
- Create: `src/lib/scoring.ts`, `src/lib/scoring.test.ts`

- [ ] **Step 1: Write the failing tests** encoding the three anchors.

```ts
import { describe, it, expect } from "vitest";
import { score } from "./scoring";
import { DEFAULT_ICP } from "./icp";

const high = { icpFit: { firmographic: 0.95, role: 1, technographic: 0.9, conflicts: [] },
  engagement: { topActions: ["demo_request","pricing_page_view"], recencyDays: 3 }, verification: { contradictions: [], unsupported: 0 } };
const low = { icpFit: { firmographic: 0.05, role: 0, technographic: 0, conflicts: ["non-software"] },
  engagement: { topActions: [], recencyDays: 999 }, verification: { contradictions: [], unsupported: 0 } };
const mid = { icpFit: { firmographic: 0.8, role: 0.3, technographic: 0.3, conflicts: ["stale funding","competitor present"] },
  engagement: { topActions: ["pricing_page_view"], recencyDays: 10 }, verification: { contradictions: ["role mismatch"], unsupported: 2 }, identityUnverified: true };

describe("score", () => {
  it("clear high → A, no review", () => { const r = score(high, DEFAULT_ICP); expect(r.priority).toBeGreaterThanOrEqual(75); expect(r.grade).toBe("A"); expect(r.needsReview).toBe(false); });
  it("clear low → D", () => { const r = score(low, DEFAULT_ICP); expect(r.priority).toBeLessThan(35); expect(r.grade).toBe("D"); });
  it("ambiguous → needs review, verification never moved the number", () => {
    const r = score(mid, DEFAULT_ICP);
    expect(r.needsReview).toBe(true);
    expect(r.reviewReasons).toContain("verification contradiction");
    const noVerif = score({ ...mid, verification: { contradictions: [], unsupported: 0 } }, DEFAULT_ICP);
    expect(r.priority).toBe(noVerif.priority); // verification flags, never scores
  });
});
```

- [ ] **Step 2: Run — fails.** Run: `npm test -- scoring`. Expected: FAIL (no `score`).

- [ ] **Step 3: Implement `src/lib/scoring.ts`.**

```ts
import type { IcpConfig } from "./icp";

export function computeFit(icpFit: any, icp: IcpConfig) {
  const w = icp.weights;
  const raw = icpFit.firmographic * w.firmographic + icpFit.role * w.role + icpFit.technographic * w.technographic;
  const disqualified = (icpFit.conflicts ?? []).some((c: string) => icp.disqualifiers.some(d => c.includes(d.split(" ")[0])));
  return Math.round((disqualified ? Math.min(raw, 0.1) : raw) * 100);
}

export function computeEngagement(e: any, icp: IcpConfig) {
  const weightOf = (a: string) => (a === "demo_request" ? 30 : a === "pricing_page_view" ? 20 : 8);
  const base = Math.min(100, (e.topActions ?? []).reduce((s: number, a: string) => s + weightOf(a), 0));
  const months = e.recencyDays / 30;
  const decay = Math.pow(1 - icp.engagementDecayPerMonth, months);
  return Math.round(base * decay);
}

export function score(d: any, icp: IcpConfig) {
  const fit = computeFit(d.icpFit, icp);
  const engagement = computeEngagement(d.engagement, icp);
  const priority = Math.round(icp.blend.fit * fit + icp.blend.engagement * engagement);
  const grade = priority >= 75 ? "A" : priority >= 55 ? "B" : priority >= 35 ? "C" : "D";
  const reasons: string[] = [];
  if ((d.verification?.contradictions ?? []).length) reasons.push("verification contradiction");
  if ((d.verification?.unsupported ?? 0) >= 2) reasons.push("unsupported claims");
  if (priority >= icp.reviewBand[0] && priority <= icp.reviewBand[1]) reasons.push("ambiguous score band");
  if (d.identityUnverified) reasons.push("identity unverified");
  if ((d.icpFit?.conflicts ?? []).length >= 2) reasons.push("subagent conflict");
  return { fit, engagement, priority, grade, needsReview: reasons.length > 0, reviewReasons: reasons };
}
```

- [ ] **Step 4: Run — passes.** Run: `npm test -- scoring`. Expected: PASS 3/3 (the equality assertion proves verification never moves the number).

### Task 10: Citation-integrity gate (TDD)

**Files:**
- Create: `src/lib/citation.ts`, `src/lib/citation.test.ts`

- [ ] **Step 1: Failing test.**

```ts
import { describe, it, expect } from "vitest";
import { checkCitations } from "./citation";
it("strips a claim with no sourced dossier field", () => {
  const dossier = { funding: { value: "Series B", confidence: 0.9, source: "gdelt" } };
  const rejected = new Set<string>();
  const r = checkCitations([{ text: "Series B", ref: "funding" }, { text: "IPO soon", ref: "ipo" }], dossier, rejected);
  expect(r.kept.map(c => c.ref)).toEqual(["funding"]);
  expect(r.stripped).toContain("ipo");
});
```

- [ ] **Step 2: Run — fails.** Run: `npm test -- citation`. Expected: FAIL.

- [ ] **Step 3: Implement `src/lib/citation.ts`.**

```ts
export function checkCitations(
  claims: { text: string; ref: string }[],
  dossier: Record<string, { source?: string } | undefined>,
  verificationRejected: Set<string>,
) {
  const kept: typeof claims = [];
  const stripped: string[] = [];
  for (const c of claims) {
    const field = dossier[c.ref];
    const ok = field && field.source && !verificationRejected.has(c.ref);
    if (ok) kept.push(c); else stripped.push(c.ref);
  }
  return { kept, stripped };
}
```

- [ ] **Step 4: Run — passes.** Run: `npm test -- citation`. Expected: PASS.

### Task 11: Event bus + run store

**Files:**
- Create: `src/lib/events.ts`, `src/lib/runStore.ts`

- [ ] **Step 1: `src/lib/events.ts`.**

```ts
import { EventEmitter } from "node:events";
import { db, schema } from "../db";

export type RunEvent = { agent: string; type: string; payload: unknown };
export class RunBus extends EventEmitter {
  constructor(public runId: string) { super(); }
  emit(e: RunEvent) {
    db.insert(schema.runEvents).values({ runId: this.runId, agent: e.agent, type: e.type, payload: e.payload, ts: new Date() }).run();
    return super.emit("event", e);
  }
}
```
(`new Date()` here is fine — this is runtime app code, not a workflow script.)

- [ ] **Step 2: `src/lib/runStore.ts`.**

```ts
import { RunBus } from "./events";
const buses = new Map<string, RunBus>();
export const getBus = (id: string) => buses.get(id);
export const makeBus = (id: string) => { const b = new RunBus(id); buses.set(id, b); return b; };
export const dropBus = (id: string) => buses.delete(id);
```

### Task 12: Orchestrator

**Files:**
- Create: `src/lib/agents/orchestrator.ts`

- [ ] **Step 1: Implement `runContact`.**

```ts
import { db, schema } from "../db";
import { eq } from "drizzle-orm";
import { anthropic } from "../anthropic";
import { MODELS, EFFORT, FANOUT, VERIFICATION, ICPFIT } from "./config";
import { SYSTEM_PROMPTS } from "./prompts";
import { runSubagent } from "./runSubagent";
import { score } from "../scoring";
import { checkCitations } from "../citation";
import { makeBus, dropBus } from "../runStore";
import { DEFAULT_ICP } from "../icp";

export async function runContact(runId: string, contactId: string) {
  const bus = makeBus(runId);
  const contact = db.select().from(schema.contacts).where(eq(schema.contacts.id, contactId)).get()!;
  const icp = (db.select().from(schema.icpConfig).where(eq(schema.icpConfig.id, "default")).get()?.config as any) ?? DEFAULT_ICP;
  const input = JSON.stringify({ contact, domain: contact.companyDomain, icp });
  bus.emit({ agent: "orchestrator", type: "run_started", payload: { contactId } });

  try {
    // 1. Plan (Opus). For the showcase the roster is fixed; the plan is narrated + may mark skips.
    bus.emit({ agent: "orchestrator", type: "plan_ready", payload: { agents: FANOUT.map(a => a.key) } });

    // 2. Fan out 1–5 in parallel.
    const partials = Object.fromEntries(await Promise.all(
      FANOUT.map(async a => [a.key, await runSubagent({ bus, agentKey: a.key, system: a.system, schema: a.schema, input })]),
    ));

    // 3. Verification + ICP-Fit run independently on the raw partials.
    const dossierJson = JSON.stringify({ ...partials, icp });
    const [verification, icpFit] = await Promise.all([
      runSubagent({ bus, agentKey: VERIFICATION.key, system: VERIFICATION.system, schema: VERIFICATION.schema, input: dossierJson }),
      runSubagent({ bus, agentKey: ICPFIT.key, system: ICPFIT.system, schema: ICPFIT.schema, input: dossierJson }),
    ]);

    // 4. Deterministic score (verification only flags).
    bus.emit({ agent: "scorer", type: "scoring_started", payload: {} });
    const s = score({ icpFit, engagement: partials.engagement, verification, identityUnverified: partials.contact?.identityUnverified }, icp);

    // 5. Synthesis (Opus) with citation-integrity gate.
    const synth = await synthesize({ bus, partials, s });
    const rejected = new Set<string>((verification.claims ?? []).filter((c: any) => c.verdict === "unsupported").map((c: any) => c.claimId));
    const gate = checkCitations(synth.citations, mergeSources(partials), rejected);

    bus.emit({ agent: "scorer", type: "score_ready", payload: s });
    persist(runId, contactId, partials, verification, s, synth, gate);
    bus.emit({ agent: "orchestrator", type: "run_completed", payload: { priority: s.priority } });
  } catch (e: any) {
    bus.emit({ agent: "orchestrator", type: "agent_error", payload: { message: e.message } });
    db.update(schema.runs).set({ status: "error", finishedAt: new Date() }).where(eq(schema.runs.id, runId)).run();
  } finally {
    setTimeout(() => dropBus(runId), 30_000); // keep bus briefly for late SSE joins
  }
}
```

Implement the small helpers in the same file: `synthesize()` (a single Opus call with `SYSTEM_PROMPTS.synthesis`, `thinking: { type: "adaptive", display: "summarized" }` so its reasoning streams to the live view, returning `{ rationale, nextStep, citations }` via a submit tool); `mergeSources()` (flatten partial fields into `{ ref → { source } }`); `persist()` (write `dossiers`, `scores`, `writebacks` (status `pending`), and set `runs.status = "scored"`).

- [ ] **Step 2: Verify the full run on the three anchors.** Write `scripts/try-run.ts` that seeds, then calls `runContact` for `c-northwind`, `c-vertex`, `c-harborview` and prints each resulting `scores` row.

Run: `npx tsx scripts/try-run.ts`
Expected: Northwind ~88 grade A `needsReview:false`; Harborview ~18 grade D; Vertex ~55 grade C `needsReview:true` with reasons including a verification contradiction and identity-unverified. If numbers are far off, tune the fixture confidences and the ICP-Fit prompt — not the scorer.

---

## Phase 5 — Live view

### Task 13: SSE stream route

**Files:**
- Create: `src/app/api/runs/[runId]/stream/route.ts`, `src/app/api/runs/[contactId]/route.ts`

- [ ] **Step 1: Start-run route** `POST /api/runs/[contactId]` — create a `runs` row (`queued`→`running`), fire `runContact(runId, contactId)` without awaiting, return `{ runId }`.

```ts
import { db, schema } from "@/db";
import { runContact } from "@/lib/agents/orchestrator";
export async function POST(_: Request, { params }: { params: Promise<{ contactId: string }> }) {
  const { contactId } = await params;
  const runId = `run-${contactId}-${Date.now()}`;
  db.insert(schema.runs).values({ id: runId, contactId, status: "running", startedAt: new Date() }).run();
  runContact(runId, contactId); // fire-and-forget
  return Response.json({ runId });
}
```
(`Date.now()` here is runtime app code — allowed.)

- [ ] **Step 2: SSE route** `GET /api/runs/[runId]/stream` — replay persisted `run_events`, then attach to the live `RunBus` if still active.

```ts
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { getBus } from "@/lib/runStore";
export async function GET(_: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const stream = new ReadableStream({
    start(ctrl) {
      const enc = new TextEncoder();
      const send = (e: unknown) => ctrl.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
      for (const row of db.select().from(schema.runEvents).where(eq(schema.runEvents.runId, runId)).all())
        send({ agent: row.agent, type: row.type, payload: row.payload });
      const bus = getBus(runId);
      if (!bus) { send({ type: "run_completed" }); ctrl.close(); return; }
      const onEvent = (e: unknown) => send(e);
      bus.on("event", onEvent);
      bus.once("event", function done(e: any) { if (e.type === "run_completed" || e.type === "agent_error") setTimeout(() => ctrl.close(), 100); });
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" } });
}
```

- [ ] **Step 3: Verify the stream.** With the dev server running and DB seeded, `curl -N -X POST localhost:3000/api/runs/c-northwind` to get a runId, then `curl -N localhost:3000/api/runs/<runId>/stream`.
Expected: a sequence of `data:` events — `run_started`, `plan_ready`, `agent_started`/`agent_tool_call` per subagent, `score_ready`, `run_completed`.

### Task 14: Hybrid live view UI

**Files:**
- Create: `src/app/components/{LiveView,PipelineGraph,LogStream}.tsx`

- [ ] **Step 1: `LiveView.tsx`** — a client component that opens `EventSource(`/api/runs/${runId}/stream`)`, accumulates events into `{ nodeStatuses, log }`, and renders `<PipelineGraph>` (header) over `<LogStream>` (scrolling body).

```tsx
"use client";
import { useEffect, useState } from "react";
export function LiveView({ runId }: { runId: string }) {
  const [events, setEvents] = useState<any[]>([]);
  useEffect(() => {
    const es = new EventSource(`/api/runs/${runId}/stream`);
    es.onmessage = (m) => setEvents(e => [...e, JSON.parse(m.data)]);
    es.addEventListener("error", () => es.close());
    return () => es.close();
  }, [runId]);
  const nodes = ["orchestrator","company","contact","tech","news","engagement","verification","icpfit","scorer"];
  const statusOf = (n: string) => {
    const evs = events.filter(e => e.agent === n);
    if (evs.some(e => e.type === "agent_completed" || e.type === "score_ready")) return "done";
    if (evs.some(e => e.type === "agent_started" || e.type === "scoring_started")) return "running";
    return "wait";
  };
  return (<div><PipelineGraph nodes={nodes} statusOf={statusOf} /><LogStream events={events} /></div>);
}
```

- [ ] **Step 2: `PipelineGraph.tsx`** (node row with waiting/running/done/error colors) and `LogStream.tsx` (nested, monospace, newest at bottom, `agent_token` deltas appended inline under the active agent). Follow the mockups saved in `.superpowers/brainstorm/…/content/live-view.html` (option "Hybrid").

- [ ] **Step 3: Verify visually.** `npm run dev`, open a contact detail page, click Run, watch nodes light up and the log stream fill. Reopen the page after completion → the persisted events replay identically.

---

## Phase 6 — Dashboard + ICP editor

### Task 15: Contacts list API + ranked queue

**Files:**
- Create: `src/app/api/contacts/route.ts`, `src/lib/hubspot/sync.ts`, `src/app/api/sync/route.ts`, `src/app/components/{RankedQueue,StatusTabs,ScoreBars}.tsx`, `src/app/page.tsx`

- [ ] **Step 0: Sync (real path + auto-run).** `src/lib/hubspot/sync.ts` exports `syncContacts()`: if `HUBSPOT_TOKEN` is set, GET `api.hubapi.com/crm/v3/objects/contacts?properties=firstname,lastname,email,jobtitle,company,website` and upsert into `contacts`; otherwise no-op (the seeded fixtures already stand in for a sync). `POST /api/sync/route.ts` calls `syncContacts()`, then — honoring the "auto on sync" decision — starts a run for every contact that has no `scored` run yet (reuse the Task 13 start-run logic), and returns the count. The dashboard gets a **Sync** button (calls this route) alongside per-contact **Run/Re-run**.

- [ ] **Step 1: `GET /api/contacts`** — join `contacts` ⋈ latest `scores` ⋈ `writebacks`, return rows sorted by `priority desc`, with a derived `status` (`scored` / `needs review` / `approved` / `synced`).

- [ ] **Step 2: `page.tsx` + `RankedQueue.tsx` + `StatusTabs.tsx`** — table (rank, contact, company, priority, grade, status) with the four tabs filtering client-side. Match the dashboard mockup in `.superpowers/brainstorm/…/content/dashboard.html`.

- [ ] **Step 3: Verify.** Seed, run all three anchors (a "Run all" button that POSTs each contact), reload dashboard. Expected: queue ranks Northwind > … > Harborview; the "Needs review" tab shows Vertex.

### Task 16: Contact detail + ICP editor

**Files:**
- Create: `src/app/contacts/[id]/page.tsx`, `src/app/api/icp/route.ts`, `src/app/components/IcpEditor.tsx`

- [ ] **Step 1: Detail page** — left: `<ScoreBars>` (fit/engagement) + cited rationale + recommended next step; right: `<LiveView runId>` (with a Run/Re-run button). Pull the score + citations from the `scores` row.

- [ ] **Step 2: ICP editor** — `GET/PUT /api/icp` reads/writes the `icp_config` row; `<IcpEditor>` edits weights + blend + review band. Saving re-scores on the next run.

- [ ] **Step 3: Verify.** Open Priya's detail: bars show fit ~82 / engagement ~44, rationale cites Apollo/GDELT/scrape/HubSpot. Edit the blend to 0.75/0.25, re-run, confirm the priority shifts.

---

## Phase 7 — Write-back approval

### Task 17: Write-back (real or dry-run) with needs-review guard

**Files:**
- Create: `src/lib/hubspot/writeback.ts`, `src/app/api/writeback/[contactId]/route.ts`, `src/app/components/WritebackPanel.tsx`

- [ ] **Step 1: `applyWriteback`** — build the payload (`lead_priority_score`, `lead_grade` custom properties + a timeline note with rationale + next step). If `HUBSPOT_TOKEN` is set, PATCH the contact and POST the note; else log a dry-run and record the payload. Set `writebacks.status = "written"`, `writtenAt = now`.

- [ ] **Step 2: `POST /api/writeback/[contactId]`** — reject with 409 if the contact's score has `needsReview = true` and the request is a batch approval (`{ batch: true }`); allow individual approval always.

```ts
const s = db.select().from(schema.scores).where(eq(schema.scores.contactId, contactId)).get();
const body = await req.json().catch(() => ({}));
if (body.batch && s?.needsReview) return new Response("needs manual review", { status: 409 });
```

- [ ] **Step 3: `WritebackPanel.tsx`** — shows the exact payload preview, Approve & write / Edit / Skip; plus a dashboard "select clear A/B leads → approve all" that skips needs-review rows. Match the checkpoint mockup in `dashboard.html`.

- [ ] **Step 4: Verify.** Approve Priya → payload logged (dry-run) or written to HubSpot; her status → `synced`. Attempt batch-approve including Vertex → Vertex is excluded / 409; individually approving Vertex still works.

---

## Phase 8 — Showcase polish

### Task 18: Polish pass

- [ ] **Step 1:** Streaming token cadence in `LogStream` (small render buffer so text types out); empty/loading/error states on the dashboard and live view; a header that states the Tracepoint premise + pain point from the spec.
- [ ] **Step 2:** Visual pass on colors/spacing per the brainstorm mockups (green/amber/red status semantics; monospace log; pill grades).
- [ ] **Step 3: Verify.** Full walkthrough (see below) reads as a polished demo end to end.

---

## End-to-end verification

With the dev server running and `ANTHROPIC_API_KEY` set (all enrichment on fixtures; no other keys needed):

1. `npm run seed` → 12 contacts.
2. Dashboard → "Run all" → watch runs populate; queue ranks by priority.
3. Open **Priya Nair / Northwind** → click Run → watch the pipeline graph light up and the log stream fan out across the 7 subagents; reopen the page → events replay from `run_events`.
4. Confirm scores: Northwind ~88 (A), Harborview ~18 (D), **Vertex AI Studio ~55 (C) in "Needs review"** with a cited rationale naming the stale-funding / competitor-hint / wrong-role / unverifiable-engagement conflicts, flagged by the Verification agent.
5. Approve Priya's write-back → verify the `lead_priority_score` + `lead_grade` + note payload (HubSpot PATCH if `HUBSPOT_TOKEN` set, else dry-run log). Confirm Vertex cannot be batch-approved.
6. Optional: add a real `PDL_API_KEY` and sync a real HubSpot contact → confirm that source switches from fixture to live with no code change.
