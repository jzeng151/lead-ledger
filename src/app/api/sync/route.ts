import { db, schema } from "@/db";
import { syncContacts } from "@/lib/hubspot/sync";
import { runContact } from "@/lib/agents/orchestrator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const { contacts, scores } = schema;

export async function POST() {
  const { synced, source } = await syncContacts();

  // Auto-run on sync: kick off a scoring run for every contact that has not been
  // scored yet. A `scores` row exists only once a run reaches "scored", so its
  // absence is the signal that the contact still needs a run.
  const contactRows = db.select({ id: contacts.id }).from(contacts).all();
  const scored = new Set(
    db.select({ contactId: scores.contactId }).from(scores).all().map((s) => s.contactId),
  );

  let queued = 0;
  for (const c of contactRows) {
    if (scored.has(c.id)) continue;
    // contactId keeps the runId unique even if two runs mint in the same ms.
    const runId = `run-${c.id}-${Date.now()}`;
    runContact(runId, c.id).catch(() => {});
    queued++;
  }

  return Response.json({ synced, source, queued });
}
