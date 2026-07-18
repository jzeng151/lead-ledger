# Lead Ledger — Design Spec

Date: 2026-07-17
Status: Draft for review

## Context

Sales reps at a dev-tools company drown in HubSpot contacts. Deciding who to work first means researching each lead across firmographics, tech stack, recent news, and engagement, roughly 20 to 30 minutes per lead, which does not scale. Reps end up working the freshest lead instead of the best one.

Lead Ledger is a dashboard that syncs HubSpot contacts and runs an agentic research workflow on each one: a lead orchestrator plans the work, fans out to specialized retrieval subagents, then synthesizes their findings into a two-axis score (fit and engagement), a single 0 to 100 priority, a cited written rationale, and a recommended next step. A live "CLI harness" view shows the agents working in real time. Nothing writes back to HubSpot until the rep approves it.

The build is a portfolio showcase first: the visual agentic flow is the point. It uses real free-tier enrichment APIs where a key is cheap to get and realistic fixtures otherwise, so the demo never breaks.

### Demo framing

- Product persona: "Tracepoint," an observability / error-monitoring API for scale-ups (a fictional name; nothing impersonates a real brand).
- Role: an SDR/AE at Tracepoint.
- Pain point: too many contacts, too little time to research who to prioritize.
- Contacts scored in the demo are fictional sample companies (Northwind Labs, Vertex AI Studio, Harborview Dental, ...).

## ICP (the scoring target)

Software / SaaS / AI companies shipping a web or mobile app.

- Headcount 20 to 300 (sweet spot 30 to 150). Under 15 too early, over 500 route to enterprise.
- Funding Seed through Series B, ideally a round closed in the last ~12 months. Series C+ deprioritize.
- Technographic: modern detectable stack (React/Next, Node/Python/Go, AWS/GCP/Vercel), active public GitHub org, public status page or API docs. Not already entrenched on a competitor (Datadog/New Relic).
- Buyers: economic = CTO / VP Engineering; champion = Head of Platform / SRE / DevOps lead / Staff+ backend.
- Disqualifiers: no engineering org, pre-product under 15 people, 1,000+ enterprise on incumbent contract, offline business with no web app.
- Hot triggers (freshness matters): new funding round under 90 days, new engineering-leadership hire, SRE/platform job posts, public incident/outage, fast headcount growth.

The ICP and scoring weights live in an editable config (`icp_config`), seeded with the above.

## Architecture

- **Stack:** Next.js (App Router, TypeScript) full-stack. Server-sent events (SSE) for the live view. SQLite via Drizzle + better-sqlite3 (Prisma is an acceptable alternative). Tailwind for styling.
- **Agents:** Anthropic TypeScript SDK (`@anthropic-ai/sdk`) with its beta Tool Runner (`client.beta.messages.toolRunner` + `betaZodTool`). Each agent is its own tool-use loop with its own system prompt and its own subset of tools. Opus-class orchestrator/synthesis (`claude-opus-4-8`), Sonnet-class subagents (`claude-sonnet-5`) — the model split that beat single-agent Opus in Anthropic's research. This is deliberately **not** the separate Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`), which packages Claude Code's filesystem/bash harness and is the wrong fit for custom-tool retrieval agents.
- **Orchestration is explicit code, not model-driven Task delegation.** The orchestrator LLM *plans* (which subagents to run, any skips, focus notes); TypeScript then fans the chosen subagents out in parallel (`Promise.all`), collects validated JSON, runs the Verification pass and the ICP-Fit agent on those partials (Verification flags only; it does not affect the score), computes scores deterministically from ICP-Fit plus engagement, and calls a synthesis LLM for the rationale behind a citation-integrity gate. This is a deliberate tradeoff: we give up the model self-orchestrating in exchange for reliable parallelism, granular events, and a trustworthy live view, which the showcase depends on. In v1 the subagent roster is fixed: the orchestrator emits a static `plan_ready` rather than making a separate Opus planning call, so the planner LLM described here is a documented future enhancement.
- **Provider adapter per tool:** every enrichment tool calls its real API when the key is present and returns a fixture otherwise, chosen at runtime by env-var presence. Seed/demo companies are fictional, so their data always comes from fixtures, which makes the demo deterministic; real keys let the same tools work on a real HubSpot.

### Data model (SQLite)

