import { eq } from "drizzle-orm";

import { db, schema } from "@/db";
import { syncContacts } from "@/lib/hubspot/sync";
import { runContact } from "@/lib/agents/orchestrator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const { contacts, scores, runs } = schema;

export async function POST() {
  const { synced, source } = await syncContacts();

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
  const inFlight = new Set(
    db
      .select({ contactId: runs.contactId })
      .from(runs)
      .where(eq(runs.status, "running"))
      .all()
      .map((r) => r.contactId),
  );

  const pending = contactRows.filter((c) => !scored.has(c.id) && !inFlight.has(c.id));

  // Cap fan-out: run the unscored contacts in small sequential chunks so a sync
  // never fires ~80 Anthropic runs at once. Detached from the response (like the
  // prior fire-and-forget) so the POST returns immediately and the live view can
  // stream progress; each chunk settles before the next starts.
  const CONCURRENCY = 3;
  void (async () => {
    for (let i = 0; i < pending.length; i += CONCURRENCY) {
      const chunk = pending.slice(i, i + CONCURRENCY);
      // contactId keeps the runId unique even if two runs mint in the same ms.
      await Promise.allSettled(chunk.map((c) => runContact(`run-${c.id}-${Date.now()}`, c.id)));
    }
  })();

  return Response.json({ synced, source, queued: pending.length });
}
