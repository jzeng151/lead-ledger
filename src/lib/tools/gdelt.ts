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

// Keyless: try live GDELT, fall back to the news fixture on failure or an empty result.
export async function gdeltNewsSearch({
  company,
  sinceDays = 90,
}: {
  company: string;
  sinceDays?: number;
}): Promise<{ events: NewsItem[] }> {
  try {
    const url =
      `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(company)}` +
      `&mode=artlist&maxrecords=25&timespan=${sinceDays}d&format=json`;
    const res = await fetchWithTimeout(url);
    if (res.ok) {
      const events = mapArticles(await res.json());
      if (events.length) return { events };
    }
  } catch {
    // fall through to fixture
  }
  return { events: (loadFixture(company).news ?? []) as NewsItem[] };
}