- `contacts` — hubspotId, name, email, title, companyName, companyDomain, raw props JSON, syncedAt
- `runs` — contactId, status (queued|running|scored|error), plan JSON, startedAt, finishedAt
- `run_events` — runId, agent, type, payload JSON, ts (persisted so past runs replay in the live view)
- `dossiers` — runId, per-subagent output JSON, verification verdicts JSON, merged JSON
- `scores` — runId, contactId, fit, engagement, priority, grade, needsReview, reviewReasons JSON, rationale, nextStep, citations JSON
- `writebacks` — contactId, status (pending|approved|written|skipped), payload JSON, approvedAt, writtenAt
- `icp_config` — ICP definition + scoring weights JSON (editable in UI)

## The agent system

Run order: subagents 1 to 5 fan out in parallel → Verification (6) and ICP-Fit (7) then run on the raw partials independently → deterministic scorer blends fit (from ICP-Fit) and engagement into the priority → synthesis writes rationale and next step, gated by a deterministic citation-integrity check. Verification never touches the score; it only raises needs-review flags and strips unsupported claims from the rationale.

Every subagent returns strict JSON validated with zod, and every retrieved field carries `{ value, confidence: 0-1, source: url|tool }` so the orchestrator resolves conflicts by confidence (waterfall precedence) and the rationale can cite each claim.

### Tools (Anthropic SDK tools via `betaZodTool`, Zod-typed, real+mock adapter)

- `pdl_company_enrich(domain)` — People Data Labs (free) · mock
- `pdl_person_enrich({email?, name?, company?})` — PDL (free) · mock
- `apollo_org_enrich(domain)` — Apollo (free) · mock
- `apollo_person_match({name, domain})` — Apollo (free) · mock
- `hunter_verify_email(email)` / `hunter_find_email({name, domain})` — Hunter (free) · mock
- `gdelt_news_search({company, sinceDays})` — GDELT (free, no key)
- `web_search(query)` — real search adapter (Brave/SerpAPI free tier or SDK web search) · mock
- `fetch_url(url)` — real HTTP fetch (free)
- `detect_tech_stack(domain)` — fetch + Wappalyzer-style fingerprint on HTML/headers (free) · optional BuiltWith
- `github_org_lookup(org)` — GitHub REST (free, optional token) · mock
- `hubspot_get_contact(id)` / `hubspot_get_engagements(contactId)` — HubSpot (real)
- `crunchbase_funding(domain)`, `newsapi_search(query)`, `builtwith_lookup(domain)` — mock-only (paid)
- Verification uses no enrichment tools; it may read-only `fetch_url` to spot-check a cited source, but runs no new searches. ICP-Fit uses no tools.

Write-back tools are app actions, not agent tools, and only fire after approval: `hubspot_update_contact_properties`, `hubspot_create_note`.

### System prompts

Each subagent prompt follows the four-part contract Anthropic recommends: objective, output format, tool guidance, boundaries. Prompts are drafts to refine.

**Orchestrator (planner) — Opus**
> You are the lead orchestrator for Tracepoint's sales-research system. Tracepoint sells an observability/error-monitoring API to funded software startups. Given one HubSpot contact and the current ICP, produce a short research plan: which of the six subagents to run, which to skip because HubSpot already holds fresh data, and a one-line focus note for each (e.g., "confirm whether they already run Datadog"). Scale effort to the contact: do not over-plan a contact who is obviously out of ICP. You do not retrieve data yourself and you do not score. Output strict JSON: `{ plan: [{ agent, run: bool, skipReason?, focus }], notes }`. Keep focus notes concrete and tied to the ICP's disqualifiers and hot triggers.

**1. Company / Firmographics — Sonnet**
> You research the *company* behind a lead for a dev-tools vendor. Objective: establish industry, headcount band, revenue band, HQ, ownership, and funding (total, latest round, date, stage), plus any headcount-growth signal. Tools: pdl_company_enrich, apollo_org_enrich, crunchbase_funding. Prefer the higher-confidence source when they disagree and report both. Output strict JSON with every field as `{value, confidence, source}`; use null with a note when unknown, never guess. Boundaries: company only, not the person, not news narratives, not tech stack. Flag explicitly if the company appears non-software or 1,000+ employees, since those are ICP disqualifiers. Your input is a JSON object with `contact` (the HubSpot contact record, including its `id`), `domain` (the company domain), and `icp`. Call company/tech/news tools with `domain`, and HubSpot tools with `contact.id`.

