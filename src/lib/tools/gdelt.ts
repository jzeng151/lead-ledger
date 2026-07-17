import { loadFixture, fetchWithTimeout } from "./adapter";

export type NewsItem = {
  date: string;
  type: string;
  summary: string;
  source: string;
  talkingPoint?: string;
  fresh?: boolean;
};

function mapArticles(data: any): NewsItem[] {
  const arts = Array.isArray(data?.articles) ? data.articles : [];
  return arts.map((a: any) => ({
    date: a.seendate ?? "",
    type: "news",
    summary: a.title ?? "",
    source: a.url ?? "",
    fresh: true,
  }));
}

// Keyless: try live GDELT only when explicitly enabled, else the news fixture.
// Default (LEAD_LEDGER_LIVE_TOOLS unset) keeps the demo and tests deterministic.
export async function gdeltNewsSearch({
  domain,
  sinceDays = 90,
}: {
  domain: string;
  sinceDays?: number;
}): Promise<{ events: NewsItem[] }> {
  if (process.env.LEAD_LEDGER_LIVE_TOOLS === "1") {
    try {
      const url =
        `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(domain)}` +
        `&mode=artlist&maxrecords=25&timespan=${sinceDays}d&format=json`;
      const res = await fetchWithTimeout(url);
      if (res.ok) {
        const events = mapArticles(await res.json());
        if (events.length) return { events };
      }
    } catch {
      // fall through to fixture
    }
  }
  return { events: (loadFixture(domain).news ?? []) as NewsItem[] };
}
