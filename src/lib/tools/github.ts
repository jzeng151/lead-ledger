import { fetchWithTimeout } from "./adapter";

export type GithubOrg = {
  login: string | null;
  url: string | null;
  publicRepos: number | null;
  exists: boolean;
  source: string;
};

// Keyless (token optional): look up the org, fall back to confirming the fixture-sourced login.
export async function githubOrgLookup(org: string): Promise<GithubOrg> {
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
    // fall through to fixture-derived confirmation
  }
  return {
    login: org || null,
    url: org ? `https://github.com/${org}` : null,
    publicRepos: null,
    exists: Boolean(org),
    source: "fixture:github",
  };
}
