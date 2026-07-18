import { eq } from "drizzle-orm";
import { db, schema } from "../../db";
import { pickImpl, loadFixture, fetchWithTimeout, trace } from "./adapter";

export type HubspotContact = {
  id: string;
  name: string | null;
  email: string | null;
  title: string | null;
  companyName: string | null;
  companyDomain: string | null;
  props: Record<string, unknown>;
  source: string;
};

export type Engagement = {
  topActions: string[];
  recencyDays: number | null;
  rawSignals: Array<{ type: string; count: number }>;
  attributionUncertain: boolean;
};

async function realContact(id: string): Promise<HubspotContact> {
  const res = await fetchWithTimeout(
    `https://api.hubapi.com/crm/v3/objects/contacts/${id}?properties=firstname,lastname,email,jobtitle,company,website`,
    { headers: { Authorization: `Bearer ${process.env.HUBSPOT_TOKEN}` } },
  );
  if (!res.ok) throw new Error(`HubSpot ${res.status}`);
  const p = (await res.json()).properties ?? {};
  return {
    id,
    name: [p.firstname, p.lastname].filter(Boolean).join(" ") || null,
    email: p.email ?? null,
    title: p.jobtitle ?? null,
    companyName: p.company ?? null,
    companyDomain: p.website ?? null,
    props: p,
    source: "hubspot",
  };
}
async function mockContact(id: string): Promise<HubspotContact> {
  const row = db.select().from(schema.contacts).where(eq(schema.contacts.id, id)).get();
  trace({
    query: id,
    mode: "db",
    location: "contacts table (local DB)",
    outcome: row ? "found" : "empty",
    detail: row ? undefined : "no contact row",
  });
  return {
    id,
    name: row?.name ?? null,
    email: row?.email ?? null,
    title: row?.title ?? null,
    companyName: row?.companyName ?? null,
    companyDomain: row?.companyDomain ?? null,
    props: (row?.props as Record<string, unknown>) ?? {},
    source: "db:contacts",
  };
}

async function realEngagements(contactId: string): Promise<Engagement> {
  const res = await fetchWithTimeout(
    `https://api.hubapi.com/crm/v3/objects/contacts/${contactId}/associations/engagements`,
    { headers: { Authorization: `Bearer ${process.env.HUBSPOT_TOKEN}` } },
  );
  if (!res.ok) throw new Error(`HubSpot ${res.status}`);
  const results = (await res.json()).results ?? [];
  return {
    topActions: [],
    recencyDays: null,
    rawSignals: (Array.isArray(results) ? results : []).map((r: any) => ({
      type: r.type ?? "engagement",
      count: 1,
    })),
    attributionUncertain: true,
  };
}
async function mockEngagements(contactId: string): Promise<Engagement> {
  const row = db.select().from(schema.contacts).where(eq(schema.contacts.id, contactId)).get();
  const e = loadFixture(row?.companyDomain ?? "").engagement ?? {};
  return {
    topActions: Array.isArray(e.topActions) ? e.topActions : [],
    recencyDays: typeof e.recencyDays === "number" ? e.recencyDays : null,
    rawSignals: Array.isArray(e.rawSignals) ? e.rawSignals : [],
    attributionUncertain: Boolean(e.attributionUncertain),
  };
}

// Demo mode forces the HubSpot READ tools onto the fixture/DB path even when a
// token is present, so a synced contact scores on the domain fixtures (real
// engagement, so the demo spread holds) while syncContacts and applyWriteback
// keep reading process.env.HUBSPOT_TOKEN directly and still write live.
const readKey = process.env.LEAD_LEDGER_DEMO === "1" ? undefined : process.env.HUBSPOT_TOKEN;

export const hubspotGetContact = pickImpl(readKey, realContact, mockContact);
export const hubspotGetEngagements = pickImpl(readKey, realEngagements, mockEngagements);
