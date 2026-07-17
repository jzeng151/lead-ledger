import { EventEmitter } from "node:events";
import { db, schema } from "../db";

export type RunEvent = { agent: string; type: string; payload: unknown };

export class RunBus {
  private ee = new EventEmitter();
  constructor(public runId: string) {}

  emit(e: RunEvent): void {
    // Token deltas are high-volume and only useful live; persisting every one
    // bloats run_events without helping replay, so skip the insert for them.
    if (e.type !== "agent_token") {
      db.insert(schema.runEvents)
        .values({ runId: this.runId, agent: e.agent, type: e.type, payload: e.payload, ts: new Date() })
        .run();
    }
    this.ee.emit("event", e);
  }

  on(fn: (e: RunEvent) => void): void { this.ee.on("event", fn); }
  once(fn: (e: RunEvent) => void): void { this.ee.once("event", fn); }
  off(fn: (e: RunEvent) => void): void { this.ee.off("event", fn); }
}
