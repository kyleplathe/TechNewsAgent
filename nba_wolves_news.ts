/**
 * Official Minnesota Timberwolves headlines from nba.com/timberwolves/news.
 * The page embeds a Next.js __NEXT_DATA__ payload (not a public RSS XML); we parse it
 * so beats like team announcements (e.g. KG) show up alongside Canis Hoopus.
 */

const DEFAULT_PAGE = 'https://www.nba.com/timberwolves/news';

const NEXT_DATA_RE =
  /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/;

function fetchTimeoutMs(): number {
  const n = parseInt(
    process.env.NBA_WOLVES_FETCH_TIMEOUT_MS ??
      process.env.FEED_FETCH_TIMEOUT_MS ??
      '28000',
    10
  );
  return Number.isFinite(n) && n >= 5000 ? Math.min(n, 120_000) : 28_000;
}

function extractPostsFromPageObject(pageObject: unknown): Array<{
  title: string;
  link: string;
  date: string;
}> {
  const out: Array<{ title: string; link: string; date: string }> = [];
  const seen = new Set<string>();
  if (!pageObject || typeof pageObject !== 'object') return out;

  const expanded = (pageObject as Record<string, unknown>).contentExpanded;
  if (!Array.isArray(expanded)) return out;

  for (const block of expanded) {
    if (!block || typeof block !== 'object') continue;
    const posts = (block as Record<string, unknown>).posts;
    if (!Array.isArray(posts)) continue;

    for (const p of posts) {
      if (!p || typeof p !== 'object') continue;
      const pr = p as Record<string, unknown>;
      const title = typeof pr.title === 'string' ? pr.title.trim() : '';
      const link = typeof pr.permalink === 'string' ? pr.permalink.trim() : '';
      const date = typeof pr.date === 'string' ? pr.date.trim() : '';
      if (!title || !link || seen.has(link)) continue;
      seen.add(link);
      out.push({ title, link, date });
    }
  }
  return out;
}

export type NbaWolvesStub = { title: string; link: string; date: string };

/**
 * Returns deduped story stubs (order preserved). Empty if disabled or parse fails.
 * Set `NBA_WOLVES_NEWS=0` to skip. Override page with `NBA_WOLVES_NEWS_URL`.
 */
export async function fetchTimberwolvesNewsFromNbaCom(): Promise<NbaWolvesStub[]> {
  if (process.env.NBA_WOLVES_NEWS?.trim() === '0') return [];

  const url = process.env.NBA_WOLVES_NEWS_URL?.trim() || DEFAULT_PAGE;
  const u = new URL(url);
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return [];

  const ms = fetchTimeoutMs();
  const res = await fetch(u.href, {
    signal: AbortSignal.timeout(ms),
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
    },
  });
  if (!res.ok) {
    throw new Error(`NBA news page HTTP ${res.status}`);
  }

  const html = await res.text();
  const m = html.match(NEXT_DATA_RE);
  if (!m?.[1]) {
    throw new Error('__NEXT_DATA__ block not found (NBA.com layout may have changed)');
  }

  const data = JSON.parse(m[1]) as Record<string, unknown>;
  const props = data.props as Record<string, unknown> | undefined;
  const pageProps = props?.pageProps as Record<string, unknown> | undefined;
  const pageObject = pageProps?.pageObject;

  return extractPostsFromPageObject(pageObject);
}
