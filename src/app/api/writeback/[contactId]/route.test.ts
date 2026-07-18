import { describe, it, expect } from "vitest";

import { db, schema } from "@/db";
import { POST } from "./route";

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
