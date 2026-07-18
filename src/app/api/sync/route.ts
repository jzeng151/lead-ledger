import { after } from "next/server";
import { eq } from "drizzle-orm";

import { db, schema } from "@/db";
import { syncContacts } from "@/lib/hubspot/sync";
import { runContact } from "@/lib/agents/orchestrator";
import { activeRunForContact, activeRuns } from "@/lib/runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const { contacts, scores, runs } = schema;

export async function POST() {
  // Surface a HubSpot failure (expired token, rate limit) as a JSON error the
  // dashboard can show, instead of an opaque 500 the client reads as success.
  let synced: number;
  let source: "hubspot" | "fixtures";
  let domainChanged: string[];
  try {
    ({ synced, source, domainChanged } = await syncContacts());
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }

  // Auto-run on sync: kick off a scoring run for every contact that has not been
  // scored yet. A `scores` row exists only once a run reaches "scored", so its
  // absence is the signal that the contact still needs a run.
  const contactRows = db.select({ id: contacts.id }).from(contacts).all();
  const scored = new Set(
    db.select({ contactId: scores.contactId }).from(scores).all().map((s) => s.contactId),
  );

  // A contact whose run is still in flight has no score row yet, so scoring alone
  // is not enough to exclude it: without this a second Sync would queue duplicate
  // runs for the same contacts, burning API calls and racing the persisted score.
  // activeRuns applies the staleness cutoff, so a run whose process died does not
  // strand its contact as permanently unsyncable.
  const inFlight = new Set(activeRuns().map((r) => r.contactId));

  // A contact whose domain just changed is re-queued even though it has a score:
  // that score was computed against a different company.
  const restale = new Set(domainChanged);
  const pending = contactRows.filter((c) => (!scored.has(c.id) || restale.has(c.id)) && !inFlight.has(c.id));

  // Flag the stale scores now, before the batch gets to them. Only the first
  // chunk starts immediately, so without this a rep could batch-approve a
  // contact this sync has already decided is scored against the wrong company.
  // The re-run replaces the row wholesale, so this is a holding state.
  for (const id of restale) {
    for (const row of db.select().from(scores).where(eq(scores.contactId, id)).all()) {
      const reasons = ((row.reviewReasons as string[] | null) ?? []).filter((r) => !r.startsWith("company domain changed"));
      db.update(scores)
        .set({
          needsReview: true,
          reviewReasons: [...reasons, "company domain changed: this score was computed for a different company, re-scoring"],
        })
        .where(eq(scores.runId, row.runId))
        .run();
    }
  }

  // Cap fan-out: run the unscored contacts in small sequential chunks so a sync
  // never fires ~80 Anthropic runs at once. Detached from the response (like the
  // prior fire-and-forget) so the POST returns immediately and the live view can
  // stream progress; each chunk settles before the next starts.
  const CONCURRENCY = 3;
  // after() ties the batch to the route's lifecycle instead of leaving it in an
  // untracked promise, so a host that freezes the instance once the response is
  // sent does not silently drop runs this response reported as queued.
  after(async () => {
    for (let i = 0; i < pending.length; i += CONCURRENCY) {
      // Re-check at the point of launch, not once up front: a later chunk can run
      // minutes after this list was built, by which time another sync or a manual
      // re-run may already have started the same contact. runContact has no guard
      // of its own, so two runs would race to write one score.
      const chunk = pending.slice(i, i + CONCURRENCY).filter((c) => !activeRunForContact(c.id));
      // contactId keeps the runId unique even if two runs mint in the same ms.
      await Promise.allSettled(chunk.map((c) => runContact(`run-${c.id}-${Date.now()}`, c.id)));
    }
  });

  return Response.json({ synced, source, queued: pending.length });
}
