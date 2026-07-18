import { eq, inArray } from "drizzle-orm";

import { db, schema } from "../db";

// A run that has made no progress for this long is treated as dead: its process
// died mid-run, so it must neither pin the dashboard in a scoring state nor
// block its contact from being re-queued by a sync or a manual re-run.
export const RUN_STALE_MS = 10 * 60 * 1000;

/**
 * Runs that are genuinely in flight.
 *
 * Staleness is measured from the run's most recent event, not from startedAt: a
 * legitimately slow run (a slow provider, a slow model) keeps emitting tool calls
 * and results, and expiring it on age alone would re-enable Sync and Re-run and
 * drop the write-back guard while it was still working.
 */
export function activeRuns(): { id: string; contactId: string }[] {
  const cutoff = Date.now() - RUN_STALE_MS;
  const running = db
    .select({ id: schema.runs.id, contactId: schema.runs.contactId, startedAt: schema.runs.startedAt })
    .from(schema.runs)
    .where(eq(schema.runs.status, "running"))
    .all();
  if (!running.length) return [];

  const lastEvent = new Map<string, number>();
  for (const e of db
    .select({ runId: schema.runEvents.runId, ts: schema.runEvents.ts })
    .from(schema.runEvents)
    .where(inArray(schema.runEvents.runId, running.map((r) => r.id)))
    .all()) {
    const t = e.ts?.getTime() ?? 0;
    if (t > (lastEvent.get(e.runId) ?? 0)) lastEvent.set(e.runId, t);
  }

  return running
    .filter((r) => Math.max(lastEvent.get(r.id) ?? 0, r.startedAt?.getTime() ?? 0) > cutoff)
    .map((r) => ({ id: r.id, contactId: r.contactId }));
}

/** The in-flight run for a contact, or null. Used to avoid duplicate runs. */
export function activeRunForContact(contactId: string): string | null {
  return activeRuns().find((r) => r.contactId === contactId)?.id ?? null;
}
