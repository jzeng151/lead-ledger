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

describe("loadFixture key safety", () => {
  it("refuses a path-traversal key instead of reading JSON outside the fixture dir", () => {
    // The domain reaching a tool is model-supplied, so it must not be able to
    // address package.json or any other JSON in the workspace.
    expect(loadFixture("../../../package")).toEqual({});
    expect(loadFixture("../package")).toEqual({});
    expect(loadFixture("/etc/passwd")).toEqual({});
  });

  it("still reads an ordinary domain fixture", () => {
    expect(Object.keys(loadFixture("northwind.dev")).length).toBeGreaterThan(0);
  });
});
