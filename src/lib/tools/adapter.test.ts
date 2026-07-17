import { describe, it, expect } from "vitest";
import { pickImpl, loadFixture } from "./adapter";

describe("pickImpl", () => {
  it("uses mock when key absent", async () => {
    const fn = pickImpl(undefined, async () => "real", async () => "mock");
    expect(await fn()).toBe("mock");
  });
  it("uses real when key present", async () => {
    const fn = pickImpl("k", async () => "real", async () => "mock");
    expect(await fn()).toBe("real");
  });
});

describe("loadFixture", () => {
  it("resolves the real fixture path", () => {
    expect(loadFixture("northwind.dev")).toHaveProperty("company");
  });
  it("returns {} for a missing fixture", () => {
    expect(loadFixture("does-not-exist")).toEqual({});
  });
});
