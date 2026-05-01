import { XMLParser } from 'fast-xml-parser';

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: true,
});

function asString(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return decodeHtmlEntities(v).trim();
  if (typeof v === 'object' && v !== null && '#text' in v) {
    return decodeHtmlEntities(String((v as { '#text': string })['#text'])).trim();
  }
  return decodeHtmlEntities(String(v)).trim();
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

function decodeHtmlEntities(input: string): string {
  if (!input || !input.includes('&')) return input;
  const named: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    rsquo: "'",
    lsquo: "'",
    rdquo: '"',
    ldquo: '"',
    ndash: '-',
    mdash: '-',
    hellip: '...',
  };
  return input.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/gi, (full, token: string) => {
    const t = token.toLowerCase();
    if (t.startsWith('#x')) {
      const cp = parseInt(t.slice(2), 16);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : full;
    }
    if (t.startsWith('#')) {
      const cp = parseInt(t.slice(1), 10);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : full;
    }
    return named[t] ?? full;
  });
}

export type ParsedFeed = {
  title: string;
  items: { title: string; link: string; date: string }[];
};

function feedFetchTimeoutMs(): number {
  const n = parseInt(process.env.FEED_FETCH_TIMEOUT_MS ?? '25000', 10);
  return Number.isFinite(n) && n >= 3000 ? Math.min(n, 120_000) : 25_000;
}

/**
 * Cloudflare-protected hosts (notably Substack) often return **403** to datacenter IPs when the
 * request looks like an unnamed bot. Use mainstream browser signals; override with **FEED_USER_AGENT**.
 */
function feedFetchHeaders(feedUrl: string): HeadersInit {
  const customUa = process.env.FEED_USER_AGENT?.trim();
  const ua =
    customUa ||
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
  const u = new URL(feedUrl);
  const headers: Record<string, string> = {
    'User-Agent': ua,
    Accept:
      'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
  };
  // Substack / Cloudflare: CI IPs often get **403** on bare `/feed`; browser-like hints help some stacks.
  if (u.hostname === 'substack.com' || u.hostname.endsWith('.substack.com')) {
    headers.Referer = `${u.origin}/`;
    headers['Sec-CH-UA'] =
      '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"';
    headers['Sec-CH-UA-Mobile'] = '?0';
    headers['Sec-CH-UA-Platform'] = '"macOS"';
    headers['Sec-Fetch-Dest'] = 'document';
    headers['Sec-Fetch-Mode'] = 'navigate';
    headers['Sec-Fetch-Site'] = 'cross-site';
    headers['Sec-Fetch-User'] = '?1';
    headers['Upgrade-Insecure-Requests'] = '1';
  }
  return headers;
}

/** Fetch and parse RSS 2.0 or Atom using WHATWG URL + fetch (no legacy url.parse). */
export async function parseFeedUrl(feedUrl: string): Promise<ParsedFeed> {
  const u = new URL(feedUrl);
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error(`Invalid feed URL: ${feedUrl}`);
  }

  const ms = feedFetchTimeoutMs();

  async function tryFetch(href: string): Promise<Response> {
    return fetch(href, {
      signal: AbortSignal.timeout(ms),
      headers: feedFetchHeaders(href),
    });
  }

  let res = await tryFetch(u.href);
  // Substack sometimes serves `/feed` as 403 from datacenter IPs while `/feed.xml` works (or vice versa).
  const isSubstack =
    u.hostname === 'substack.com' || u.hostname.endsWith('.substack.com');
  if (!res.ok && res.status === 403 && isSubstack) {
    const origin = u.origin;
    const path = u.pathname.replace(/\/+$/, '') || '';
    const alts: string[] = [];
    if (/\/feed$/i.test(path)) {
      alts.push(`${origin}/feed.xml`, `${origin}/rss.xml`);
    } else if (/\/feed\.xml$/i.test(path)) {
      alts.push(`${origin}/feed`, `${origin}/rss.xml`);
    } else if (path === '' || path === '/') {
      alts.push(`${origin}/feed.xml`, `${origin}/feed`);
    }
    for (const alt of alts) {
      if (alt === u.href) continue;
      const r2 = await tryFetch(alt);
      if (r2.ok) {
        res = r2;
        break;
      }
    }
  }

  if (!res.ok) {
    const finalHref =
      typeof res.url === 'string' && res.url.length > 0 ? res.url : u.href;
    throw new Error(`Feed HTTP ${res.status}: ${finalHref}`);
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
