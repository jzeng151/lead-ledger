import { and, eq, inArray, ne } from "drizzle-orm";

import { db, schema } from "../../db";

const { contacts, runs, runEvents, dossiers, scores, writebacks } = schema;

/**
 * Reduce HubSpot's free-form `website` to a bare host, because every domain-keyed
 * tool and enrichment fixture expects one. HubSpot stores values like
 * "http://Northwind.dev/" or "https://www.example.com/path"; left as-is those
 * never match a fixture and only work when the model happens to strip the scheme
 * itself. Returns null when there is nothing usable.
 */
export function normalizeDomain(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const noScheme = raw.trim().toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  const host = noScheme.split(/[/?#]/)[0].replace(/^www\./, "").replace(/\.$/, "");
  return host || null;
}

/**
 * Delete a contact and all of its runtime rows (runs, run events, dossiers,
 * scores, writebacks). Used to remove a stale row that a sync is superseding.
 */
// Mailbox providers whose domain says nothing about the account, so they must
// not become a company domain.
const FREE_EMAIL = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "hotmail.com", "outlook.com", "live.com",
  "aol.com", "icloud.com", "me.com", "proton.me", "protonmail.com", "gmx.com", "mail.com",
]);

/**
 * Fall back to the corporate email domain when HubSpot has no website on the
 * contact. Every retrieval agent keys its tools by domain, so a contact synced
 * without one is queued for a run that can only come back empty.
 */
export function domainFromEmail(email: string | null | undefined): string | null {
  const at = (email ?? "").trim().toLowerCase().split("@");
  if (at.length !== 2) return null;
  const host = normalizeDomain(at[1]);
  return host && !FREE_EMAIL.has(host) ? host : null;
}

export function purgeContact(id: string) {
  const runIds = db.select({ id: runs.id }).from(runs).where(eq(runs.contactId, id)).all().map((r) => r.id);
  if (runIds.length) {
    db.delete(runEvents).where(inArray(runEvents.runId, runIds)).run();
    db.delete(dossiers).where(inArray(dossiers.runId, runIds)).run();
  }
  db.delete(scores).where(eq(scores.contactId, id)).run();
  db.delete(writebacks).where(eq(writebacks.contactId, id)).run();
  db.delete(runs).where(eq(runs.contactId, id)).run();
  db.delete(contacts).where(eq(contacts.id, id)).run();
}

/**
 * Emails are compared with SQLite's case-sensitive text equality, so store and
 * match one canonical form. Without this, HubSpot returning the same person with
 * different casing leaves both rows in the queue, each scored and written back.
 */
export function normalizeEmail(email: string | null | undefined): string | null {
  const e = (email ?? "").trim().toLowerCase();
  return e || null;
}

/**
 * Guard against duplicate people: remove any contact that shares this email but
 * has a different id (e.g. a stale row left over from an earlier sync) before the
 * real HubSpot contact is upserted, so a sync never leaves the same person in the
 * queue twice. Contacts without an email are left untouched.
 */
export function dedupeByEmail(rawEmail: string, keepId: string) {
  const email = normalizeEmail(rawEmail);
  if (!email) return;
  const stale = db
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(eq(contacts.email, email), ne(contacts.id, keepId)))
    .all();
  for (const { id } of stale) purgeContact(id);
}

type HubspotResult = {
  id: string;
  properties?: {
    firstname?: string;
    lastname?: string;
    email?: string;
    jobtitle?: string;
    company?: string;
    website?: string;
  };
};

/**
 * Pull contacts from HubSpot into the local `contacts` table. With a
 * HUBSPOT_TOKEN set, fetch the first page of contacts and upsert them. Without a
 * token this is a no-op: the seeded fixtures already stand in for a sync, so we
 * return source "fixtures" rather than throwing.
 */
export async function syncContacts(): Promise<{
  synced: number;
  source: "hubspot" | "fixtures";
  /** Contacts whose company domain changed, so their stored dossier is now for the wrong company. */
  domainChanged: string[];
}> {
  const token = process.env.HUBSPOT_TOKEN;
  if (!token) return { synced: 0, source: "fixtures", domainChanged: [] };

  // Page through the portal. HubSpot caps a page at 100, so a single fetch would
  // silently drop every contact past the first 100 even though the Sync button
  // presents this as a full sync. MAX_PAGES bounds a runaway cursor.
  const MAX_PAGES = 50;
  const results: HubspotResult[] = [];
  let after: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL("https://api.hubapi.com/crm/v3/objects/contacts");
    url.searchParams.set("properties", "firstname,lastname,email,jobtitle,company,website");
    url.searchParams.set("limit", "100");
    if (after) url.searchParams.set("after", after);

    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`HubSpot ${res.status}`);

    const body = await res.json();
    results.push(...((body.results ?? []) as HubspotResult[]));
    after = body.paging?.next?.after;
    if (!after) break;
  }

  const now = new Date();
  const domainChanged: string[] = [];
  for (const r of results) {
    const p = r.properties ?? {};
    // Drop any prior row for the same person (matched by email) under a different
    // id before upserting the real one, so a sync can't create duplicates.
    const email = normalizeEmail(p.email);
    if (email) dedupeByEmail(email, r.id);
    const row = {
      id: r.id,
      name: [p.firstname, p.lastname].filter(Boolean).join(" ") || r.id,
      email,
      title: p.jobtitle ?? null,
      companyName: p.company ?? null,
      companyDomain: normalizeDomain(p.website) ?? domainFromEmail(email),
      props: p as Record<string, unknown>,
      syncedAt: now,
    };
    // Every retrieval agent keys its tools by domain, so a changed domain means
    // the stored dossier describes a different company. Report it: the caller
    // re-queues those contacts rather than serving the old score forever. Other
    // field edits (title, company name) are deliberately not treated this way,
    // to keep a routine sync from re-running the whole portal.
    const before = db.select({ companyDomain: contacts.companyDomain }).from(contacts).where(eq(contacts.id, r.id)).get();
    if (before && before.companyDomain !== row.companyDomain) domainChanged.push(r.id);

    db.insert(contacts)
      .values(row)
      .onConflictDoUpdate({ target: contacts.id, set: row })
      .run();
  }
  return { synced: results.length, source: "hubspot", domainChanged };
}
