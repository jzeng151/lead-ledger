import { describe, it, expect, beforeAll } from "vitest";
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
import { hubspotGetContact, hubspotGetEngagements } from "./hubspotTools";

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
});

describe("enrichment adapters read fixtures on the mock path (no keys)", () => {
  it("pdlCompanyEnrich -> company fixture", async () => {
    expect((await pdlCompanyEnrich(DOMAIN)).industry.value).toBe("software");
  });
  it("pdlPersonEnrich -> person fixture", async () => {
    expect((await pdlPersonEnrich(DOMAIN)).title.value).toBe("VP Engineering");
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
  it("gdeltNewsSearch -> news fixture", async () => {
    const { events } = await gdeltNewsSearch({ company: DOMAIN });
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
  it("githubOrgLookup -> confirms fixture org", async () => {
    const org = loadFixture(DOMAIN).tech.githubOrg;
    const res = await githubOrgLookup(org);
    expect(res.login).toBe("northwind");
    expect(res.exists).toBe(true);
  });
  it("hubspotGetContact -> seeded contact row", async () => {
    expect((await hubspotGetContact("c-northwind")).name).toBe("Priya Nair");
  });
  it("hubspotGetEngagements -> engagement fixture", async () => {
    expect((await hubspotGetEngagements("c-northwind")).recencyDays).toBe(3);
  });
});
