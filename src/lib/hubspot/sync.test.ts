import { describe, it, expect, vi, afterEach } from "vitest";
import { eq } from "drizzle-orm";

import { db, schema } from "../../db";
import { dedupeByEmail, domainFromEmail, normalizeDomain, syncContacts } from "./sync";

describe("normalizeDomain", () => {
  it("reduces HubSpot's free-form website values to a bare host", () => {
    expect(normalizeDomain("http://nimbusfreight.co")).toBe("nimbusfreight.co");
    expect(normalizeDomain("http://Northwind.dev/")).toBe("northwind.dev");
    expect(normalizeDomain("https://www.Example.com/path?q=1")).toBe("example.com");
    expect(normalizeDomain("northwind.dev")).toBe("northwind.dev");
    expect(normalizeDomain("example.com.")).toBe("example.com");
  });

  it("returns null when there is nothing usable", () => {
    expect(normalizeDomain(null)).toBeNull();
    expect(normalizeDomain(undefined)).toBeNull();
    expect(normalizeDomain("   ")).toBeNull();
  });

  it("rejects placeholders a rep typed into the website field", () => {
    // "N/A" used to reduce to the host "n", which looked usable enough to
    // suppress the email fallback and then keyed every tool lookup off junk.
    expect(normalizeDomain("N/A")).toBeNull();
    expect(normalizeDomain("none")).toBeNull();
    expect(normalizeDomain("tbd")).toBeNull();
    expect(normalizeDomain("-")).toBeNull();
  });
});

const { contacts, runs, runEvents, dossiers, scores, writebacks } = schema;

describe("dedupeByEmail", () => {
  it("removes the same-email contact under a different id with its runtime rows, keeping the retained and unrelated ones", () => {
    const now = new Date();
    // A stale "fixture" row plus a full set of runtime rows referencing it.
    db.insert(contacts)
      .values({ id: "dupe-fixture", name: "Dana Dup", email: "dup@example.com", props: {}, syncedAt: now })
      .run();
    db.insert(runs).values({ id: "dupe-run", contactId: "dupe-fixture", status: "scored", startedAt: now }).run();
    db.insert(runEvents).values({ runId: "dupe-run", agent: "orchestrator", type: "run_started", payload: {}, ts: now }).run();
    db.insert(dossiers).values({ runId: "dupe-run", perAgent: {}, verification: {}, merged: {} }).run();
    db.insert(scores)
      .values({ runId: "dupe-run", contactId: "dupe-fixture", fit: 10, engagement: 0, priority: 6, grade: "D", needsReview: true, reviewReasons: [], citations: [] })
      .run();
    db.insert(writebacks).values({ contactId: "dupe-fixture", status: "pending", payload: {} }).run();
    // The real synced row (same email, different id) that must be kept, and an
    // unrelated contact that must be untouched.
    db.insert(contacts).values({ id: "dupe-real", name: "Dana Dup", email: "dup@example.com", props: {}, syncedAt: now }).run();
    db.insert(contacts).values({ id: "unrelated", name: "Uma Other", email: "other@example.com", props: {}, syncedAt: now }).run();

    dedupeByEmail("dup@example.com", "dupe-real");

    // The stale contact and every runtime row that referenced it are gone.
    expect(db.select().from(contacts).where(eq(contacts.id, "dupe-fixture")).get()).toBeUndefined();
    expect(db.select().from(runs).where(eq(runs.id, "dupe-run")).get()).toBeUndefined();
    expect(db.select().from(runEvents).where(eq(runEvents.runId, "dupe-run")).all()).toHaveLength(0);
    expect(db.select().from(dossiers).where(eq(dossiers.runId, "dupe-run")).get()).toBeUndefined();
    expect(db.select().from(scores).where(eq(scores.contactId, "dupe-fixture")).get()).toBeUndefined();
    expect(db.select().from(writebacks).where(eq(writebacks.contactId, "dupe-fixture")).get()).toBeUndefined();

    // The retained contact and the unrelated one survive.
    expect(db.select().from(contacts).where(eq(contacts.id, "dupe-real")).get()?.id).toBe("dupe-real");
    expect(db.select().from(contacts).where(eq(contacts.id, "unrelated")).get()?.id).toBe("unrelated");
  });
});

describe("syncContacts paging", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("follows paging.next.after so contacts past the first page are not dropped", async () => {
    vi.stubEnv("HUBSPOT_TOKEN", "test-token");
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const u = new URL(String(url));
        seen.push(u.searchParams.get("after") ?? "page1");
        return u.searchParams.get("after")
          ? Response.json({ results: [{ id: "pg-3", properties: { firstname: "Cy", website: "https://third.dev" } }] })
          : Response.json({
              results: [
                { id: "pg-1", properties: { firstname: "Ana" } },
                { id: "pg-2", properties: { firstname: "Bo" } },
              ],
              paging: { next: { after: "100" } },
            });
      }),
    );

    const { synced, source } = await syncContacts();

    expect(source).toBe("hubspot");
    expect(synced).toBe(3); // would have been 2 when only the first page was read
    expect(seen).toEqual(["page1", "100"]);
    expect(db.select().from(contacts).where(eq(contacts.id, "pg-3")).get()?.companyDomain).toBe("third.dev");
  });
});

