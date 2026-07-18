import { EventEmitter } from "node:events";
import { db, schema } from "../db";

export type RunEvent = { agent: string; type: string; payload: unknown };

// How often a long stream of tokens leaves a persisted marker behind.
const HEARTBEAT_MS = 60_000;

export class RunBus {
  private ee = new EventEmitter();
  constructor(public runId: string) {}

  // Last row written for this run, so token deltas can leave a sparse trace of
  // progress without persisting every one of them.
  private lastPersisted = 0;

  emit(e: RunEvent): void {
    // Token deltas are high-volume and only useful live; persisting every one
    // bloats run_events without helping replay, so skip the insert for them.
    // A long streamed answer can still be the only thing happening for minutes,
    // though, and staleness is measured from the last persisted event: without a
    // heartbeat the run ages out of activeRuns() while it is very much alive, and
    // the dashboard, re-run guard, and write-back guard all treat it as idle.
    const now = Date.now();
    const heartbeat = e.type === "agent_token" && now - this.lastPersisted > HEARTBEAT_MS;
    if (e.type !== "agent_token" || heartbeat) {
      this.lastPersisted = now;
      db.insert(schema.runEvents)
        .values({
          runId: this.runId,
          agent: e.agent,
          type: heartbeat ? "agent_progress" : e.type,
          payload: heartbeat ? {} : e.payload,
          ts: new Date(now),
        })
        .run();
    }
    this.ee.emit("event", e);
  }

  on(fn: (e: RunEvent) => void): void { this.ee.on("event", fn); }
  once(fn: (e: RunEvent) => void): void { this.ee.once("event", fn); }
  off(fn: (e: RunEvent) => void): void { this.ee.off("event", fn); }
}
