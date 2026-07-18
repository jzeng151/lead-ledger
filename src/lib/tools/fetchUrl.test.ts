import { describe, it, expect, vi, afterEach } from "vitest";

import { fetchUrl, isPublicHttpUrl } from "./fetchUrl";

describe("isPublicHttpUrl", () => {
  it("allows ordinary public http(s) targets", () => {
    expect(isPublicHttpUrl("https://northwind.dev")).toBe(true);
    expect(isPublicHttpUrl("http://example.com/status")).toBe(true);
    expect(isPublicHttpUrl("https://8.8.8.8/")).toBe(true);
  });

  it("rejects loopback, private, and metadata addresses", () => {
    for (const url of [
      "http://localhost:3000/api/contacts",
      "http://127.0.0.1/",
      "http://0.0.0.0/",
      "http://10.1.2.3/",
      "http://172.16.0.5/",
      "http://192.168.1.1/",
      "http://169.254.169.254/latest/meta-data/", // cloud metadata
      "http://[::1]/",
      "http://[::ffff:127.0.0.1]/", // IPv4-mapped loopback
      "http://[::ffff:7f00:1]/", // same, hex spelling
      "http://[::ffff:10.0.0.5]/",
      "http://db.internal/",
      "http://printer.local/",
    ])
      expect(isPublicHttpUrl(url), url).toBe(false);
  });

  it("rejects non-http schemes and unparseable input", () => {
    expect(isPublicHttpUrl("file:///etc/passwd")).toBe(false);
    expect(isPublicHttpUrl("ftp://example.com")).toBe(false);
    expect(isPublicHttpUrl("not a url")).toBe(false);
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("fetchUrl", () => {
  it("never issues the request for a blocked host", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    expect(await fetchUrl("http://169.254.169.254/latest/meta-data/")).toBe("");
    expect(spy).not.toHaveBeenCalled();
  });

  it("returns page text for a public host", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>ok</html>", { status: 200 })));
    expect(await fetchUrl("https://northwind.dev")).toBe("<html>ok</html>");
  });

  it("caps a huge response instead of buffering all of it", async () => {
    const body = "x".repeat(2 * 1024 * 1024); // 2MB page
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status: 200 })));
    const text = await fetchUrl("https://northwind.dev");
    expect(text.length).toBe(512 * 1024);
  });
});
