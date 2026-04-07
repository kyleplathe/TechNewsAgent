import 'dotenv/config';
import { parseFeedUrl } from './feed';
import {
  buildEpisodeVerificationToken,
  chicagoDateSlug,
} from './web_publish';
import { Resend } from 'resend';
import { LOCAL_INTERSECTION_CENTER, pickLocalBusiness } from './local_businesses';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * One line for your video ticker (paste into FCP / title).
 * Price: CoinGecko. Block height: blockchain.info.
 */
async function getTickerData(): Promise<string> {
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'America/Chicago',
  });
  let btcPrice = '—';
  let blockHeight = '—';
  try {
    const [priceRes, blockRes] = await Promise.all([
      fetch(
        'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd'
      ),
      fetch('https://blockchain.info/q/getblockcount'),
    ]);
    if (priceRes.ok) {
      const priceData = (await priceRes.json()) as {
        bitcoin?: { usd?: number };
      };
      const usd = priceData.bitcoin?.usd;
      if (typeof usd === 'number') {
        btcPrice = new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: 'USD',
          minimumFractionDigits: 0,
          maximumFractionDigits: 2,
        }).format(usd);
      }
    }
    if (blockRes.ok) {
      const text = (await blockRes.text()).trim();
      if (/^\d+$/.test(text)) blockHeight = text;
    }
  } catch {
    /* keep fallbacks */
  }
  return `BTC: ${btcPrice}  |  BLOCK: ${blockHeight}  |  ${today}  |  LIVE FROM LINDEN HILLS`;
}

/** First line of Threads / Reels description (fixed branding + date). */
function formatSocialHeadline(): string {
  const tz = 'America/Chicago';
  const when = new Date().toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: tz,
  });
  return `Tech News Daily with Kyle · ${when}`;
}

const THREADS_CAP = 500;

function buildShortTagsFromUsed(used: Collected[]): string {
  const tags = ['#TechNews', '#TechTok'];
  if (used.some((c) => c.section === 'LOCAL')) tags.push('#Timberwolves');
  if (used.some((c) => c.section === 'SKATE')) tags.push('#Skateboarding');
  return tags.join(' ');
}

function clipTitleForCaption(title: string, max: number): string {
  const u = title.replace(/\s+/g, ' ').trim();
  const head = (u.split(/\s*[|·]\s*/)[0] ?? u).trim();
  return head.length <= max ? head : head.slice(0, max - 1) + '…';
}

function fallbackSocialBodyFromUsed(used: Collected[]): string {
  const parts = used.slice(0, 3).map((c) => clipTitleForCaption(c.title, 52));
  const t = parts.join(' · ');
  return t || 'Fresh tech from the Linden Hills bench.';
}

/** Keeps total length within Threads-style limits (~500 chars). */
function finalizeSocialCaption(
  headline: string,
  body: string,
  tags: string
): string {
  let b = body.trim().replace(/\s+/g, ' ').slice(0, 400);
  if (!b) b = 'Daily roundup from the bench.';
  let s = `${headline}\n\n${b}\n\n${tags}`;
  if (s.length <= THREADS_CAP) return s;
  const overhead = headline.length + tags.length + 4;
  const maxBody = Math.max(40, THREADS_CAP - overhead - 1);
  b = b.slice(0, Math.max(1, maxBody - 1)) + '…';
  s = `${headline}\n\n${b}\n\n${tags}`;
  return s.length <= THREADS_CAP ? s : s.slice(0, THREADS_CAP);
}

type Collected = {
  section: 'TECH' | 'LOCAL' | 'HARDWARE' | 'SKATE';
  feedTitle: string;
  title: string;
  link: string;
  date: string;
};

type AirLogEntry = {
  fingerprint: string;
  title: string;
  section: Collected['section'];
  productKey: string;
  airedAt: string;
};

const M_VIDEO = '<<<VIDEO_PROMPT>>>';
const M_ONAIR = '<<<ON_AIR>>>';
const M_SOURCES = '<<<SOURCES>>>';
const M_SOCIAL = '<<<SOCIAL>>>';

function parseSourceIndices(afterSources: string, maxIndex: number): number[] {
  const numLine = afterSources.split(/\n/)[0] ?? '';
  const indices = numLine
    .split(/[,;\s]+/)
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n >= 1 && n <= maxIndex);
  const seen = new Set<number>();
  return indices.filter((n) =>
    seen.has(n) ? false : (seen.add(n), true)
  );
}

/**
 * Studio layout: VIDEO PROMPT → ON AIR → SOURCES (indices) → SOCIAL (optional body).
 * Backward compatible: if markers missing, whole body before SOURCES = onAir only.
 */
function parseStudioOutput(
  raw: string,
  maxIndex: number
): { videoPrompt: string; onAir: string; indices: number[]; social: string } {
  const srcPos = raw.indexOf(M_SOURCES);
  let body = raw.trim();
  let indices: number[] = [];

  if (srcPos >= 0) {
    body = raw.slice(0, srcPos).trim();
    const after = raw.slice(srcPos + M_SOURCES.length).trim();
    indices = parseSourceIndices(after, maxIndex);
  }

  let social = '';
  const sm = raw.indexOf(M_SOCIAL);
  if (sm >= 0) {
    let tail = raw.slice(sm + M_SOCIAL.length).trim();
    const nextMarker = tail.search(/\n<<</);
    if (nextMarker >= 0) tail = tail.slice(0, nextMarker).trim();
    social = tail
      .split('\n')
      .filter((l) => !l.trim().startsWith('<<<'))
      .join('\n')
      .trim()
      .slice(0, 400);
  }

  const vp = body.indexOf(M_VIDEO);
  const oa = body.indexOf(M_ONAIR);

  if (vp >= 0 && oa > vp) {
    const videoPrompt = body.slice(vp + M_VIDEO.length, oa).trim();
    const onAir = body.slice(oa + M_ONAIR.length).trim();
    return { videoPrompt, onAir, indices, social };
  }
  if (oa >= 0) {
    const onAir = body.slice(oa + M_ONAIR.length).trim();
    return { videoPrompt: '', onAir, indices, social };
  }

  return { videoPrompt: '', onAir: body, indices, social };
}

