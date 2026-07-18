import { eq } from "drizzle-orm";

import { db, schema } from "../db";

// A run still marked "running" past this window is treated as dead: its process
// died mid-run, so it must neither pin the dashboard in a scoring state nor
// block its contact from being re-queued by a sync or a manual re-run.
export const RUN_STALE_MS = 10 * 60 * 1000;

/** Runs that are genuinely in flight (status running and not stale). */
export function activeRuns(): { id: string; contactId: string }[] {
  const cutoff = Date.now() - RUN_STALE_MS;
  return db
    .select({ id: schema.runs.id, contactId: schema.runs.contactId, startedAt: schema.runs.startedAt })
    .from(schema.runs)
    .where(eq(schema.runs.status, "running"))
    .all()
    .filter((r) => (r.startedAt?.getTime() ?? 0) > cutoff)
    .map((r) => ({ id: r.id, contactId: r.contactId }));
}

/** The in-flight run for a contact, or null. Used to avoid duplicate runs. */
export function activeRunForContact(contactId: string): string | null {
  return activeRuns().find((r) => r.contactId === contactId)?.id ?? null;
}
