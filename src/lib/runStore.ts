import { RunBus } from "./events";

const buses = new Map<string, RunBus>();

export const getBus = (id: string) => buses.get(id);
export const makeBus = (id: string) => { const b = new RunBus(id); buses.set(id, b); return b; };
export const dropBus = (id: string) => buses.delete(id);