/** Gemini free tier often returns 429 with "Please retry in Xs" — parse that for backoff. */
function parseGeminiRetrySeconds(message: string): number | null {
  const m = message.match(/retry in ([\d.]+)\s*s/i);
  if (!m) return null;
  return Math.min(120, Math.max(1, parseFloat(m[1])));
}

function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleFingerprint(title: string): string {
  const stop = new Set([
    'the', 'a', 'an', 'and', 'or', 'for', 'to', 'of', 'in', 'on', 'at', 'with',
    'is', 'are', 'from', 'by', 'new', 'latest', 'today', 'update', 'news',
  ]);
  const tokens = normalizeText(title)
    .split(' ')
    .filter((t) => t.length >= 3 && !stop.has(t))
    .slice(0, 8);
  return tokens.join(' ');
}

function productKey(title: string): string {
  const n = normalizeText(title);
  const keys = [
    'airpods max',
    'iphone',
    'macbook',
    'ipad',
    'vision pro',
    'pixel',
    'galaxy',
    'playstation',
    'xbox',
  ];
  const hit = keys.find((k) => n.includes(k));
  return hit ?? titleFingerprint(title).split(' ').slice(0, 2).join(' ');
}

function hasReturnTrigger(title: string): boolean {
  const n = normalizeText(title);
  return [
    'launch', 'ships', 'shipping', 'announces', 'announced', 'release', 'released',
    'available', 'preorder', 'price cut', 'review', 'hands on', 'benchmark',
    'acquire', 'acquired', 'lawsuit', 'settlement', 'earnings',
  ].some((w) => n.includes(w));
}

function parseDateSafe(v: string): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d : null;
}

/**
 * Default freshness (hours). Tech is tight so you are not voicing yesterday’s cycle; override per
 * section with MAX_STORY_AGE_HOURS_TECH, _HARDWARE, _SKATE, _LOCAL in `.env`.
 */
const DEFAULT_MAX_STORY_AGE_HOURS: Record<Collected['section'], number> = {
  LOCAL: 24,
  SKATE: 24,
  TECH: 12,
  HARDWARE: 24,
};

function maxStoryAgeMsForSection(section: Collected['section']): number {
  const envKey = `MAX_STORY_AGE_HOURS_${section}` as const;
  const raw = process.env[envKey];
  if (raw !== undefined && raw.trim() !== '') {
    const n = parseInt(raw, 10);
    if (Number.isFinite(n) && n > 0) {
      return n * 60 * 60 * 1000;
    }
  }
  const hours = DEFAULT_MAX_STORY_AGE_HOURS[section];
  return hours * 60 * 60 * 1000;
}

function allowUndatedFeedItems(): boolean {
  return process.env.ALLOW_UNDATED_FEED_ITEMS?.trim() === '1';
}

function isFreshForSection(item: Collected): boolean {
  const d = parseDateSafe(item.date);
  if (!d) {
    if (allowUndatedFeedItems()) return true;
    return false;
  }
  const ageMs = Date.now() - d.getTime();
  const maxAgeMs = maxStoryAgeMsForSection(item.section);
  return ageMs <= maxAgeMs;
}

/**
 * No altcoin / “crypto industry” beats — Bitcoin-only for digital-asset headlines.
 * `\bcrypto\b` avoids matching “cryptography”. Set BITCOIN_ONLY_CURRENCY_RULE=0 to skip.
 */
const EXPLICIT_NON_BITCOIN_ASSET_RE =
  /\b(ethereum|\beth\b|erc-?\s*20|solana|cardano|polkadot|dogecoin|\bxrp\b|litecoin|\bltc\b|monero|\bxlm\b|avalanche|\bpolygon\b|chainlink|uniswap|cosmos\s+hub|sui\b|aptos|algorand|fantom|near\s+protocol|\bnft\b|nfts|\bdefi\b|web3|stablecoin|stablecoins|memecoin|memecoins|tether|\busdt\b|\busdc\b|\bdai\b|airdrop|\bico\b|binance\s+coin|\bbnb\b|\btron\b|stellar\s+lumens|ripple(?!\s+effect)|proof\s+of\s+stake)\b/i;

const BITCOIN_HEADLINE_SIGNAL_RE =
  /\b(bitcoin|btc)\b|spot\s+bitcoin|bitcoin\s+etf|\bsatoshi\b|\bhalving\b|taproot|lightning\s+network|bit\s+coin/i;

function passesBitcoinOnlyCurrencyRule(title: string): boolean {
  if (process.env.BITCOIN_ONLY_CURRENCY_RULE === '0') return true;
  const t = title;
  if (EXPLICIT_NON_BITCOIN_ASSET_RE.test(t)) return false;
  if (/\bcrypto\b|\bcryptocurrenc(y|ies)\b/i.test(t)) {
    return BITCOIN_HEADLINE_SIGNAL_RE.test(t);
  }
  return true;
}

