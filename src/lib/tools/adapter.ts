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
