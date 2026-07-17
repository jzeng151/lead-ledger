# Lead Ledger

Agentic HubSpot lead prioritization for a dev-tools sales rep. Lead Ledger syncs contacts, then runs a lead orchestrator that fans out to seven specialized subagents (company, contact, tech, news, engagement, verification, ICP-fit), blends their findings into a two-axis score (fit and engagement) and a single 0 to 100 priority with a cited rationale and a recommended next step, and streams the whole run through a live CLI-harness view. Nothing is written back to HubSpot until a human approves it.

The demo persona is "Tracepoint," a fictional observability API sold to funded software startups. The sample contacts are fictional companies, so their enrichment always comes from deterministic fixtures and the demo never breaks.

## Stack

Next.js 16 (App Router) + React 19 + TypeScript, Tailwind v4, SQLite via Drizzle + better-sqlite3, Anthropic TypeScript SDK (Tool Runner), server-sent events for the live view.

## Run it

```
npm install
cp .env.example .env.local   # add ANTHROPIC_API_KEY to see the real agentic flow; other keys optional (fixtures otherwise)
npm run db:push
npm run reseed
npm run dev
```

Open http://localhost:3000.

## Demo walkthrough

1. Sync/seed the queue: `npm run reseed` loads the 12 sample contacts. The dashboard "Sync" button pulls from HubSpot when a token is set.
2. Dashboard: contacts ranked by priority, filterable by status (new, scored, needs review, approved, synced).
3. Open a contact.
4. Click "Run" to start the agentic pipeline.
5. Watch the live pipeline: the orchestrator plans, the retrieval subagents fan out in parallel, verification and ICP-fit judge the findings, the scorer produces the number, and synthesis writes the rationale.
6. Review the cited score: fit and engagement subscores, the priority, the written rationale with citations, and the recommended next step.
7. Approve the write-back: the score and a timeline note are staged and written to HubSpot only on approval.

Without `ANTHROPIC_API_KEY`, a run still streams the pipeline view and then ends at a graceful auth error, so no score is produced. With a key present, the enrichment and scoring layer runs on deterministic fixtures for the sample contacts, so the full flow works without any of the other API keys.
