import fs from "node:fs";
import path from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Choose the real adapter when its provider key is present, otherwise the
 * fixture one. LEAD_LEDGER_DEMO=1 forces fixtures for every adapter even when
 * keys are set: the seeded contacts use fictional domains and ids that real
 * providers do not know, so a stray key would otherwise turn a demo run into
 * empty results or errors. Sync and write-back read HUBSPOT_TOKEN directly and
 * are unaffected, so demo mode still writes to real HubSpot.
 */
/**
 * Should the real provider be used for this key? Demo mode forces fixtures even
 * when a key is present, so a showcase run stays deterministic without anyone
 * having to unset their credentials.
 */
export function useRealProvider(key: string | undefined): boolean {
  return Boolean(key) && process.env.LEAD_LEDGER_DEMO !== "1";
}

export function pickImpl<A extends unknown[], R>(
  key: string | undefined,
  real: (...a: A) => Promise<R>,
  mock: (...a: A) => Promise<R>,
) {
  const useReal = useRealProvider(key);
  return (...a: A) => (useReal ? real(...a) : mock(...a));
}

// ---------------------------------------------------------------------------
// Source trace: a per-subagent context the low-level accessors write into, so
// the run's Trace tab can show exactly where each tool looked (URL or fixture
// path), the HTTP status on live calls, and whether it found anything.
// ---------------------------------------------------------------------------

export type ToolTrace = {
  tool: string;
  query?: string;
  mode: "live" | "fixture" | "db" | "web";
  location: string; // exact URL (secrets redacted) or fixture path
  outcome: "ok" | "found" | "empty" | "error";
  status?: number; // HTTP status for live calls
  detail?: string; // fields/sections found, or reason for empty/error
};

type TraceCtx = { emit: (t: ToolTrace) => void; tool?: string; query?: string };
const traceStore = new AsyncLocalStorage<TraceCtx>();

/** Establish a trace scope; source accesses during `fn` emit through `emit`. */
export function withTrace<T>(emit: (t: ToolTrace) => void, fn: () => Promise<T>): Promise<T> {
  return traceStore.run({ emit }, fn);
}

/** Tag the current scope with the executing tool + query so accessors attribute
 *  their trace to it. No-op outside a trace scope (e.g. direct calls in tests). */
export function withTool<T>(tool: string, query: string, fn: () => Promise<T>): Promise<T> {
  const ctx = traceStore.getStore();
  return ctx ? traceStore.run({ ...ctx, tool, query }, fn) : fn();
}

/** Emit a source-access record to the current trace scope, if any. */
export function trace(t: Omit<ToolTrace, "tool"> & { tool?: string }): void {
  const ctx = traceStore.getStore();
  if (!ctx) return;
  ctx.emit({ tool: t.tool ?? ctx.tool ?? "tool", query: t.query ?? ctx.query, ...t });
}

// Redact secrets from a URL before it appears in the trace (keys in the query).
function redact(url: string): string {
  return url.replace(/([?&](?:api_key|apikey|key|token)=)[^&]*/gi, "$1***");
}

const REL = "src/fixtures/enrichment";
const dir = path.join(process.cwd(), REL);

export function loadFixture(domain: string): Record<string, any> {
  const f = path.join(dir, `${domain}.json`);
  const exists = fs.existsSync(f);
  const data = exists ? JSON.parse(fs.readFileSync(f, "utf8")) : {};
  trace({
    query: domain,
    mode: "fixture",
    location: `${REL}/${domain}.json`,
    outcome: exists ? "found" : "empty",
    detail: exists ? `sections: ${Object.keys(data).join(", ") || "none"}` : "file not found",
  });
  return data;
}

export type FieldVal<T> = { value: T | null; confidence: number; source: string };

// Bounded fetch for the keyless adapters so a hung socket can never stall a run.
// Emits a trace record for the call (URL + HTTP status, or timeout/error).
export async function fetchWithTimeout(url: string, init: RequestInit = {}, ms = 4000): Promise<Response> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    const res = await fetch(url, { ...init, signal: ac.signal });
    trace({ mode: "live", location: redact(url), status: res.status, outcome: res.ok ? "ok" : "error" });
    return res;
  } catch (e) {
    const aborted = (e as { name?: string })?.name === "AbortError";
    trace({ mode: "live", location: redact(url), outcome: "error", detail: aborted ? "timeout" : (e as Error)?.message ?? "fetch failed" });
    throw e;
  } finally {
    clearTimeout(t);
  }
}
