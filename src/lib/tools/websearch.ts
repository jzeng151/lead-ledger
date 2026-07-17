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

// SerpAPI when a key is present; otherwise the news fixture directly (no live call).
export async function webSearch(query: string): Promise<{ events: NewsItem[] }> {
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
  return { events: (loadFixture(query).news ?? []) as NewsItem[] };
}
