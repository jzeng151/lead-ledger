import { describe, it, expect } from "vitest";
import { buildQueue, isBatchApprovable, type QueueRow } from "./queueModel";

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
      "c-scored": { fit: 62, priority: 60, grade: "B", needsReview: false },
      "c-review": { fit: 92, priority: 90, grade: "A", needsReview: true },
      "c-approved": { fit: 42, priority: 40, grade: "C", needsReview: false },
      "c-synced": { fit: 82, priority: 80, grade: "A", needsReview: false },
      // c-new intentionally absent -> no score.
    } as Record<string, { fit: number; priority: number; grade: string; needsReview: boolean } | undefined>;
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
    expect(byId["c-new"].fit).toBeNull();
    expect(byId["c-scored"].fit).toBe(62);
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
      { c1: { fit: 55, priority: 50, grade: "B", needsReview: true } },
      { c1: { status: "approved" } },
    );
    expect(queue[0].status).toBe("approved");
  });

  it("batch-approves scored leads at any grade, but never needs-review or non-scored rows", () => {
    const row = (status: QueueRow["status"], grade: string | null): QueueRow => ({
      contactId: "c",
      name: "C",
      company: "Co",
      fit: 10,
      priority: 10,
      grade,
      status,
    });

    // Any grade is eligible while the status is "scored" - a low grade is still a
    // reviewed verdict worth writing back.
    expect(isBatchApprovable(row("scored", "A"))).toBe(true);
    expect(isBatchApprovable(row("scored", "D"))).toBe(true);

    // Needs-review is never batch-approved, regardless of grade.
    expect(isBatchApprovable(row("needs review", "A"))).toBe(false);
    expect(isBatchApprovable(row("needs review", "D"))).toBe(false);

    // Nothing else is auto-approved either.
    expect(isBatchApprovable(row("new", null))).toBe(false);
    expect(isBatchApprovable(row("approved", "B"))).toBe(false);
    expect(isBatchApprovable(row("synced", "B"))).toBe(false);
  });

  it("keeps input order for contacts that tie on priority (stable)", () => {
    const contacts = [
      { id: "a", name: "A", companyName: "Co" },
      { id: "b", name: "B", companyName: "Co" },
      { id: "c", name: "C", companyName: "Co" },
    ];
    const scores = {
      a: { fit: 50, priority: 50, grade: "B", needsReview: false },
      b: { fit: 50, priority: 50, grade: "B", needsReview: false },
      c: { fit: 50, priority: 50, grade: "B", needsReview: false },
    };
    const queue = buildQueue(contacts, scores, {});
    expect(queue.map((r) => r.contactId)).toEqual(["a", "b", "c"]);
  });
});

describe("dry-run write-backs", () => {
  it("is not reported as synced", () => {
    const rows = buildQueue(
      [{ id: "c1", name: "Dry Run", companyName: "Acme" }],
      { c1: { fit: 80, priority: 80, grade: "B", needsReview: false } },
      { c1: { status: "dry_run" } },
    );
    // Nothing reached the CRM, so calling this synced would be a claim the app
    // cannot back up.
    expect(rows[0].status).toBe("dry run");
    expect(isBatchApprovable(rows[0])).toBe(false);
  });
});
