import { loadFixture, fetchWithTimeout } from "./adapter";
import type { NewsItem } from "./gdelt";

function mapSerp(data: any): NewsItem[] {
  const results = Array.isArray(data?.news_results)
    ? data.news_results
    : Array.isArray(data?.organic_results)
      ? data.organic_results
      : [];
  return results.map((r: any) => ({
    date: r.date ?? "",
    type: "news",
    summary: r.title ?? r.snippet ?? "",
    source: r.link ?? "",
    fresh: true,
  }));
}

// Pull a domain-like token out of a free-form query so the demo fixture resolves
// even when the model passes a natural-language search string rather than the
// bare domain. Falls back to the query itself when no domain is present.
function domainFromQuery(q: string): string {
  const m = q.match(/\b([a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.[a-z]{2,})\b/i);
  return m ? m[1] : q;
}

// SerpAPI when a key is present; otherwise the news fixture, keyed by the company
// domain (passed explicitly, else extracted from the query).
export async function webSearch(query: string, domain?: string): Promise<{ events: NewsItem[] }> {
  const key = process.env.SERPAPI_KEY;
  if (key) {
    try {
      const res = await fetchWithTimeout(
        `https://serpapi.com/search.json?q=${encodeURIComponent(query)}&api_key=${key}`,
      );
      if (res.ok) {
        const events = mapSerp(await res.json());
        if (events.length) return { events };
      }
    } catch {
      // fall through to fixture
    }
  }
  return { events: (loadFixture(domain ?? domainFromQuery(query)).news ?? []) as NewsItem[] };
}
