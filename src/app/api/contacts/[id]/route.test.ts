import { describe, it, expect } from "vitest";

import { db, schema } from "@/db";
import { GET } from "./route";

const { contacts, runs, scores, writebacks } = schema;

const detail = async (id: string) =>
  (await (await GET(new Request(`http://test/api/contacts/${id}`), { params: Promise.resolve({ id }) })).json()) as {
    latestRunId: string | null;
    writebackStatus: string | null;
    score: { priority: number } | null;
  };

describe("contact detail", () => {
  it("points at the newest run even while it is still running", async () => {
    const scoredAt = new Date(1_700_000_000_000);
    const laterAt = new Date(1_700_000_600_000);
    db.insert(contacts).values({ id: "cd-1", name: "Rae Newest", props: {}, syncedAt: scoredAt }).run();
    db.insert(runs).values({ id: "cd-1-scored", contactId: "cd-1", status: "scored", startedAt: scoredAt }).run();
    db.insert(scores)
      .values({ runId: "cd-1-scored", contactId: "cd-1", fit: 80, engagement: 0, priority: 80, grade: "B", needsReview: false, reviewReasons: [], citations: [] })
      .run();
    // A re-run that has not scored yet: seeding the live view from the scored run
    // would replay the old completed trace and hide this one.
    db.insert(runs).values({ id: "cd-1-rerun", contactId: "cd-1", status: "running", startedAt: laterAt }).run();

    const d = await detail("cd-1");
    expect(d.latestRunId).toBe("cd-1-rerun");
    expect(d.score?.priority).toBe(80); // the last good score still renders
  });

  it("returns the persisted write-back decision so a skip survives a refresh", async () => {
    const now = new Date(1_700_000_000_000);
    db.insert(contacts).values({ id: "cd-2", name: "Sam Skipped", props: {}, syncedAt: now }).run();
    db.insert(writebacks).values({ contactId: "cd-2", status: "skipped", payload: null, approvedAt: now }).run();

    expect((await detail("cd-2")).writebackStatus).toBe("skipped");
    expect((await detail("cd-1")).writebackStatus).toBeNull(); // no decision recorded
  });
});
