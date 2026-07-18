import { loadFixture, fetchWithTimeout, useRealProvider } from "./adapter";
import type { NewsItem } from "./gdelt";

const FRESH_DAYS = 90;

/**
 * Age a SerpAPI result in days, or null when its date is unreadable. The field
 * is free-form: an absolute date ("Apr 1, 2026") or a relative one ("3 days
 * ago", "2 months ago").
 */
export function ageInDays(date: string | undefined, now = Date.now()): number | null {
  const s = (date ?? "").trim();
  if (!s) return null;

  const rel = s.match(/^(\d+)\s*(minute|hour|day|week|month|year)s?\s+ago$/i);
  if (rel) {
    const n = Number(rel[1]);
    const perDay: Record<string, number> = { minute: 1 / 1440, hour: 1 / 24, day: 1, week: 7, month: 30, year: 365 };
    return n * perDay[rel[2].toLowerCase()];
  }

  const t = Date.parse(s);
  return Number.isNaN(t) ? null : (now - t) / 86_400_000;
}

function mapSerp(data: any): NewsItem[] {
  const results = Array.isArray(data?.news_results)
    ? data.news_results
    : Array.isArray(data?.organic_results)
      ? data.organic_results
      : [];
  return results.map((r: any) => {
    // Hardcoding fresh gave a year-old story the same timing lift as one from
    // last week. An unreadable date is not evidence of recency either.
    const age = ageInDays(r.date);
    return {
      date: r.date ?? "",
      type: "news",
      summary: r.title ?? r.snippet ?? "",
      source: r.link ?? "",
      fresh: age !== null && age <= FRESH_DAYS,
    };
  });
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
  // Demo mode pins this to the fixture. webSearch builds its own client rather
  // than going through pickImpl, so it has to apply the same gate: otherwise a
  // showcase run with a retained SERPAPI_KEY pulls live results for fixture
  // domains and the timing, rationale, and score stop being reproducible.
  if (useRealProvider(key)) {
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
