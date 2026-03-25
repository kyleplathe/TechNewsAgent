import { XMLParser } from 'fast-xml-parser';

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: true,
});

function asString(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'object' && v !== null && '#text' in v) {
    return String((v as { '#text': string })['#text']).trim();
  }
  return String(v).trim();
}

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function atomLinkHref(link: unknown): string {
  if (typeof link === 'string') return link.trim();
  for (const l of asArray(link as object | object[])) {
    if (l && typeof l === 'object' && '@_href' in l) {
      return String((l as { '@_href': string })['@_href']).trim();
    }
  }
  return '';
}

export type ParsedFeed = {
  title: string;
  items: { title: string; link: string; date: string }[];
};

function feedFetchTimeoutMs(): number {
  const n = parseInt(process.env.FEED_FETCH_TIMEOUT_MS ?? '25000', 10);
  return Number.isFinite(n) && n >= 3000 ? Math.min(n, 120_000) : 25_000;
}

/** Fetch and parse RSS 2.0 or Atom using WHATWG URL + fetch (no legacy url.parse). */
export async function parseFeedUrl(feedUrl: string): Promise<ParsedFeed> {
  const u = new URL(feedUrl);
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error(`Invalid feed URL: ${feedUrl}`);
  }

  const ms = feedFetchTimeoutMs();
  const res = await fetch(u.href, {
    signal: AbortSignal.timeout(ms),
    headers: {
      'User-Agent': 'TechNewsAgent/1.0 (+https://github.com/)',
      Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
    },
  });
  if (!res.ok) {
    throw new Error(`Feed HTTP ${res.status}: ${u.href}`);
  }

  const text = await res.text();
  const parsed = xml.parse(text) as Record<string, unknown>;

  if (parsed.rss && typeof parsed.rss === 'object') {
    const channel = (parsed.rss as { channel?: Record<string, unknown> }).channel;
    if (!channel) return { title: '', items: [] };
    const title = asString(channel.title);
    const items = asArray(channel.item as object | object[]).map((raw) => {
      const it = raw as Record<string, unknown>;
      const date =
        asString(it.pubDate) ||
        asString(it.published) ||
        asString(it['dc:date']);
      return { title: asString(it.title), link: asString(it.link), date };
    });
    return { title, items };
  }

  if (parsed.feed && typeof parsed.feed === 'object') {
    const feed = parsed.feed as Record<string, unknown>;
    const title = asString(feed.title);
    const items = asArray(feed.entry as object | object[]).map((raw) => {
      const e = raw as Record<string, unknown>;
      const date = asString(e.updated) || asString(e.published);
      return { title: asString(e.title), link: atomLinkHref(e.link), date };
    });
    return { title, items };
  }

  return { title: '', items: [] };
}