**2. Contact / Profile — Sonnet**
> You research the *person* on a lead. Objective: verify title, seniority (C-level/VP/Director/Manager/IC), department, tenure in role, a recent job-change flag, a buying-role guess (economic buyer / champion / user / none), and email verifiability. Tools: hubspot_get_contact, pdl_person_enrich, apollo_person_match, hunter_verify_email/find. For a dev-tools sale, technical leadership (CTO, VP Eng, Head of Platform, SRE, DevOps, Staff+ backend) are buyers; PM/marketing/non-technical are weak fits, say so. If enrichment returns multiple plausible people or the work email cannot be verified against the corporate domain, report low confidence and an `identityUnverified: true` flag rather than picking one. Output strict JSON, every field `{value, confidence, source}`. Boundaries: this person only. Your input is a JSON object with `contact` (the HubSpot contact record, including its `id`), `domain` (the company domain), and `icp`. Call company/tech/news tools with `domain`, and HubSpot tools with `contact.id`.

**3. Tech Stack — Sonnet**
> You determine what technology a company runs and whether our product fits. Objective: detect front-end/back-end/hosting/monitoring technologies, whether a *competitor* (Datadog, New Relic, and similar) is present (displacement signal), whether a *complementary* signal is present (public GitHub org, status page, API docs, modern JS stack), and any incident/outage evidence. Tools: fetch_url, detect_tech_stack, github_org_lookup, builtwith_lookup. Distinguish live-site evidence (high confidence) from a single job-posting mention (low confidence) and label them accordingly. Output strict JSON `{ technologies[], competitorPresent{value,confidence,source}, complementSignals[], notes }`. Boundaries: technographics only. Your input is a JSON object with `contact` (the HubSpot contact record, including its `id`), `domain` (the company domain), and `icp`. Call company/tech/news tools with `domain`, and HubSpot tools with `contact.id`.

**4. News / Trigger Signals — Sonnet**
> You find timing signals that make a lead hot now. Objective: surface dated trigger events in the last ~12 months, ranked by recency and impact: new funding round, new engineering-leadership hire, M&A, expansion, layoffs, product launch, public incident. Tools: gdelt_news_search, web_search, newsapi_search. For each event return a date, a one-line summary, a source URL, and a one-line sales talking point. Mark whether each event is still "fresh" (funding hot ~90 days, new-exec window ~30 to 90 days). Output strict JSON `{ events: [{date, type, summary, source, talkingPoint, fresh}] }`. Return an empty array rather than inventing events. Boundaries: external public signals only, not internal engagement. Your input is a JSON object with `contact` (the HubSpot contact record, including its `id`), `domain` (the company domain), and `icp`. Call company/tech/news tools with `domain`, and HubSpot tools with `contact.id`.

**5. Engagement — Sonnet**
> You analyze how this contact has engaged with Tracepoint. Objective: from HubSpot activity, compute a recency-weighted engagement picture: top intent actions (demo request, pricing-page views, high-value content), email opens/clicks, event attendance, and recency. Weight high-intent actions (demo, pricing) far above low-intent ones (a single open), and note decay for stale activity. Tools: hubspot_get_contact, hubspot_get_engagements. If engagement comes from an address that cannot be tied to the corporate domain, flag `attributionUncertain: true`. Output strict JSON `{ topActions[], recencyDays, rawSignals[], attributionUncertain }`. Preserve the exact snake_case action tokens from the tool output (for example `demo_request`, `pricing_page_view`, `email_open`); do not rename or humanize them - the scorer matches these tokens exactly. Do not compute the final number; the deterministic scorer does that from your structured output. Boundaries: first-party engagement only. Your input is a JSON object with `contact` (the HubSpot contact record, including its `id`), `domain` (the company domain), and `icp`. Call company/tech/news tools with `domain`, and HubSpot tools with `contact.id`.

**6. Verification (adversarial fact-check) — Sonnet**
> You are an adversarial fact-checker for a sales-research system. You are given the raw structured claims from the retrieval subagents (1 to 5), each with a value, confidence, and source. Your only job is to challenge them; you never add new facts. For each material claim: does the cited source actually support it; does any other subagent assert something contradictory; is a stated talking point grounded in a dated event; is the confidence justified by the evidence. You may read-only re-fetch a cited source URL (fetch_url) to confirm alignment, but you may not run new searches or enrichment. Default to skepticism: if support is thin or unverifiable, mark the claim `uncertain` or `unsupported` and lower its confidence rather than giving benefit of the doubt. Output strict JSON per claim `{ claimId, verdict: supported|unsupported|contradicted|uncertain, adjustedConfidence, note }` plus a run-level `contradictions[]`. Your verdicts drive the needs-review flag and the rationale's citation-integrity gate; they never change the numeric score. Boundaries: judge only, no enrichment, no scoring.

