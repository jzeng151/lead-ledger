import fs from "node:fs";
import path from "node:path";

export function pickImpl<A extends unknown[], R>(
  key: string | undefined,
  real: (...a: A) => Promise<R>,
  mock: (...a: A) => Promise<R>,
) {
  return (...a: A) => (key ? real(...a) : mock(...a));
}

const dir = path.join(process.cwd(), "src/fixtures/enrichment");
export function loadFixture(domain: string): Record<string, any> {
  const f = path.join(dir, `${domain}.json`);
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : {};
}

export type FieldVal<T> = { value: T | null; confidence: number; source: string };

// Bounded fetch for the keyless adapters so a hung socket can never stall a run.
export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  ms = 4000,
): Promise<Response> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ac.signal });
  } finally {
    clearTimeout(t);
  }
}
