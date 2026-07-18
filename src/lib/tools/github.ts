import { fetchWithTimeout, liveToolsEnabled, trace } from "./adapter";

export type GithubOrg = {
  login: string | null;
  url: string | null;
  publicRepos: number | null;
  /** null when nothing confirmed the org: an echo is a guess, not a finding. */
  exists: boolean | null;
  source: string;
};

// Keyless (token optional): look up the org live only when explicitly enabled, else echo the
// caller-supplied login. Default (LEAD_LEDGER_LIVE_TOOLS unset) keeps the demo deterministic.
export async function githubOrgLookup(org: string): Promise<GithubOrg> {
  if (liveToolsEnabled()) {
    try {
      const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
      if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
      const res = await fetchWithTimeout(`https://api.github.com/orgs/${encodeURIComponent(org)}`, {
        headers,
      });
      if (res.ok) {
        const d = await res.json();
        return {
          login: d.login ?? org,
          url: d.html_url ?? null,
          publicRepos: typeof d.public_repos === "number" ? d.public_repos : null,
          exists: true,
          source: "github.com",
        };
      }
    } catch {
      // fall through to the echoed login
    }
  }
  trace({
    query: org,
    mode: "web",
    location: org ? `github.com/${org} (echoed, no live lookup)` : "github (no org)",
    outcome: "empty",
    detail: org ? "echoed input, existence unconfirmed" : undefined,
  });
  // Nothing was looked up here, so existence is unknown. Reporting true would
  // hand the tech agent a fabricated positive for any org name it guessed from
  // the domain, inflating the technographic axis.
  return {
    login: org || null,
    url: org ? `https://github.com/${org}` : null,
    publicRepos: null,
    exists: null,
    source: "github:echo",
  };
}
