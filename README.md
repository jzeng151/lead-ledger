# Lead Ledger

Agentic HubSpot lead prioritization for a dev-tools sales rep. Lead Ledger syncs contacts, then runs a lead orchestrator that fans out to seven specialized subagents (company, contact, tech, news, engagement, verification, ICP-fit), blends their findings into a two-axis score (fit and engagement) and a single 0 to 100 priority with a cited rationale and a recommended next step, and streams the whole run through a live CLI-harness view. Nothing is written back to HubSpot until a human approves it.

The demo persona is "Tracepoint," a fictional observability API sold to funded software startups. Contacts are synced from HubSpot; their enrichment comes from deterministic fixtures keyed by company domain, so the scoring for the sample companies stays stable and the demo does not depend on live enrichment providers.

## Stack

Next.js 16 (App Router) + React 19 + TypeScript, Tailwind v4, SQLite via Drizzle + better-sqlite3, Anthropic TypeScript SDK (Tool Runner), server-sent events for the live view.

## Run it

```
npm install
cp .env.example .env.local   # ANTHROPIC_API_KEY for the agentic flow; HUBSPOT_TOKEN to sync/write contacts
npm run db:push
npm run reset                # clears local state to an empty DB (default ICP); contacts come from Sync
npm run dev
```

Open http://localhost:3000, then click "Sync contacts" to pull your HubSpot contacts into the queue.

### HubSpot setup for write-back

Create two custom contact properties in HubSpot before approving anything, under
Settings > Properties > Contact properties. HubSpot rejects a write to a property
that does not exist, so without them every approval fails:

| Internal name | Label | Field type |
| --- | --- | --- |
| `lead_priority_score` | Lead Priority Score | Number |
| `lead_grade` | Lead Grade | Single-line text |

The label is what appears on the contact record; the internal name is what the
app writes to and must match exactly. The token also needs the
`crm.objects.contacts.write` and `crm.objects.notes.write` scopes, since an
approval sets the two properties and posts a timeline note.

Without `HUBSPOT_TOKEN`, approving is a dry run: the payload is logged, nothing
is sent, and the contact shows as "dry run" rather than synced.

Engagement data is read from the contact's association records, which carry ids
rather than the underlying activity objects, so first-party intent from a live
portal scores as zero. `LEAD_LEDGER_DEMO=1` reads engagement from the domain
fixtures instead, which is what the demo spread relies on.

## Demo walkthrough

1. Sync the queue: with `HUBSPOT_TOKEN` set, click "Sync contacts" to pull contacts from HubSpot (deduped by email). `npm run reset` clears local state back to an empty queue (it deletes synced contacts). For a stable showcase, set `LEAD_LEDGER_DEMO=1` so scoring reads contact + engagement from the domain fixtures (keeping the demo spread) while sync and write-back still use the live token.
2. Dashboard: contacts ranked by priority, filterable by status (new, scored, needs review, approved, synced).
3. Open a contact.
4. Click "Run" to start the agentic pipeline.
5. Watch the live pipeline: the orchestrator plans, the retrieval subagents fan out in parallel, verification and ICP-fit judge the findings, the scorer produces the number, and synthesis writes the rationale.
6. Review the cited score: fit and engagement subscores, the priority, the written rationale with citations, and the recommended next step.
7. Approve the write-back: the score and a timeline note are staged and written to HubSpot only on approval.

Without `ANTHROPIC_API_KEY`, a run still streams the pipeline view and then ends at a graceful auth error, so no score is produced. With a key present, the enrichment and scoring layer runs on deterministic fixtures for the sample contacts, so the full flow works without any of the other API keys.
