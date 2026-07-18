import { loadFixture, fetchWithTimeout } from "./adapter";

export type NewsItem = {
  date: string;
  type: string;
  summary: string;
  source: string;
  talkingPoint?: string;
  fresh?: boolean;
};

// How recent an article has to be to count as a live trigger rather than
// background. The scorer gives a fresh event its full timing weight and
// discounts a stale one, so this decides whether old news moves the priority.
const FRESH_DAYS = 90;

// GDELT stamps articles as YYYYMMDDTHHMMSSZ.
export function parseSeendate(seendate: string | undefined): Date | null {
  const m = (seendate ?? "").match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const t = Date.parse(`${y}-${mo}-${d}T${h}:${mi}:${s}Z`);
  return Number.isNaN(t) ? null : new Date(t);
}

function mapArticles(data: any, now = Date.now()): NewsItem[] {
  const arts = Array.isArray(data?.articles) ? data.articles : [];
  return arts.map((a: any) => {
    const seen = parseSeendate(a.seendate);
    return {
      date: a.seendate ?? "",
      type: "news",
      summary: a.title ?? "",
      source: a.url ?? "",
      // Derive freshness from the article date. Hardcoding true gave a year-old
      // funding story the same lift as one from last week, and an undated
      // article is not evidence of recency either.
      fresh: seen ? now - seen.getTime() <= FRESH_DAYS * 24 * 60 * 60 * 1000 : false,
    };
  });
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
