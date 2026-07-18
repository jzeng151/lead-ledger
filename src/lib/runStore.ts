import { EventEmitter } from "node:events";
import { RunBus } from "./events";

const buses = new Map<string, RunBus>();

export const getBus = (id: string) => buses.get(id);
export const makeBus = (id: string) => {
  const b = new RunBus(id);
  buses.set(id, b);
  return b;
};
export const dropBus = (id: string) => buses.delete(id);

// Cross-run activity hub. Run lifecycle transitions (a run starts, scores, or
// errors) notify it so the dashboard can update via a pushed SSE event instead
// of polling. Single-process only (module-level, like the per-run buses above);
// a multi-instance deploy would need a shared pub/sub.
const activity = new EventEmitter();
activity.setMaxListeners(0);
export const notifyActivity = () => activity.emit("activity");
export const onActivity = (fn: () => void) => activity.on("activity", fn);
export const offActivity = (fn: () => void) => activity.off("activity", fn);
