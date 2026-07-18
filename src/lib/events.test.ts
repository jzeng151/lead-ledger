import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { RunBus, type RunEvent } from "./events";
import { getBus, makeBus, dropBus } from "./runStore";

// Compile-time proof that RunBus satisfies the runner's EventSink contract.
const _sink: import("./agents/runSubagent").EventSink = new RunBus("compile-check");
void _sink;

// The app DB is gitignored (data.sqlite), so a fresh checkout may lack the
// run_events table. Create it via the app's own connection if missing; this is
// a no-op when Task 2's push already created it.
beforeAll(() => {
  db.run(sql`CREATE TABLE IF NOT EXISTS run_events (
    id integer PRIMARY KEY AUTOINCREMENT,
    run_id text NOT NULL,
    agent text NOT NULL,
    type text NOT NULL,
    payload text,
    ts integer NOT NULL
  )`);
});

// Unique per test-run id so repeated runs never collide.
const runId = `run-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;

describe("RunBus", () => {
  it("delivers emitted events to subscribers synchronously", () => {
    const bus = new RunBus(runId);
    const received: RunEvent[] = [];
    bus.on((e) => received.push(e));

    const event: RunEvent = { agent: "contact", type: "score_ready", payload: { priority: 82 } };
    bus.emit(event);

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(event);
  });

  it("persists each emitted event to run_events", () => {
    const rows = db.select().from(schema.runEvents).where(eq(schema.runEvents.runId, runId)).all();
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const row = rows[0];
    expect(row.agent).toBe("contact");
    expect(row.type).toBe("score_ready");
    expect(row.payload).toEqual({ priority: 82 });
  });
});

describe("runStore", () => {
  it("makeBus registers a bus that getBus returns, dropBus removes it", () => {
    const id = `store-${runId}`;
    const bus = makeBus(id);
    expect(getBus(id)).toBe(bus);
    expect(dropBus(id)).toBe(true);
    expect(getBus(id)).toBeUndefined();
  });
});

describe("token heartbeat", () => {
  afterEach(() => vi.useRealTimers());

  it("keeps tokens out of the table but leaves a marker once past the window", () => {
    vi.useFakeTimers();
    const bus = new RunBus("hb-run");
    const rows = () => db.select().from(schema.runEvents).where(eq(schema.runEvents.runId, "hb-run")).all();

    bus.emit({ agent: "synthesis", type: "agent_started", payload: {} });
    for (let i = 0; i < 500; i++) bus.emit({ agent: "synthesis", type: "agent_token", payload: { text: "x" } });

    // A burst of tokens inside the window persists nothing: that is the point of
    // skipping them.
    expect(rows()).toHaveLength(1);

    // A model that streams for minutes with no other event used to leave the run
    // looking idle, so activeRuns() aged it out while it was still working.
    vi.advanceTimersByTime(61_000);
    bus.emit({ agent: "synthesis", type: "agent_token", payload: { text: "x" } });

    const after = rows();
    expect(after).toHaveLength(2);
    expect(after[1].type).toBe("agent_progress");
    expect(after.every((r) => r.type !== "agent_token")).toBe(true);
  });
});
