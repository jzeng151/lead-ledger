import { describe, it, expect, afterAll } from "vitest";
import { eq } from "drizzle-orm";

import { db, schema } from "@/db";
import { DEFAULT_ICP } from "@/lib/icp";
import { PUT, GET } from "./route";

// Leave the shared config as the test suite found it.
afterAll(() => db.delete(schema.icpConfig).where(eq(schema.icpConfig.id, "default")).run());

const put = async (patch: unknown) =>
  await (await PUT(new Request("http://test/api/icp", { method: "PUT", body: JSON.stringify(patch) }))).json();

describe("ICP patch merge", () => {
  it("keeps the rest of a nested section when only one field is patched", async () => {
    // A shallow merge dropped urgency.weights here, and every later run and
    // re-score then threw when the scorer dereferenced it.
    const merged = await put({ urgency: { liftMax: 10 } });

    expect(merged.urgency.liftMax).toBe(10);
    expect(merged.urgency.weights.funding).toBe(DEFAULT_ICP.urgency.weights.funding);
    expect(merged.urgency.staleFactor).toBe(DEFAULT_ICP.urgency.staleFactor);
    expect(merged.weights.firmographic).toBe(DEFAULT_ICP.weights.firmographic);
  });

  it("merges one trigger weight without dropping the others", async () => {
    const merged = await put({ urgency: { weights: { funding: 0.1 } } });

    expect(merged.urgency.weights.funding).toBe(0.1);
    expect(merged.urgency.weights.layoffs).toBe(DEFAULT_ICP.urgency.weights.layoffs);
  });

  it("persists the merge", async () => {
    await put({ grades: { A: 95 } });
    const stored = await (await GET()).json();

    expect(stored.grades.A).toBe(95);
    expect(stored.grades.B).toBe(DEFAULT_ICP.grades.B);
  });
});
