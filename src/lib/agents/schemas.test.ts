import { describe, it, expect } from "vitest";

import { IcpFitFindings } from "./schemas";

describe("IcpFitFindings axis bounds", () => {
  it("accepts 0-1 axes and fills a neutral default", () => {
    const parsed = IcpFitFindings.parse({ firmographic: 0.9, role: 0.6 });
    expect(parsed.firmographic).toBe(0.9);
    expect(parsed.technographic).toBe(0.5);
  });

  it("rejects an axis answered on a 0-100 scale rather than persisting an impossible fit", () => {
    expect(IcpFitFindings.safeParse({ firmographic: 80, role: 70, technographic: 60 }).success).toBe(false);
    expect(IcpFitFindings.safeParse({ role: -0.2 }).success).toBe(false);
  });
});
