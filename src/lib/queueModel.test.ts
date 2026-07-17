import { describe, it, expect } from "vitest";
import { buildQueue } from "./queueModel";

describe("buildQueue", () => {
  it("ranks by priority desc, puts new contacts last, and derives each status", () => {
    // Deliberately supplied out of priority order so the sort is exercised.
    const contacts = [
      { id: "c-new", name: "Nadia New", companyName: "Newco" },
      { id: "c-scored", name: "Sam Scored", companyName: "Scoreco" },
      { id: "c-review", name: "Rae Review", companyName: "Reviewco" },
      { id: "c-approved", name: "Ada Approved", companyName: "Approveco" },
      { id: "c-synced", name: "Syd Synced", companyName: "Syncco" },
    ];
    const latestScoreByContact = {
      "c-scored": { priority: 60, grade: "B", needsReview: false },
      "c-review": { priority: 90, grade: "A", needsReview: true },
      "c-approved": { priority: 40, grade: "C", needsReview: false },
      "c-synced": { priority: 80, grade: "A", needsReview: false },
      // c-new intentionally absent -> no score.
    } as Record<string, { priority: number; grade: string; needsReview: boolean } | undefined>;
    const writebackByContact = {
      "c-approved": { status: "approved" },
      "c-synced": { status: "written" },
      // a "needs review" score with no writeback stays "needs review".
    } as Record<string, { status: string } | undefined>;

    const queue = buildQueue(contacts, latestScoreByContact, writebackByContact);

    // Order: 90, 80, 60, 40, then the null-priority new contact last.
    expect(queue.map((r) => r.contactId)).toEqual([
      "c-review",
      "c-synced",
      "c-scored",
      "c-approved",
      "c-new",
    ]);

    const byId = Object.fromEntries(queue.map((r) => [r.contactId, r]));
    expect(byId["c-new"].status).toBe("new");
    expect(byId["c-new"].priority).toBeNull();
    expect(byId["c-new"].grade).toBeNull();
    expect(byId["c-scored"].status).toBe("scored");
    expect(byId["c-review"].status).toBe("needs review");
    expect(byId["c-approved"].status).toBe("approved");
    expect(byId["c-synced"].status).toBe("synced");
  });

  it("writeback state outranks needsReview when deriving status", () => {
    const contacts = [{ id: "c1", name: "One", companyName: "Co" }];
    // Score says needsReview, but an approved writeback means the rep already
    // acted on it -> status should be "approved", not "needs review".
    const queue = buildQueue(
      contacts,
      { c1: { priority: 50, grade: "B", needsReview: true } },
      { c1: { status: "approved" } },
    );
    expect(queue[0].status).toBe("approved");
  });

  it("keeps input order for contacts that tie on priority (stable)", () => {
    const contacts = [
      { id: "a", name: "A", companyName: "Co" },
      { id: "b", name: "B", companyName: "Co" },
      { id: "c", name: "C", companyName: "Co" },
    ];
    const scores = {
      a: { priority: 50, grade: "B", needsReview: false },
      b: { priority: 50, grade: "B", needsReview: false },
      c: { priority: 50, grade: "B", needsReview: false },
    };
    const queue = buildQueue(contacts, scores, {});
    expect(queue.map((r) => r.contactId)).toEqual(["a", "b", "c"]);
  });
});