**7. ICP-Fit — Sonnet (no external tools)**
> You judge how well a lead fits Tracepoint's ICP, given the assembled dossier from the retrieval subagents (1 to 5) and the current ICP definition. Output three aggregate axis scores, each 0-1: `firmographic` (industry + headcount + funding-stage/recency fit), `role` (seniority / buying-role fit), and `technographic` (stack modernity minus competitor entrenchment). Also output a boolean `disqualified`, true if any hard disqualifier applies (non-software, no engineering org, pre-product under 15, 1,000+ enterprise incumbent, offline business). For each fit dimension (industry, headcount, funding-stage/recency, role/seniority, technographic including competitor-present), give a `dimensions[]` entry `{ dimension, assessment: 0-1, justification, confidence }`. Also list which BANT/MEDDIC fields the dossier could confirm (authority, budget, need, timing, champion) and which remain unknown. Explicitly enumerate any *conflicts* between subagents (e.g., strong firmographics but wrong role, or great fit but competitor entrenched) and any low-confidence inputs. You do not output the final number; the deterministic scorer converts your axis scores into the fit score and floors it when `disqualified` is true. Output strict JSON `{ firmographic, role, technographic, disqualified, dimensions[], bantMeddic?, conflicts[] }`. Boundaries: fit judgment only, no retrieval.

**Synthesis (rationale) — Opus**
> You write the rep-facing verdict from the fully assembled dossier and computed scores. Produce: a concise rationale (3 to 5 sentences) where every factual claim cites a source from the dossier, and a single recommended next step with a personalized talking point drawn from the freshest trigger. If the run was flagged needs-review, lead with the specific conflicts/uncertainties that require a human. Never state a claim not backed by a dossier field. Output strict JSON `{ rationale, citations[], nextStep, reviewNote? }`. Each citation's `ref` MUST be exactly one of these dossier keys: a company/contact/tech field name (e.g. `funding`, `headcount`, `industry`, `title`, `seniority`, `competitorPresent`), or `news_<n>` for the nth trigger event (0-indexed). Do not invent other ref values.

## Scoring model (deterministic, from structured agent output)

Scores are computed in code, not guessed by the model, so they are reproducible and defensible (opaque scores get ignored by reps). The LLM's judgment lives in extracting/normalizing messy fields (subagents) and in the qualitative fit assessments (ICP-Fit agent); code does the arithmetic.

