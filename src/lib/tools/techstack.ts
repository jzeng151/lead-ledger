import { loadFixture, type FieldVal } from "./adapter";
import { fetchUrl } from "./fetchUrl";

export type TechStack = {
  technologies: string[];
  competitorPresent: FieldVal<boolean>;
  competitorEvidence: string | null;
  complementSignals: string[];
  notes: string | null;
};

const FINGERPRINTS: Array<[RegExp, string]> = [
  [/__NEXT_DATA__|\/_next\//, "Next.js"],
  [/data-reactroot|react-dom/i, "React"],
  [/wp-content|wp-includes/i, "WordPress"],
  [/cdn\.shopify\.com/i, "Shopify"],
  [/vercel/i, "Vercel"],
];

function mockTech(domain: string): TechStack {
  const t = loadFixture(domain).tech ?? {};
  const src = "fixture:techstack";
  const complementSignals: string[] = [];
  if (t.statusPage) complementSignals.push("status_page");
  if (t.recentIncident) complementSignals.push("recent_incident");
  return {
    technologies: Array.isArray(t.technologies) ? t.technologies : [],
    competitorPresent: { value: t.competitorPresent ?? null, confidence: 0.7, source: src },
    competitorEvidence: t.competitorEvidence ?? null,
    complementSignals,
    notes: t.recentIncident ? "Recent incident reported on public status page." : null,
  };
}

// Keyless: fingerprint the live homepage only when explicitly enabled, else the tech fixture.
// Default (LEAD_LEDGER_LIVE_TOOLS unset) keeps the demo and tests deterministic.
export async function detectTechStack(domain: string): Promise<TechStack> {
  if (process.env.LEAD_LEDGER_LIVE_TOOLS === "1") {
    try {
      const html = await fetchUrl(`https://${domain}`);
      if (html) {
        const found = FINGERPRINTS.filter(([re]) => re.test(html)).map(([, name]) => name);
        if (found.length) {
          return {
            technologies: found,
            competitorPresent: { value: false, confidence: 0.3, source: `https://${domain}` },
            competitorEvidence: null,
            complementSignals: [],
            notes: null,
          };
        }
      }
    } catch {
      // fall through to fixture
    }
  }
  return mockTech(domain);
}
