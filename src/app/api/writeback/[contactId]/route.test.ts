import { describe, it, expect, vi } from "vitest";
import { eq } from "drizzle-orm";

import { db, schema } from "@/db";
import { POST } from "./route";

// A real HubSpot write awaits the network. The dry-run path returns instantly,
// which serializes the requests and hides the overlap this guards against.
vi.mock("@/lib/hubspot/writeback", () => ({
  applyWriteback: vi.fn(async () => {
    await new Promise((r) => setTimeout(r, 25));
    return { status: "written", dryRun: true };
  }),
}));

const { contacts, runs, scores } = schema;

const approve = (contactId: string) =>
  POST(new Request(`http://test/api/writeback/${contactId}`, { method: "POST" }), {
    params: Promise.resolve({ contactId }),
  });

describe("writeback during a re-run", () => {
  it("refuses to write the previous score while a newer run is still going", async () => {
    const scoredAt = new Date(Date.now() - 60_000);
    db.insert(contacts).values({ id: "wbr-c", name: "Ivy Rerun", props: {}, syncedAt: scoredAt }).run();
    db.insert(runs).values({ id: "wbr-scored", contactId: "wbr-c", status: "scored", startedAt: scoredAt }).run();
    db.insert(scores)
      .values({ runId: "wbr-scored", contactId: "wbr-c", fit: 80, engagement: 0, priority: 80, grade: "B", needsReview: false, reviewReasons: [], citations: [] })
      .run();
    // The re-run has no score row yet, so the lookup falls back to the old one.
    db.insert(runs).values({ id: "wbr-live", contactId: "wbr-c", status: "running", startedAt: new Date() }).run();

    const res = await approve("wbr-c");

    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/scoring in progress/);
  });
});

describe("batch approval versus a human skip", () => {
  it("refuses to overwrite a skipped contact, but an individual approve still can", async () => {
    const now = new Date(Date.now() - 60_000);
    db.insert(contacts).values({ id: "wbs-c", name: "Skip Race", props: {}, syncedAt: now }).run();
    db.insert(runs).values({ id: "wbs-run", contactId: "wbs-c", status: "scored", startedAt: now }).run();
    db.insert(scores)
      .values({ runId: "wbs-run", contactId: "wbs-c", fit: 80, engagement: 0, priority: 80, grade: "B", needsReview: false, reviewReasons: [], citations: [] })
      .run();
    db.insert(schema.writebacks).values({ contactId: "wbs-c", status: "skipped", payload: null, approvedAt: now }).run();

    // A dashboard tab whose row list predates the skip.
    const batch = await POST(
      new Request("http://test/api/writeback/wbs-c", { method: "POST", body: JSON.stringify({ batch: true }) }),
      { params: Promise.resolve({ contactId: "wbs-c" }) },
    );

    expect(batch.status).toBe(409);
    expect((await batch.json()).error).toMatch(/skipped by a human/);
  });
});

describe("concurrent approvals", () => {
  it("lets one write through and conflicts the other", async () => {
    const now = new Date(Date.now() - 60_000);
    db.insert(contacts).values({ id: "wbc-c", name: "Double Click", props: {}, syncedAt: now }).run();
    db.insert(runs).values({ id: "wbc-run", contactId: "wbc-c", status: "scored", startedAt: now }).run();
    db.insert(scores)
      .values({ runId: "wbc-run", contactId: "wbc-c", fit: 80, engagement: 0, priority: 80, grade: "B", needsReview: false, reviewReasons: [], citations: [] })
      .run();
    db.insert(schema.writebacks)
      .values({ contactId: "wbc-c", status: "pending", payload: { properties: { lead_priority_score: 80, lead_grade: "B" }, note: "n" } })
      .run();

    // Two tabs approving the same contact before either finishes. Both used to
    // read the row as pending and both posted a HubSpot note.
    const [a, b] = await Promise.all([approve("wbc-c"), approve("wbc-c")]);
    const statuses = [a.status, b.status].sort();

    expect(statuses).toEqual([200, 409]);
    const loser = a.status === 409 ? a : b;
    expect((await loser.json()).error).toMatch(/already in progress/);
  });
});