async function readAirLog(path: string): Promise<AirLogEntry[]> {
  try {
    const raw = await readFile(path, 'utf8');
    const arr = JSON.parse(raw) as AirLogEntry[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

async function writeAirLog(path: string, entries: AirLogEntry[]): Promise<void> {
  await mkdir('.agent-memory', { recursive: true });
  await writeFile(path, JSON.stringify(entries, null, 2), 'utf8');
}

function reorderIndicesByScriptMention(
  indices: number[],
  collected: Collected[],
  onAir: string,
  videoPrompt: string
): number[] {
  const combined = normalizeText(`${onAir}\n${videoPrompt}`);
  const positions = indices.map((idx) => {
    const c = collected[idx - 1];
    if (!c) return { idx, pos: Number.MAX_SAFE_INTEGER };
    const key = titleFingerprint(c.title).split(' ').slice(0, 4).join(' ');
    const pos = key ? combined.indexOf(key) : -1;
    return { idx, pos: pos >= 0 ? pos : Number.MAX_SAFE_INTEGER };
  });
  return positions.sort((a, b) => a.pos - b.pos).map((p) => p.idx);
}

/** Default on; set SCREENSHOT_SOURCES=0 to skip Playwright (faster local runs / no browser install). */
function envScreenshotsEnabled(): boolean {
  const v = process.env.SCREENSHOT_SOURCES?.trim().toLowerCase();
  if (v === undefined || v === '') return true;
  if (['0', 'false', 'no', 'off'].includes(v)) return false;
  return true;
}

async function runNewsAgent() {
  /** Fewer items per feed = tighter scripts (override with FEED_ITEM_LIMIT). */
  const perFeed = Math.min(
    20,
    Math.max(1, parseInt(process.env.FEED_ITEM_LIMIT ?? '4', 10) || 4)
  );

  /**
   * Tech = software, platforms, AI, security (when tech), gaming news, dev ecosystem, repair/maker
   * culture — **not** altcoins (Bitcoin-only rule applies on headlines). Add/remove URLs here.
   */
  const techFeeds = [
    'https://news.ycombinator.com/rss',
    'https://feeds.arstechnica.com/arstechnica/index',
    'https://www.theverge.com/rss/index.xml',
    'https://techcrunch.com/feed/',
    'https://www.polygon.com/rss/index.xml/',
    'https://www.engadget.com/rss.xml',
    'https://www.gamesindustry.biz/feed',
    'https://hackaday.com/blog/feed/',
  ];
  /** Hardware / devices / silicon — fold into the tech block on air when the story earns it. */
  const hardwareFeeds = [
    'https://www.apple.com/newsroom/rss-feed.rss',
    'https://9to5mac.com/feed/',
    'https://www.tomshardware.com/feeds.xml',
  ];
  /** Skateboarding — mostly culture + video premieres; keep it tight. */
  const skateFeeds = [
    // Thrasher RSS (official help page lists feeds; this one is widely referenced)
    'https://www.thrashermagazine.com/?format=feed&type=rss',
    // WordPress defaults (may change; parser will warn if broken)
    'https://www.jenkemmag.com/feed/',
    'https://quartersnacks.com/feed/',
    // Substack feed
    'https://villagepsychic.substack.com/feed',
    // Best-effort (may be blocked/changed)
    'https://theberrics.com/feed',
  ];
  /**
   * Local = Wolves: Canis Hoopus Atom feed (Timberwolves + occasional Lynx; fan perspective).
   * Note: https://www.canishoopus.com/feed is the **community HTML** “The Feed”, not RSS — use /rss below.
   * `current.xml` 301s here; canonical avoids an extra hop.
   */
  const localFeeds = ['https://www.canishoopus.com/rss/index.xml'];

  let collected: Collected[] = [];

  async function pull(
    urls: string[],
    section: 'TECH' | 'LOCAL' | 'HARDWARE' | 'SKATE'
  ): Promise<void> {
    for (const url of urls) {
      try {
        const feed = await parseFeedUrl(url);
        const title = feed.title || url;
        const slice = feed.items.slice(0, perFeed);
        if (!slice.length) {
          console.warn(`No items parsed from feed (${url}) — check format.`);
        } else {
          const head =
            title.length > 52 ? `${title.slice(0, 52)}…` : title;
          console.log(`  ${head} → ${slice.length} stories (cap ${perFeed})`);
        }
        for (const item of slice) {
          if (!item.title) continue;
          collected.push({
            section,
            feedTitle: title,
            title: item.title,
            link: item.link?.trim() || '',
            date: item.date?.trim() || '',
          });
        }
      } catch (e) {
        console.warn(`Feed failed (${url}):`, e);
      }
    }
  }

  console.log('Fetching global, hardware, and local feeds...');
  await pull(techFeeds, 'TECH');
  await pull(hardwareFeeds, 'HARDWARE');
  await pull(skateFeeds, 'SKATE');
  await pull(localFeeds, 'LOCAL');

  try {
    const { fetchTimberwolvesNewsFromNbaCom } = await import('./nba_wolves_news');
    const nbaWolves = await fetchTimberwolvesNewsFromNbaCom();
    const cap = Math.min(20, Math.max(1, perFeed));
    let added = 0;
    for (const item of nbaWolves) {
      if (added >= cap) break;
      collected.push({
        section: 'LOCAL',
        feedTitle: 'NBA.com — Minnesota Timberwolves',
        title: item.title,
        link: item.link,
        date: item.date,
      });
      added++;
    }
    if (added) {
      console.log(
        `  NBA.com Timberwolves (embedded index) → ${added} stor${added === 1 ? 'y' : 'ies'} (cap ${cap})`
      );
    }
  } catch (e) {
    console.warn('NBA.com Timberwolves index fetch failed:', e);
  }

  if (!collected.length) {
    throw new Error('No stories parsed from any feed — check URLs or network.');
  }

  // Freshness gate + same-run de-dupe + cross-day anti-repeat memory.
  collected = collected.filter(isFreshForSection);
  const sameRunSeen = new Set<string>();
  collected = collected.filter((c) => {
    const fp = titleFingerprint(c.title);
    if (!fp || sameRunSeen.has(fp)) return false;
    sameRunSeen.add(fp);
    return true;
  });

  collected = collected.filter((c) => passesBitcoinOnlyCurrencyRule(c.title));

  if (!collected.length) {
    throw new Error(
      'All candidate stories were filtered out by freshness, Bitcoin-only currency rule, undated items (set ALLOW_UNDATED_FEED_ITEMS=1 only if a feed omits dates), or repeat rules. Try MAX_STORY_AGE_HOURS_* , BITCOIN_ONLY_CURRENCY_RULE=0, or STORY_REPEAT_COOLDOWN_DAYS.'
    );
  }

  const cooldownDays = Math.min(
    21,
    Math.max(3, parseInt(process.env.STORY_REPEAT_COOLDOWN_DAYS ?? '7', 10) || 7)
  );
  const cooldownMs = cooldownDays * 24 * 60 * 60 * 1000;
  const airLogPath = '.agent-memory/airlog.json';
  const airLog = await readAirLog(airLogPath);
  const now = Date.now();
  const recentLog = airLog.filter((e) => {
    const d = parseDateSafe(e.airedAt);
    return d ? now - d.getTime() <= 30 * 24 * 60 * 60 * 1000 : false;
  });

  collected = collected.filter((c) => {
    const fp = titleFingerprint(c.title);
    const pk = productKey(c.title);
    const repeats = recentLog.filter((e) => e.fingerprint === fp || (pk && e.productKey === pk));
    const hasCooldownHit = repeats.some((e) => {
      const d = parseDateSafe(e.airedAt);
      return d ? now - d.getTime() < cooldownMs : false;
    });
    if (!hasCooldownHit) return true;
    return hasReturnTrigger(c.title);
  });

  const storyListText = collected
    .map((c, i) => {
      const n = i + 1;
      const url = c.link || '(no URL in feed)';
      return `${n}. [${c.section}] ${c.title}\n   URL: ${url}`;
    })
    .join('\n\n');

  const storyPickRule = `- Pick **3–5** beats from **[TECH]** + **[HARDWARE]** + **[SKATE]** combined (often **3–4** is right for a **single-take ~85–100s** read — aim **~90s**). Lead with strongest **same-day / last-few-hours** news; skate = one quick hitter only if it’s genuinely good today.
- **Coverage mix:** software, AI/ML, hardware & gadgets, gaming (industry + games), dev tools, repair/maker — all fair game from the **[TECH]** + **[HARDWARE]** pool. **Hardware:** only when **[HARDWARE]** is clearly fresh / newsworthy; never force a device beat; don’t repeat the same product on slow news days.`;

  const hasWolves = collected.some((c) => c.section === 'LOCAL');

  const pickedBiz = pickLocalBusiness();
  const localBizName =
    process.env.LOCAL_BIZ_NAME?.trim() || pickedBiz.name;
  const localBizPitch =
    process.env.LOCAL_BIZ_PITCH?.trim() ||
    `${pickedBiz.description} (${pickedBiz.category}).`;
  const localBizNote = process.env.LOCAL_BIZ_NOTE?.trim() || '';

  const localColorBlock = `
**LINDEN HILLS / NEIGHBORHOOD + LOCAL BUSINESS (before the fixed END lines — NOT optional):**
- **1–2 short lines** of local color near **${LOCAL_INTERSECTION_CENTER}** (Lake Harriet, morning-on-the-block tone, etc.).
- **Non-negotiable:** The spoken name **${localBizName}** must appear **exactly once** in **COLUMN B (ON AIR)**, in this close segment **before** “BACK TO THE SOLDERING IRON…” — plain conversational passing — ${localBizPitch} (coffee run, walked by, neighbors, whatever fits). **Do not** use **shoutout**, **shout-out**, **plug**, or hard-sell / “GO CHECK THEM OUT.”
- If you omit **${localBizName}** from ON AIR, the script is **wrong**.${localBizNote ? `\n- Extra note: ${localBizNote}` : ''}`;

  const segmentOrderBlock = hasWolves
    ? `**SEGMENT ORDER (same in both columns — do not reorder):**
1) **TECH block** — all tech and (when worthy) device beats; pull from **[TECH]** and **[HARDWARE]** as needed. **No** separate mandatory “hardware segment” — fold devices into the tech run when they earn it.
2) **THEN SKATE** — one quick skateboarding beat (from **[SKATE]** only) if there’s a legit premiere / real news; otherwise skip skate and keep it tight.
3) **THEN WOLVES** (Timberwolves — from **[LOCAL]** items: Canis Hoopus RSS plus official **NBA.com** Timberwolves news index; only if the item passes the freshness filter).
4) **CLOSE** — **Linden Hills / neighborhood beat** (see block below), then soldering / deck; end with the required sign-off.`
    : `**SEGMENT ORDER (same in both columns — do not reorder):**
1) **TECH block** — all tech and (when worthy) device beats; pull from **[TECH]** and **[HARDWARE]** as needed. **No** separate mandatory “hardware segment” — fold devices into the tech run when they earn it.
2) **THEN SKATE** — one quick skateboarding beat (from **[SKATE]** only) if there’s a legit premiere / real news; otherwise skip skate and keep it tight.
3) **CLOSE** — **Linden Hills / neighborhood beat** (see block below), then soldering / deck; end with the required sign-off.`;

  const beatOrderPhrase = hasWolves
    ? 'tech → skate → Wolves → close'
    : 'tech → skate → close';

  const parityStories =
    'Pick your covered stories once (**usually 3–4**). **Every** ON_AIR beat needs a **matching** VIDEO_PROMPT **STORY** block (same order)';

  const prompt = `
You are a **direct, plain-spoken** tech reporter at your repair bench in Linden Hills (Minneapolis) — calm morning desk, not hype. You’re **big on Apple** when it fits, but you’re a **general tech nerd** — phones, silicon, laptops, the whole bench.

NUMBERED STORIES FOR TODAY — **each line is numbered 1, 2, 3…** Those numbers are what you use in **<<<SOURCES>>>** and when you label **SCREENSHOT** lines in the VIDEO PROMPT (same number = same story = same email JPEG / slide):
${storyListText}

QUALITY RULES:
${storyPickRule}
- **Recency (critical):** The list is **pre-filtered** for freshness (tech ~**12h**, hardware/skate/local ~**24h** by default). Treat everything as **today’s desk** — not “yesterday” or “overnight” unless the item’s date is clearly **today** in US **Central**. Skip stale vibes, republished “classics,” and year-stamped reruns unless the headline proves it’s **new today**. If a headline includes “(2024)” or an old year, it is usually **not** breaking — either skip or frame as “making the rounds again,” not fresh news.
- Do not invent products, prices, or dates. Stay close to the headlines.
- **Digital money / chains:** The show is **Bitcoin-only**. Do **not** cover altcoins, stablecoins, NFT/DeFi/Web3 industry, or generic **“crypto”** as an asset class. **Do** cover **Bitcoin** when a sourced headline is clearly about Bitcoin (ETFs, adoption, mining, Lightning, regulation aimed at Bitcoin, etc.). On air, avoid saying **“crypto”** as a bucket — say **Bitcoin** or neutral tech wording.
- **No celebrity gossip, city politics, or general government news** unless the headline is clearly **tech-related** (e.g. regulation of chips, AI, broadband).
- **Wolves / LOCAL** — **Canis Hoopus (RSS)** plus **NBA.com Timberwolves** index (same **[LOCAL]** list). Use the basketball beat **only** when the item is **fresh**; if nothing qualifies, **skip Wolves** entirely.
- Skateboarding: use **[SKATE]** for one quick, legit beat (premiere, contest, real news). Skip if nothing’s good.
- **One vertical take, ~85–100 seconds** read aloud (target **~90s**) — **tight but not thin**: add **one concrete detail** on main beats when the headline gives you something real (a number, vendor, mechanism, “what they found”) — **no** filler, **no** essay transitions (“building on that,” “wrapping up,” “let’s unpack,” **“let’s dive in,”** **“deep dive,”** **“we’ll unpack”**). **Visuals:** screenshot stills only; never promise a full preview or live site scroll; say “on the screenshot” / “in the grab” if needed.
- **Banned hype / podcast clichés (ON AIR and social — never say or echo):** “hold on to your hat(s),” “buckle up,” “deep dive,” “let’s dive in,” “fire hose,” “grab your popcorn,” “you won’t believe,” “crazy,” “insane” (unless the headline literally uses it), or **any** “fasten your seatbelts” style padding. Sound like a colleague at the bench, not a trailer voice.
- **Local business (every episode):** The ON AIR close **must** name **${localBizName}** once (see **LINDEN HILLS** block). That line is **not** filler — **include it** even on tight ~90s reads.

You are writing for a **small professional studio**: one column is the **video / post prompt** (for Final Cut), the other is **on-air copy** (teleprompter / VO only).

${segmentOrderBlock}
${localColorBlock}

**LOCKSTEP + COLUMN A — VIDEO PROMPT (plain text for editors — not read on camera, no Markdown):**
- **No Markdown or markup:** Do **not** use \`#\`, \`##\`, \`**bold**\`, bullet lists with \`-\` / \`*\`, or code fences. Use **plain text** only (easy to copy into email, Notion, etc.).
- **Visuals:** You use **only** the **source screenshots** attached to the email (one JPEG per covered story). By default they are **full mobile viewport grabs** (phone-shaped frame: site chrome + headline + fold of the article — same idea as a normal screen recording still; ~393×852 CSS px unless overridden). **Do not** call for stock footage, extra B-roll, additional stills you didn’t list, or “add clips.” Every visual is a **site grab** tied to a **story number** from the list above.
- ${parityStories}. Same order as on air (${beatOrderPhrase}); nothing extra in either column.
- **Structure (plain text):**
  - **Line 1:** Short **show title** (plain, no symbols).
  - **Each news story:** A line containing only the word **STORY** (all caps). Next line: **story headline** (one line, matches the beat). Next lines: a line starting with **SCREENSHOT:** (which story number + slide order), then optional lines starting with **NOTE:** (hold, cut, on-still text — timeline only; no extra media). Blank line between stories is OK.
  - **After the last news story:** A line containing only **CLOSE**. Then **NOTE:** lines only for Linden Hills / **${localBizName}** on-camera reminder + stay-on-still / fade (see LINDEN HILLS block). No SCREENSHOT in CLOSE.
- **Forbidden in this column:** **B-ROLL**, **STOCK**, **CAM** (extra camera clips), “film B-roll,” “lower third pack,” “insert clip,” or any wording that implies files beyond the **attached screenshots** (text you type in the timeline is OK).

---

**COLUMN B — ON AIR (teleprompter / voiceover — spoken words only):**
- **ALL CAPS.** Each story is **2–4 short lines** max: headline essence + **why it matters** + **one concrete detail** when the source headline supports it (stat, layer, product name — **skip** the detail if it forces wordiness). No long paragraphs, no recap of the whole web.
- **Single continuous take** — write so it flows straight through after the open; no “first story / next up / finally” padding; **no** “hold on to your hats,” **no** “deep dive,” **no** “buckle up” or similar.
- **Do not** put [B-ROLL] or shot notes here — VIDEO PROMPT only.
- START exactly: LIVE FROM THE BENCH IN LINDEN HILLS, I'M KYLE. WE'VE GOT A LOT HITTING THE SHOP TODAY.
- **Enunciation (INLINE):** phonetic in parentheses **on first mention only** next to the word — short; stress in ALL CAPS. Examples: OPENAI (oh-PEN-eye). Real acronyms spelled: A I, G P U.
- **Close:** After your last **news** beat, **before** the two fixed END lines: one or two **ALL CAPS** lines mixing **Linden Hills** color with **${localBizName}** spoken **once** by name (required — see LINDEN HILLS block). Never **shoutout**, **shout-out**, **plug**, or hard-sell.
- END exactly (literal, final two sentences of ON AIR): BACK TO THE SOLDERING IRON. CATCH YOU TOMORROW.

---

**OUTPUT FORMAT (exactly four blocks, in this order — use these marker lines literally):**

<<<VIDEO_PROMPT>>>
(Plain text: show title on line 1; then **STORY** / headline / **SCREENSHOT:** / **NOTE:** per news story; then **CLOSE** + **NOTE:** only. No Markdown. Match ON_AIR order, ${beatOrderPhrase}.)

<<<ON_AIR>>>
(ALL CAPS — one take, **~85–100s** (~**90s**); same story order as VIDEO_PROMPT; **must** include **${localBizName}** once in the close before **BACK TO THE SOLDERING IRON**.)

<<<SOURCES>>>
(Exactly **one line**: comma-separated **1-based story numbers** from **NUMBERED STORIES FOR TODAY** at the top — e.g. \`2,5,7\` = story **2**, then **5**, then **7**. **Order = slide order** = order of JPEGs in the email: first number = first slide / first grab.)

<<<SOCIAL>>>
(**Body text only** — do **not** repeat the “Tech News Daily with Kyle · date” line; the system adds that. Max **~280 characters**, 1–2 tight sentences echoing **specific topics** you actually covered — product names, Wolves, skate, bench vibe — not generic filler. No “link in bio,” no explaining screenshots. Threads-length.)
`;

  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) {
    throw new Error('Set GEMINI_API_KEY (Google AI Studio → Get API key)');
  }

  const model = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash-lite';
  const genUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(geminiKey)}`;

  const body = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { maxOutputTokens: 4096 },
  });

  type GeminiResponse = {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    error?: { message?: string };
  };

  console.log('Generating script with Gemini...');

  const geminiTimeoutMs = Math.min(
    180_000,
    Math.max(
      30_000,
      parseInt(process.env.GEMINI_FETCH_TIMEOUT_MS ?? '120000', 10) || 120_000
    )
  );

  const maxGeminiAttempts = Math.min(
    10,
    Math.max(1, parseInt(process.env.GEMINI_MAX_RETRIES ?? '6', 10) || 6)
  );

  let rawOut = '';
  let lastErr = '';

  for (let attempt = 1; attempt <= maxGeminiAttempts; attempt++) {
    const aiResponse = await fetch(genUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      signal: AbortSignal.timeout(geminiTimeoutMs),
    });

    const data = (await aiResponse.json()) as GeminiResponse;

    if (aiResponse.status === 429 && attempt < maxGeminiAttempts) {
      const msg = data.error?.message ?? '';
      lastErr = msg;
      const waitSec =
        parseGeminiRetrySeconds(msg) ?? Math.min(15 * attempt, 90);
      console.warn(
        `Gemini 429 (rate limit / quota window). Waiting ${Math.ceil(waitSec)}s — retry ${attempt + 1}/${maxGeminiAttempts}…`
      );
      await new Promise((r) =>
        setTimeout(r, Math.ceil(waitSec * 1000))
      );
      continue;
    }

    if (!aiResponse.ok) {
      throw new Error(
        `Gemini API ${aiResponse.status}: ${data.error?.message ?? JSON.stringify(data)}`
      );
    }

    const parts = data.candidates?.[0]?.content?.parts;
    rawOut = parts?.map((p) => p.text).filter(Boolean).join('') ?? '';
    if (!rawOut) {
      throw new Error(`Gemini returned no text: ${JSON.stringify(data)}`);
    }
    break;
  }

  if (!rawOut) {
    throw new Error(
      `Gemini: exhausted ${maxGeminiAttempts} attempts (429). Last error: ${lastErr || 'unknown'}`
    );
  }

  const { videoPrompt, onAir: finalScript, indices, social: modelSocial } =
    parseStudioOutput(rawOut, collected.length);

  const fixedOnAir = finalScript.trim();
  const orderedIndices = reorderIndicesByScriptMention(
    indices,
    collected,
    fixedOnAir,
    videoPrompt
  );

  const used = orderedIndices
    .map((i) => collected[i - 1])
    .filter(Boolean)
    .filter((c) => c.link);

  const socialHeadline = formatSocialHeadline();
  let socialBody = modelSocial.trim();
  if (!socialBody) socialBody = fallbackSocialBodyFromUsed(used);
  const shortTags = buildShortTagsFromUsed(used);
  const socialCaption = finalizeSocialCaption(
    socialHeadline,
    socialBody,
    shortTags
  );

  if (!videoPrompt.trim()) {
    console.warn(
      'No <<<VIDEO_PROMPT>>> block parsed — check model output for studio format.'
    );
  }
  if (!orderedIndices.length) {
    console.warn(
      'No <<<SOURCES>>> line parsed — email will omit screenshot links (check model output).'
    );
  } else {
    console.log('Sources used for segment (screenshots):', orderedIndices.join(', '));
  }

  /** Plain text: [SECTION] Title then URL on next line (matches FCP / screenshot workflow). */
  const linksText = used
    .map((c) => `[${c.section}] ${c.title}\n${c.link}`)
    .join('\n\n');

  const linksHtml =
    used.length > 0
      ? used
          .map(
            (c) =>
              `<p style="margin:0 0 0.15em;font-size:14px;line-height:1.4">[${escapeHtml(c.section)}] ${escapeHtml(c.title)}</p>` +
              `<p style="margin:0 0 1.1em;font-size:13px;word-break:break-all"><a href="${escapeHtml(c.link)}">${escapeHtml(c.link)}</a></p>`
          )
          .join('')
      : `<p style="color:#888;font-size:13px">No parsed source list — model did not return <<<SOURCES>>> lines, or no URLs in those items.</p>`;

  const screenshotItems = orderedIndices
    .map((storyIdx) => {
      const c = collected[storyIdx - 1];
      if (!c) return null;
      const link = c.link?.trim();
      if (!link) return null;
      return {
        storyIndex: storyIdx,
        section: c.section,
        title: c.title,
        link,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  let attachments:
    | Array<{ filename: string; content: Buffer; contentType?: string }>
    | undefined;
  let screenshotBannerText = '';
  let screenshotBannerHtml = '';
  let screenshotKept: Array<{
    storyIndex: number;
    filename: string;
    content: Buffer;
    link: string;
  }> = [];

  if (envScreenshotsEnabled() && screenshotItems.length) {
    const max = Math.min(
      12,
      Math.max(1, parseInt(process.env.SCREENSHOT_MAX ?? '12', 10) || 12)
    );
    const slice = screenshotItems.slice(0, max);
    console.log(
      `Capturing ${slice.length} source screenshot(s) (Playwright / Chromium)…`
    );
    const { screenshotSources } = await import('./screenshot_sources');
    const { ok: shots, failures: shotFails } = await screenshotSources(slice);

    const maxBytes = Math.min(
      38 * 1024 * 1024,
      Math.max(
        5 * 1024 * 1024,
        parseInt(process.env.SCREENSHOT_MAX_TOTAL_BYTES ?? '34000000', 10) ||
          34_000_000
      )
    );
    let total = 0;
    screenshotKept = [];
    for (const s of shots) {
      if (total + s.content.length > maxBytes) {
        console.warn(
          `Screenshot size budget reached — omitting further attachments (${s.filename}).`
        );
        break;
      }
      total += s.content.length;
      screenshotKept.push(s);
    }

    if (screenshotKept.length) {
      attachments = screenshotKept.map((s) => ({
        filename: s.filename,
        content: s.content,
        contentType: 'image/jpeg',
      }));
      const names = screenshotKept.map((s) => s.filename).join(', ');
      screenshotBannerText = `\nSOURCE SCREENSHOTS — ${screenshotKept.length} JPEG: ${names}\nDefault: **viewport** = full mobile frame (~393×852 CSS px at DPR 1 unless SCREENSHOT_WIDTH/HEIGHT set). Use SCREENSHOT_MODE=content for article-only crop. Order matches <<<SOURCES>>>. See AGENTS.md.\n`;
      screenshotBannerHtml =
        `<p style="font-size:12px;font-weight:700;color:#444;margin:1.25em 0 0.35em">Source screenshots</p>` +
        `<p style="font-size:13px;line-height:1.45;margin:0 0 1em;color:#333">${escapeHtml(
          `${screenshotKept.length} JPEG(s) — ${names}. Default full mobile viewport (phone-shaped grab); order matches SOURCES. Paywalls/bots may yield partial pages.`
        )}</p>`;
    }
    if (shotFails.length) {
      const failLines = shotFails
        .map((f) => `#${f.storyIndex} ${f.link} — ${f.error}`)
        .join('\n');
      console.warn('Screenshot failures:\n' + failLines);
      screenshotBannerText +=
        '\nScreenshot failures / skips:\n' + failLines + '\n';
      screenshotBannerHtml +=
        `<p style="font-size:12px;font-weight:700;color:#666;margin:0 0 0.35em">Screenshot failures</p>` +
        `<pre style="white-space:pre-wrap;font-size:11px;line-height:1.4;margin:0 0 1em;padding:10px;background:#fff8f5;border-radius:6px;border:1px solid #eee">${escapeHtml(failLines)}</pre>`;
    }
  } else if (!envScreenshotsEnabled()) {
    console.log('SCREENSHOT_SOURCES disabled — skipping Playwright.');
  }

  const resendKey = process.env.RESEND_API_KEY;
  const toRaw = process.env.RESEND_TO?.trim();
  const from =
    process.env.RESEND_FROM?.trim() || 'Daily Script <agent@instakyle.tech>';

  if (!resendKey) {
    throw new Error('Set RESEND_API_KEY');
  }
  if (!toRaw) {
    throw new Error('Set RESEND_TO to your inbox (comma-separated ok).');
  }

  const to = toRaw.split(',').map((a) => a.trim()).filter(Boolean);
  const resend = new Resend(resendKey);

  const tickerLine = await getTickerData();

  const linksHeader =
    used.length > 0
      ? 'SOURCE LINKS (for this segment — screenshots / posts)'
      : 'SOURCE LINKS (none parsed — see log)';

  const videoHeader = 'VIDEO PROMPT — plain text (edit / Final Cut / post)';
  const onAirHeader = 'ON AIR (teleprompter / VO)';
  const socialHeader =
    'SOCIAL — Tech News Daily with Kyle (video caption / description)';
  const ytVerifyHeader =
    'YOUTUBE — paste this exact line in the video description (proves which episode this Short is for)';
  const ytVerifyLine = buildEpisodeVerificationToken(chicagoDateSlug());

  const tickerHtml =
    `<div style="margin:0 0 1.25em;padding:14px 16px;background:#f4f4f5;border-radius:8px;border:1px solid #e4e4e7">` +
    `<pre style="margin:0;white-space:pre-wrap;word-break:break-word;font-family:Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.45;color:#18181b;user-select:all;-webkit-user-select:all">${escapeHtml(tickerLine)}</pre>` +
    `</div>`;

  const socialCaptionHtml =
    `<div style="margin:0 0 1.25em;padding:14px 16px;background:#f4f4f5;border-radius:8px;border:1px solid #e4e4e7">` +
    `<pre style="margin:0;white-space:pre-wrap;word-break:break-word;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:14px;line-height:1.45;color:#18181b;user-select:all;-webkit-user-select:all">${escapeHtml(socialCaption)}</pre>` +
    `</div>`;

  const emailText = [
    tickerLine,
    '',
    videoHeader,
    videoPrompt.trim() || '(none — check model output)',
    '',
    onAirHeader,
    fixedOnAir.trim(),
    '',
    socialHeader,
    socialCaption,
    '',
    ytVerifyHeader,
    ytVerifyLine,
    '',
    linksHeader,
    '',
    linksText || '(none)',
    screenshotBannerText.trimEnd(),
  ]
    .filter((block) => block.length > 0)
    .join('\n');

  const emailHtml =
    `<div style="font-family:system-ui,sans-serif;max-width:760px;color:#111">` +
    tickerHtml +
    `<p style="font-size:12px;font-weight:700;letter-spacing:0.04em;color:#444;margin:0 0 0.5em">${escapeHtml(videoHeader)}</p>` +
    `<pre style="white-space:pre-wrap;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;line-height:1.45;margin:0 0 1.5em;padding:12px;background:#f6f7f8;border-radius:8px;border:1px solid #e8e8e8">${escapeHtml(videoPrompt.trim() || '(none)')}</pre>` +
    `<p style="font-size:12px;font-weight:700;letter-spacing:0.04em;color:#444;margin:0 0 0.5em">${escapeHtml(onAirHeader)}</p>` +
    `<pre style="white-space:pre-wrap;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;line-height:1.5;margin:0 0 1.5em;padding:12px;background:#fff;border-radius:8px;border:1px solid #ddd">${escapeHtml(fixedOnAir.trim())}</pre>` +
    `<p style="font-size:12px;font-weight:700;letter-spacing:0.04em;color:#444;margin:0 0 0.5em">${escapeHtml(socialHeader)}</p>` +
    socialCaptionHtml +
    `<p style="font-size:12px;font-weight:700;letter-spacing:0.04em;color:#444;margin:0 0 0.5em">${escapeHtml(ytVerifyHeader)}</p>` +
    `<pre style="white-space:pre-wrap;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;line-height:1.5;margin:0 0 1.25em;padding:12px;background:#fefce8;border-radius:8px;border:1px solid #eab308;user-select:all;-webkit-user-select:all">${escapeHtml(ytVerifyLine)}</pre>` +
    `<p style="font-size:12px;font-weight:700;color:#444;margin:0 0 0.5em">${escapeHtml(linksHeader)}</p>` +
    `<div style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;line-height:1.45">${linksHtml}</div>` +
    screenshotBannerHtml +
    `</div>`;

  const { data: sendData, error: sendErr } = await resend.emails.send({
    from,
    to,
    subject: `📺 Your News Script for ${new Date().toLocaleDateString('en-US', { timeZone: 'America/Chicago' })}${attachments?.length ? ' 📎' : ''}`,
    text: emailText,
    html: emailHtml,
    ...(attachments?.length ? { attachments } : {}),
  });

  if (sendErr) {
    throw new Error(`Resend: ${sendErr.message} (${sendErr.name})`);
  }

  const webDir = process.env.TECHNEWS_WEB_DIR?.trim();
  const instakyleNewsDir = process.env.TECHNEWS_INSTAKYLE_NEWS_DIR?.trim();
  const techNewsVideoUrl = process.env.TECHNEWS_VIDEO_URL?.trim() || null;
  if ((webDir || instakyleNewsDir) && used.length) {
    const { writeTechNewsWebBundle } = await import('./web_publish');
    const webStories = used.map((c, j) => {
      const storyIndex = orderedIndices[j]!;
      const shot = screenshotKept.find((k) => k.storyIndex === storyIndex);
      return {
        storyIndex,
        section: c.section,
        title: c.title,
        link: c.link,
        imageFilename: shot?.filename,
        imageBuffer: shot?.content,
      };
    });
    await writeTechNewsWebBundle({
      ...(webDir ? { outDir: webDir } : {}),
      ...(instakyleNewsDir ? { instakyleNewsDir } : {}),
      tickerLine,
      socialCaption,
      videoPrompt: videoPrompt.trim(),
      onAirPlain: fixedOnAir.trim(),
      stories: webStories,
      videoUrl: techNewsVideoUrl,
      publicBaseUrl: process.env.TECHNEWS_PUBLIC_BASE_URL?.trim() || undefined,
      siteOrigin: process.env.TECHNEWS_SITE_ORIGIN?.trim() || undefined,
      includeHtmlShell:
        process.env.TECHNEWS_WEB_HTML?.trim().toLowerCase() !== '0',
    });
  }

  if (orderedIndices.length) {
    const newEntries: AirLogEntry[] = orderedIndices
      .map((idx) => collected[idx - 1])
      .filter(Boolean)
      .map((c) => ({
        fingerprint: titleFingerprint(c.title),
        title: c.title,
        section: c.section,
        productKey: productKey(c.title),
        airedAt: new Date().toISOString(),
      }));
    const merged = [...recentLog, ...newEntries].slice(-400);
    await writeAirLog(airLogPath, merged);
  }

  console.log('Mission accomplished. Resend id:', sendData?.id);
  if (attachments?.length) {
    console.log(`Attached ${attachments.length} source screenshot(s).`);
  }
  if (videoPrompt.trim()) {
    console.log('\n--- VIDEO PROMPT ---\n' + videoPrompt.trim());
  }
  if (linksText) {
    console.log('\n--- Segment links ---\n' + linksText);
  }
}

runNewsAgent().catch((err) => {
  console.error(err);
  process.exit(1);
});
