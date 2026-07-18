import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";

import { db, schema } from "../../db";
import { dedupeByEmail } from "./sync";

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
