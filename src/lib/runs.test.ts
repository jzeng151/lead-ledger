import { describe, it, expect } from "vitest";

import { db, schema } from "../db";
import { activeRunForContact, activeRuns, RUN_STALE_MS } from "./runs";

const { runs } = schema;

describe("activeRuns", () => {
  it("counts a fresh running run and ignores stale and finished ones", () => {
    const now = new Date();
    const stale = new Date(Date.now() - RUN_STALE_MS - 1000);
    db.insert(runs).values({ id: "ar-live", contactId: "ar-c1", status: "running", startedAt: now }).run();
    db.insert(runs).values({ id: "ar-dead", contactId: "ar-c2", status: "running", startedAt: stale }).run();
    db.insert(runs).values({ id: "ar-done", contactId: "ar-c3", status: "scored", startedAt: now }).run();

    const ids = activeRuns().map((r) => r.id);
    expect(ids).toContain("ar-live");
    expect(ids).not.toContain("ar-dead");
    expect(ids).not.toContain("ar-done");
  });

  it("returns the in-flight run for a contact, and null once it goes stale", () => {
    // A crashed process must not strand its contact: the manual re-run and sync
    // both key off this, so a stale row has to stop blocking new runs.
    expect(activeRunForContact("ar-c1")).toBe("ar-live");
    expect(activeRunForContact("ar-c2")).toBeNull();
    expect(activeRunForContact("ar-never-ran")).toBeNull();
  });
});
