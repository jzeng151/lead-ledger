import { liveToolsEnabled, loadFixture, type FieldVal } from "./adapter";
import { fetchUrl } from "./fetchUrl";

export type TechStack = {
  technologies: string[];
  competitorPresent: FieldVal<boolean>;
  // Field-shaped, matching TechFindings: the agent forwards this straight into
  // submit_findings, and a bare string there fails schema validation and aborts
  // the run. It also keeps the evidence citeable.
  competitorEvidence: FieldVal<string> | null;
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

// Observability vendors we compete with. A live scan must check these before it
// reports competitorPresent: false, otherwise a lead already running Datadog
// looks like open territory to ICP-fit purely because its homepage is Next.js.
const COMPETITORS: Array<[RegExp, string]> = [
  [/datadoghq|datadog-rum|dd-trace/i, "Datadog"],
  [/newrelic|nr-data\.net/i, "New Relic"],
  [/dynatrace|ruxitagentjs/i, "Dynatrace"],
  [/appdynamics|adrum/i, "AppDynamics"],
  [/browser\.sentry-cdn\.com|sentry\.io/i, "Sentry"],
  [/honeycomb\.io/i, "Honeycomb"],
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
    competitorEvidence: t.competitorEvidence ? { value: t.competitorEvidence, confidence: 0.7, source: src } : null,
    complementSignals,
    notes: t.recentIncident ? "Recent incident reported on public status page." : null,
  };
}

// Keyless: fingerprint the live homepage only when explicitly enabled, else the tech fixture.
// Default (LEAD_LEDGER_LIVE_TOOLS unset) keeps the demo and tests deterministic.
export async function detectTechStack(domain: string): Promise<TechStack> {
  if (liveToolsEnabled()) {
    try {
      const html = await fetchUrl(`https://${domain}`);
      // A page that loaded and matched nothing is still a real observation, and
      // for a domain with no fixture it is the only one available. Falling back
      // here reported competitorPresent: null from a fixture that does not exist
      // instead of the low-confidence false the scan actually supports.
      if (html) {
        const found = FINGERPRINTS.filter(([re]) => re.test(html)).map(([, name]) => name);
        const competitor = COMPETITORS.find(([re]) => re.test(html));
        return {
          technologies: competitor ? [...found, competitor[1]] : found,
          // A positive is direct evidence (their script is on the page); a
          // negative only means this one page carried no competitor tag, which
          // is why it stays low-confidence.
          competitorPresent: {
            value: Boolean(competitor),
            confidence: competitor ? 0.8 : 0.3,
            source: `https://${domain}`,
          },
          competitorEvidence: competitor
            ? { value: `${competitor[1]} script served on https://${domain}`, confidence: 0.8, source: `https://${domain}` }
            : null,
          complementSignals: [],
          notes: null,
        };
      }
    } catch {
      // fall through to fixture
    }
  }
  return mockTech(domain);
}