describe("cross-site protection", () => {
  it("refuses a request that did not come from this app", async () => {
    const cross = await POST(
      new Request("http://test/api/writeback/wbr-c", {
        method: "POST",
        headers: { "sec-fetch-site": "cross-site" },
      }),
      { params: Promise.resolve({ contactId: "wbr-c" }) },
    );
    expect(cross.status).toBe(403);

    const foreignOrigin = await POST(
      new Request("http://test/api/writeback/wbr-c", { method: "POST", headers: { origin: "https://evil.example" } }),
      { params: Promise.resolve({ contactId: "wbr-c" }) },
    );
    expect(foreignOrigin.status).toBe(403);
  });

  it("allows a same-origin request through to the normal guards", async () => {
    const ok = await POST(
      new Request("http://test/api/writeback/wbr-c", {
        method: "POST",
        headers: { origin: "http://test", "sec-fetch-site": "same-origin" },
      }),
      { params: Promise.resolve({ contactId: "wbr-c" }) },
    );
    // wbr-c has a run in flight from the earlier test, so it reaches that guard.
    expect(ok.status).toBe(409);
  });
});

describe("skip versus a claimed write", () => {
  it("refuses a skip while a write is in flight", async () => {
    const now = new Date(Date.now() - 60_000);
    db.insert(contacts).values({ id: "wbk-c", name: "Skip Clash", props: {}, syncedAt: now }).run();
    db.insert(runs).values({ id: "wbk-run", contactId: "wbk-c", status: "scored", startedAt: now }).run();
    db.insert(scores)
      .values({ runId: "wbk-run", contactId: "wbk-c", fit: 80, engagement: 0, priority: 80, grade: "B", needsReview: false, reviewReasons: [], citations: [] })
      .run();
    db.insert(schema.writebacks)
      .values({ contactId: "wbk-c", status: "writing", payload: {}, approvedAt: new Date() })
      .run();

    const res = await POST(
      new Request("http://test/api/writeback/wbk-c", { method: "POST", body: JSON.stringify({ skip: true }) }),
      { params: Promise.resolve({ contactId: "wbk-c" }) },
    );

    // The in-flight write finishes by upserting "written", which would bury the
    // skip and show the contact as synced against the rep's decision.
    expect(res.status).toBe(409);
  });
});

describe("write-backs for a purged contact", () => {
  it("refuses a skip for a contact that no longer exists", async () => {
    const res = await POST(
      new Request("http://test/api/writeback/wb-ghost", { method: "POST", body: JSON.stringify({ skip: true }) }),
      { params: Promise.resolve({ contactId: "wb-ghost" }) },
    );

    expect(res.status).toBe(404);
    // An orphan skip would silently govern the lead if HubSpot restored that id.
    expect(db.select().from(schema.writebacks).where(eq(schema.writebacks.contactId, "wb-ghost")).get()).toBeUndefined();
  });
});

describe("concurrent approvals with nothing staged", () => {
  it("still lets only one write through", async () => {
    const now = new Date(Date.now() - 60_000);
    db.insert(contacts).values({ id: "wbn-c", name: "No Row", props: {}, syncedAt: now }).run();
    db.insert(runs).values({ id: "wbn-run", contactId: "wbn-c", status: "scored", startedAt: now }).run();
    db.insert(scores)
      .values({ runId: "wbn-run", contactId: "wbn-c", fit: 80, engagement: 0, priority: 80, grade: "B", needsReview: false, reviewReasons: [], citations: [] })
      .run();
    // Deliberately no writebacks row: an old run can decline to stage and the
    // newer one can then error.

    const [a, b] = await Promise.all([approve("wbn-c"), approve("wbn-c")]);

    expect([a.status, b.status].sort()).toEqual([200, 409]);
  });
});
