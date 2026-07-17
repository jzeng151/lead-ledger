import { db, schema } from "../../db";

const { contacts } = schema;

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
export async function syncContacts(): Promise<{ synced: number; source: "hubspot" | "fixtures" }> {
  const token = process.env.HUBSPOT_TOKEN;
  if (!token) return { synced: 0, source: "fixtures" };

  const res = await fetch(
    "https://api.hubapi.com/crm/v3/objects/contacts?properties=firstname,lastname,email,jobtitle,company,website&limit=100",
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`HubSpot ${res.status}`);

  const results: HubspotResult[] = (await res.json()).results ?? [];
  const now = new Date();
  for (const r of results) {
    const p = r.properties ?? {};
    const row = {
      id: r.id,
      name: [p.firstname, p.lastname].filter(Boolean).join(" ") || r.id,
      email: p.email ?? null,
      title: p.jobtitle ?? null,
      companyName: p.company ?? null,
      companyDomain: p.website ?? null,
      props: p as Record<string, unknown>,
      syncedAt: now,
    };
    db.insert(contacts)
      .values(row)
      .onConflictDoUpdate({ target: contacts.id, set: row })
      .run();
  }
  return { synced: results.length, source: "hubspot" };
}