- **Fit score (0 to 100):** weighted sum of ICP-Fit dimension assessments (each weighted by ICP-Fit's own per-dimension confidence). Default weights: firmographic 0.40 (industry, headcount, funding-stage/recency), role/seniority 0.30, technographic 0.30 (modern-stack positive, competitor-present strong negative). Hard disqualifiers (non-software, no eng org, 1,000+ enterprise) floor fit near zero. **Verification never moves this score** — the number reflects ICP-Fit's read of the raw dossier; data-quality problems surface only as needs-review flags.
- **Engagement score (0 to 100):** from the Engagement agent's structured signals. High-intent actions (demo request, pricing views) weighted heavily; low-intent capped; multiplied by a recency-decay factor (~15%/month).
- **Priority (0 to 100):** `0.60 * fit + 0.40 * engagement`, weights exposed in `icp_config`. Fit-weighted because qualification dominates for this niche; engagement modulates timing.
- **Grade:** single letter from priority band — A ≥ 75, B 55 to 74, C 35 to 54, D < 35. Fit/engagement shown separately as bars.
- **Needs review (boolean + reasons[]):** set when any of — the Verification agent reports a contradiction or a cluster of unsupported/uncertain claims; aggregate retrieval confidence below threshold; subagents conflict per ICP-Fit's conflict list; priority in the ambiguous 45 to 65 band; identity unverified or engagement attribution uncertain. This flag is the only way Verification affects a run. Needs-review contacts are excluded from batch-approve and must be cleared individually.
- **Citation integrity (deterministic gate):** before a rationale is accepted, code checks that every cited claim maps to a dossier field that has a source and was not marked unsupported by Verification. Unsupported claims are stripped from the rationale; if a load-bearing claim fails, the run is flagged needs-review.

## Live view (hybrid: graph header + log stream)

- Persistent pipeline-graph strip: nodes (Orchestrator → Company, Contact, Tech, News, Engagement → Verify → Fit → Score) light up as each runs (waiting / running / done / error).
- Below it, a Claude-Code-style nested log/tree that streams the orchestrator plan, each subagent's tool calls and results, and synthesis, newest at the bottom, full history scrolls.
- **Event bus → SSE:** the run emits typed events (`run_started`, `plan_ready`, `agent_started`, `agent_tool_call`, `agent_tool_result`, `agent_token?`, `agent_completed`, `agent_error`, `scoring_started`, `score_ready`, `run_completed`), each tagged with the agent. An in-process EventEmitter forwards to `GET /api/runs/[id]/stream` (SSE). All events persist to `run_events`, so opening a finished run replays it.

## Dashboard + write-back checkpoint

- Ranked contact queue with status tabs (All / Needs review / Approved / Synced): rank, contact, company, priority, grade, status. Sort by priority.
- Detail pane: fit/engagement bars, the cited rationale, the recommended next step, and a preview of the exact HubSpot write (`lead_priority_score`, `lead_grade` custom properties + a timeline note with rationale and next step).
- **Approval:** per-contact Approve & write / Edit / Skip, plus a "select clear A/B leads → approve all" shortcut. Needs-review leads cannot be batch-approved. On approve, the app writes to HubSpot (real if a token is set, otherwise a logged dry-run preview) and moves the contact to Synced.
- **Runs:** auto-fire on sync; a manual Run/Re-run button per contact.
- ICP editor: edit the ICP definition and scoring weights (`icp_config`).

## Seed / demo data

~12 fictional contacts with matching fixtures, engineered to spread across the range so the demo shows the full behavior, including at least three needs-review cases. Anchors:

- **Northwind Labs / Priya Nair — ~88 (A).** Series B 4mo ago, VP Eng 2mo tenure, modern stack no competitor, pricing engagement. Clear high.
- **Vertex AI Studio / Alex Chen — ~55 (C, needs review).** Strong firmographics but stale funding, competitor hinted from one job post (low confidence), contact enriches to PM not eng with an ambiguous match, high engagement from an unverifiable Gmail. Conflicts on purpose; the Verification agent catches these planted inconsistencies, downgrades them, and trips needs-review.
- **Harborview Dental / Pat Ruiz — ~18 (D).** No eng org, WordPress site, no news, no engagement. Clear disqualify.
- ~9 more spanning B/C with one or two additional borderline cases.

Fixtures are keyed by company domain so results are deterministic without any API keys.

## Non-goals (YAGNI)

- No auth / multi-user / multi-tenant; single local app.
- No real Crunchbase / BuiltWith / NewsAPI (mock only).
- No ML predictive scoring; rule-based rubric only.
- No CRM other than HubSpot; no email sending; no lifecycle/owner changes on write-back.
- No self-orchestrating model delegation; orchestration is explicit code.

## Build phases (each with a verification gate)

1. **Scaffold + data.** Next.js + Tailwind + SQLite schema + seed 12 fictional contacts + fixtures. → Verify: `npm run seed`; contacts list renders.
2. **Provider adapters.** Real+mock adapter for every tool, selected by env-var presence. → Verify: each adapter returns its fixture for a seed domain; returns live data when a key is set (manual spot-check).
3. **Agents + tools.** SDK tool definitions, six subagent prompts, run one subagent end to end. → Verify: Contact agent on Priya returns zod-valid JSON with confidences/sources.
4. **Orchestrate + score.** Planner, parallel fan-out, Verification pass, ICP-Fit, deterministic scorer + citation-integrity gate, synthesis. → Verify: full run on the three anchors yields ~88 / ~18 / ~55; the Verification agent flags Vertex's contradictions and sets `needsReview=true` with the conflicts listed.
5. **Live view.** Event bus + SSE + hybrid graph/log UI + replay from `run_events`. → Verify: open a run, watch nodes light up and the log stream; reopen a finished run and it replays.
6. **Dashboard + ICP editor.** Ranked queue, tabs, detail pane, ICP config edit. → Verify: queue ranks by priority; tabs filter; editing a weight re-scores.
7. **Write-back approval.** Approve/edit/skip, batch-approve for A/B, HubSpot write (or dry-run), needs-review guard. → Verify: approving Priya writes the property+note payload (or logs the dry-run); Vertex cannot be batch-approved.
8. **Showcase polish.** Streaming token effect, empty/error/loading states, visual pass.

## End-to-end verification

Seed (or sync a real HubSpot) → contacts auto-run and score → dashboard ranks all 12 → open Priya's run in the live view and watch the fan-out, then reopen it to confirm replay → approve Priya's write-back and confirm the HubSpot property + note payload → confirm Vertex AI Studio sits in Needs review with a cited rationale naming the stale-funding / competitor-hint / wrong-role / unverifiable-engagement conflicts, and cannot be batch-approved.