describe("domainFromEmail", () => {
  it("derives a company domain when HubSpot has no website", () => {
    expect(domainFromEmail("priya@northwind.dev")).toBe("northwind.dev");
    expect(domainFromEmail("SAM@Mail.Example.COM")).toBe("mail.example.com");
  });

  it("refuses mailbox providers and malformed input", () => {
    // A gmail.com "company domain" would key every tool at the wrong account.
    expect(domainFromEmail("someone@gmail.com")).toBeNull();
    expect(domainFromEmail("someone@icloud.com")).toBeNull();
    expect(domainFromEmail("not-an-email")).toBeNull();
    expect(domainFromEmail(null)).toBeNull();
  });

  it("is used as the sync fallback so the contact is not queued domainless", async () => {
    vi.stubEnv("HUBSPOT_TOKEN", "test-token");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ results: [{ id: "nw-1", properties: { firstname: "Ada", email: "ada@northwind.dev" } }] })),
    );

    await syncContacts();

    expect(db.select().from(contacts).where(eq(contacts.id, "nw-1")).get()?.companyDomain).toBe("northwind.dev");
  });
});

describe("email normalization", () => {
  it("dedupes across casing and whitespace", () => {
    const now = new Date();
    db.insert(contacts).values({ id: "case-old", name: "Rae Case", email: "rae@example.com", props: {}, syncedAt: now }).run();
    db.insert(contacts).values({ id: "case-new", name: "Rae Case", email: "rae@example.com", props: {}, syncedAt: now }).run();

    // HubSpot returning the same person with different casing used to miss the
    // stale row entirely, leaving both in the queue.
    dedupeByEmail("  RAE@Example.COM  ", "case-new");

    expect(db.select().from(contacts).where(eq(contacts.id, "case-old")).get()).toBeUndefined();
    expect(db.select().from(contacts).where(eq(contacts.id, "case-new")).get()?.id).toBe("case-new");
  });

  it("stores the canonical form on sync", async () => {
    vi.stubEnv("HUBSPOT_TOKEN", "test-token");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ results: [{ id: "case-sync", properties: { firstname: "Mo", email: " MO@Northwind.DEV " } }] })),
    );

    await syncContacts();

    expect(db.select().from(contacts).where(eq(contacts.id, "case-sync")).get()?.email).toBe("mo@northwind.dev");
  });
});

describe("contacts archived in HubSpot", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("purges a local row HubSpot no longer returns", async () => {
    vi.stubEnv("HUBSPOT_TOKEN", "test-token");
    db.insert(contacts).values({ id: "gone-1", name: "Archived Person", props: {}, syncedAt: new Date() }).run();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ results: [{ id: "still-here", properties: { firstname: "Ada" } }] })),
    );

    await syncContacts();

    // Left in place it would be re-scored and its write-back would PATCH a dead id.
    expect(db.select().from(contacts).where(eq(contacts.id, "gone-1")).get()).toBeUndefined();
    expect(db.select().from(contacts).where(eq(contacts.id, "still-here")).get()?.id).toBe("still-here");
  });

  it("clears local rows when a complete pull returns nothing", async () => {
    vi.stubEnv("HUBSPOT_TOKEN", "test-token");
    db.insert(contacts).values({ id: "last-one", name: "Only Contact", props: {}, syncedAt: new Date() }).run();
    // The portal's last contact was archived. Refusing to act on this would
    // strand the local row forever.
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ results: [] })));

    const { truncated } = await syncContacts();

    expect(truncated).toBe(false);
    expect(db.select().from(contacts).where(eq(contacts.id, "last-one")).get()).toBeUndefined();
  });

  it("purges nothing when the page cap cut the pull short", async () => {
    vi.stubEnv("HUBSPOT_TOKEN", "test-token");
    db.insert(contacts).values({ id: "keep-1", name: "Still Real", props: {}, syncedAt: new Date() }).run();
    // Never runs out of pages: the contacts it never reached are not gone.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ results: [{ id: "paged", properties: {} }], paging: { next: { after: "1" } } })),
    );

    const { truncated } = await syncContacts();

    expect(truncated).toBe(true);
    expect(db.select().from(contacts).where(eq(contacts.id, "keep-1")).get()?.id).toBe("keep-1");
  });
});
