import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { execSync } from "node:child_process";
import { db, schema } from "../../db";
import { loadFixture } from "./adapter";
import { pdlCompanyEnrich, pdlPersonEnrich } from "./pdl";
import { apolloOrgEnrich, apolloPersonMatch } from "./apollo";
import { hunterVerifyEmail } from "./hunter";
import { gdeltNewsSearch } from "./gdelt";
import { webSearch } from "./websearch";
import { fetchUrl } from "./fetchUrl";
import { detectTechStack } from "./techstack";
import { githubOrgLookup } from "./github";
import { hubspotGetContact, hubspotGetEngagements, realEngagements } from "./hubspotTools";

const DOMAIN = "northwind.dev";

// Seed only if the DB has no contacts yet (tasks 1-4 normally leave it seeded).
beforeAll(() => {
  let seeded = false;
  try {
    seeded = db.select().from(schema.contacts).all().length > 0;
  } catch {
    seeded = false;
  }
  if (!seeded) {
    execSync("npm run db:push && npm run seed", { stdio: "inherit" });
  }
  // Ensure the one row this file reads, rather than inferring it from "some
  // contact exists": a sync test in the same worker legitimately purges contacts
  // HubSpot no longer returns, which can include this one.
  db.insert(schema.contacts)
    .values({
      id: "c-northwind",
      name: "Priya Nair",
      email: "priya@northwind.dev",
      title: "VP Engineering",
      companyName: "Northwind Labs",
      companyDomain: "northwind.dev",
      props: {},
      syncedAt: new Date(),
    })
    .onConflictDoNothing()
    .run();
});

describe("enrichment adapters read fixtures on the mock path (no keys)", () => {
  it("pdlCompanyEnrich -> company fixture", async () => {
    expect((await pdlCompanyEnrich(DOMAIN)).industry.value).toBe("software");
  });
  it("pdlPersonEnrich -> person fixture", async () => {
    expect((await pdlPersonEnrich(DOMAIN)).title.value).toBe("VP Engineering");
  });
  it("pdlCompanyEnrich exposes the full company field set (type + runtime)", async () => {
    const c = await pdlCompanyEnrich(DOMAIN);
    // Type-level check: the rich fields must be visible on the inferred return type,
    // i.e. pickImpl must not narrow to the real impl's shape.
    const revenue: string | null = c.revenueBand.value;
    expect(revenue).toBe("$10M-$50M");
    expect(c.latestRound.value).toBe("Series B");
  });
  it("pdlCompanyEnrich -> missing fixture resolves with null fields", async () => {
    const c = await pdlCompanyEnrich("does-not-exist.example");
    expect(c.industry.value).toBeNull();
    expect(c.industry.confidence).toBe(0);
    expect(c.revenueBand.value).toBeNull();
  });
  it("apolloOrgEnrich -> company fixture", async () => {
    expect((await apolloOrgEnrich(DOMAIN)).industry.value).toBe("software");
  });
  it("apolloPersonMatch -> person fixture", async () => {
    const p = await apolloPersonMatch({ name: "Priya Nair", domain: DOMAIN });
    expect(p.seniority.value).toBe("VP");
  });
  it("hunterVerifyEmail -> emailVerified fixture", async () => {
    expect((await hunterVerifyEmail("priya@northwind.dev")).verified.value).toBe(true);
  });
  it("hunterVerifyEmail -> email without a domain resolves without throwing", async () => {
    const r = await hunterVerifyEmail("no-at-sign");
    expect(r.verified.value).toBeNull();
    expect(r.confidence).toBe(0);
  });
  it("gdeltNewsSearch -> news fixture", async () => {
    const { events } = await gdeltNewsSearch({ domain: DOMAIN });
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].type).toBe("funding");
  });
  it("webSearch -> news fixture (no SerpAPI key)", async () => {
    const { events } = await webSearch(DOMAIN);
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].type).toBe("funding");
  });
  it("fetchUrl -> string (empty on unresolved host)", async () => {
    expect(typeof (await fetchUrl(`https://${DOMAIN}`))).toBe("string");
  });
  it("detectTechStack -> tech fixture", async () => {
    const tech = await detectTechStack(DOMAIN);
    expect(tech.technologies).toContain("Next.js");
    expect(tech.competitorPresent.value).toBe(false);
  });
  it("githubOrgLookup -> echoes the org without claiming it exists", async () => {
    const org = loadFixture(DOMAIN).tech.githubOrg;
    const res = await githubOrgLookup(org);
    expect(res.login).toBe("northwind");
    // Nothing was looked up on the mock path, so existence is unknown. Reporting
    // true here fabricated a positive technographic signal for any guessed org.
    expect(res.exists).toBeNull();
  });
  it("hubspotGetContact -> seeded contact row", async () => {
    expect((await hubspotGetContact("c-northwind")).name).toBe("Priya Nair");
  });
  it("hubspotGetEngagements -> engagement fixture", async () => {
    expect((await hubspotGetEngagements("c-northwind")).recencyDays).toBe(3);
  });
});

describe("engagement timeline availability", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("marks an unreadable timeline uncertain, and a genuinely empty one certain", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 403 })));
    const unreadable = await realEngagements("c-northwind");
    // Reported as a confident zero, a 403 or a timeout let a lead be batch
    // approved on activity data that was never actually available.
    expect(unreadable.topActions).toEqual([]);
    expect(unreadable.attributionUncertain).toBe(true);

    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ results: [] })));
    const empty = await realEngagements("c-northwind");
    // A quiet timeline is an ordinary state, not an uncertainty.
    expect(empty.attributionUncertain).toBe(false);
  });
});
