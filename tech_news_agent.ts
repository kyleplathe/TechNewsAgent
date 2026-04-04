import 'dotenv/config';
import { parseFeedUrl } from './feed';
import { Resend } from 'resend';
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

/** Stable hash for the same calendar day (Chicago) so caption rotates daily, not every run. */
function hashDayKey(dayKey: string): number {
  let h = 0;
  for (let i = 0; i < dayKey.length; i++) {
    h = (h * 31 + dayKey.charCodeAt(i)) >>> 0;
  }
  return h;
}

/** Caption / description block for Reels, Shorts, TikTok, X, Threads, etc. — picks a variant by day. */
function buildSocialMediaCaption(): string {
  const tz = 'America/Chicago';
  const when = new Date().toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: tz,
  });
  const dayKey = new Date().toLocaleDateString('en-CA', { timeZone: tz });
  const v = hashDayKey(dayKey);

  const tagSets = [
    '#TechNews #TechNewsDaily #Technology #TechTok #DailyTechNews',
    '#TechNews #Minneapolis #LindenHills #TechTok #DailyTechNews',
    '#TechNewsDaily #Technology #Apple #TechTok #News',
  ];
  const tags = tagSets[v % tagSets.length];

  /** Every post leads with this line (Threads / Reels / etc.). */
  const headline = `Tech News Daily with Kyle · ${when}`;

  const hooks = [
    `Quick bench rundown — what moved in tech, minus the doom-scroll. New drop every day.`,
    `From the Linden Hills bench: your fast tech hit list. Follow for the next one.`,
    `Stories that matter, straight talk, no filler.`,
    `Tech news you can use before the day gets away from you.`,
    `Short, sharp, daily. Tap follow so you don’t miss tomorrow’s rundown.`,
    `One take from the shop, real context.`,
  ];
  return `${headline}\n\n${hooks[v % hooks.length]}\n\n${tags}`;
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
 * Studio layout: VIDEO PROMPT (edit) → ON AIR (VO) → SOURCES (indices).
 * Backward compatible: if markers missing, whole body before SOURCES = onAir only.
 */
function parseStudioOutput(
  raw: string,
  maxIndex: number
): { videoPrompt: string; onAir: string; indices: number[] } {
  const srcPos = raw.indexOf(M_SOURCES);
  let body = raw.trim();
  let indices: number[] = [];

  if (srcPos >= 0) {
    body = raw.slice(0, srcPos).trim();
    const after = raw.slice(srcPos + M_SOURCES.length).trim();
    indices = parseSourceIndices(after, maxIndex);
  }

  const vp = body.indexOf(M_VIDEO);
  const oa = body.indexOf(M_ONAIR);

  if (vp >= 0 && oa > vp) {
    const videoPrompt = body.slice(vp + M_VIDEO.length, oa).trim();
    const onAir = body.slice(oa + M_ONAIR.length).trim();
    return { videoPrompt, onAir, indices };
  }
  if (oa >= 0) {
    const onAir = body.slice(oa + M_ONAIR.length).trim();
    return { videoPrompt: '', onAir, indices };
  }

  return { videoPrompt: '', onAir: body, indices };
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

/** Default windows; tighten with MAX_STORY_AGE_HOURS_TECH=12 (etc.) in `.env`. */
const DEFAULT_MAX_STORY_AGE_HOURS: Record<Collected['section'], number> = {
  LOCAL: 24,
  SKATE: 48,
  TECH: 48,
  HARDWARE: 72,
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

function isFreshForSection(item: Collected): boolean {
  const d = parseDateSafe(item.date);
  if (!d && item.section === 'LOCAL') {
    // For Wolves, require a parseable date so stale undated items do not slip through.
    return false;
  }
  if (!d) return true;
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

  /** Curated set — fewer feeds tends to match the “early scripts” quality. Add/remove URLs here. */
  const techFeeds = [
    'https://news.ycombinator.com/rss',
    'https://feeds.arstechnica.com/arstechnica/index',
    'https://www.theverge.com/rss/index.xml',
  ];
  /** Hardware / devices — mixed into tech beats when news is fresh (not a forced daily slot). */
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
      'All candidate stories were filtered out by freshness, Bitcoin-only currency rule, or repeat rules. Try adjusting MAX_STORY_AGE_HOURS_* , BITCOIN_ONLY_CURRENCY_RULE=0, or STORY_REPEAT_COOLDOWN_DAYS.'
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

  const storyPickRule = `- Pick **3–5** beats from **[TECH]** + **[HARDWARE]** + **[SKATE]** combined (often **3–4** is right for a **single-take ~60–120s** read). Lead with strongest stories; skate = one quick hitter only if it’s genuinely good today.
- **Hardware:** only when **[HARDWARE]** is clearly new / newsworthy; never force a device beat; don’t repeat the same product on slow news days.`;

  const hasWolves = collected.some((c) => c.section === 'LOCAL');

  const segmentOrderBlock = hasWolves
    ? `**SEGMENT ORDER (same in both columns — do not reorder):**
1) **TECH block** — all tech and (when worthy) device beats; pull from **[TECH]** and **[HARDWARE]** as needed. **No** separate mandatory “hardware segment” — fold devices into the tech run when they earn it.
2) **THEN SKATE** — one quick skateboarding beat (from **[SKATE]** only) if there’s a legit premiere / real news; otherwise skip skate and keep it tight.
3) **THEN WOLVES** (Timberwolves — from **[LOCAL]** items: Canis Hoopus RSS plus official **NBA.com** Timberwolves index; only if the item is from the last 24 hours).
4) **CLOSE** — move to soldering / deck; end with the required sign-off. Mention a local spot or neighborhood **only if it fits naturally** in your voice — **no** separate scripted shout-out or hard-sell plug (you already cover that when you want to).`
    : `**SEGMENT ORDER (same in both columns — do not reorder):**
1) **TECH block** — all tech and (when worthy) device beats; pull from **[TECH]** and **[HARDWARE]** as needed. **No** separate mandatory “hardware segment” — fold devices into the tech run when they earn it.
2) **THEN SKATE** — one quick skateboarding beat (from **[SKATE]** only) if there’s a legit premiere / real news; otherwise skip skate and keep it tight.
3) **CLOSE** — move to soldering / deck; end with the required sign-off. Mention a local spot or neighborhood **only if it fits naturally** — **no** separate scripted shout-out block.`;

  const beatOrderPhrase = hasWolves
    ? 'tech → skate → Wolves → close'
    : 'tech → skate → close';

  const parityStories =
    'Pick your covered stories once (**usually 3–4**). **Every** ON_AIR beat needs a **matching** VIDEO_PROMPT \`##\`';

  const prompt = `
You are a punchy, high-energy tech news anchor filming from your repair shop in Linden Hills (Minneapolis). You’re **big on Apple** when it fits, but you’re a **general tech nerd** — phones, silicon, laptops, the whole bench.

NUMBERED STORIES FOR TODAY (each has a URL for your reference only — you cannot browse the web):
${storyListText}

QUALITY RULES:
${storyPickRule}
- If a headline includes a year like "(2024)", that is usually the article’s original date, not “breaking today.” Say “making the rounds” or “people are digging into…” unless it’s clearly new.
- Do not invent products, prices, or dates. Stay close to the headlines.
- **Digital money / chains:** The show is **Bitcoin-only**. Do **not** cover altcoins, stablecoins, NFT/DeFi/Web3 industry, or generic **“crypto”** as an asset class. **Do** cover **Bitcoin** when a sourced headline is clearly about Bitcoin (ETFs, adoption, mining, Lightning, regulation aimed at Bitcoin, etc.). On air, avoid saying **“crypto”** as a bucket — say **Bitcoin** or neutral tech wording.
- **No celebrity gossip, city politics, or general government news** unless the headline is clearly **tech-related** (e.g. regulation of chips, AI, broadband).
- **Wolves / LOCAL** stories come from **Canis Hoopus (RSS)** and the **official NBA.com Timberwolves news index** (same **[LOCAL]** list). Use the basketball beat **only if** the item is from the **last 24 hours**; if nothing qualifies, skip Wolves entirely.
- Skateboarding: use **[SKATE]** sources for one quick, legit skate beat (premiere, SOTY/contest/news). Skip if nothing’s good.
- **No** second scripted local-business “shout-out” — mention a shop or Linden Hills **only if you already do**, naturally.
- **One vertical take, ~60–120 seconds** read aloud at your pace — that target is still the show; nothing changed except **use fewer words**: no essay transitions (“building on that,” “wrapping up,” “let’s unpack”). **Visuals:** screenshot stills only; never promise a full preview or live site scroll; say “on the screenshot” / “in the grab” if needed.

You are writing for a **small professional studio**: one column is the **video / post prompt** (for Final Cut), the other is **on-air copy** (teleprompter / VO only).

${segmentOrderBlock}

**LOCKSTEP + COLUMN A — VIDEO PROMPT:**
- ${parityStories}. Same order as on air (${beatOrderPhrase}); nothing extra in either column.
- **Short Markdown only** (editor notes — not read on camera): one \`#\` line, then one \`##\` per story. Under each: **2–3 bullets max** — mainly **STILL** (which grab / domain) and a **NOTE** if useful (e.g. head left, mask in compound). Skip long shot lists and B-roll plans.

---

**COLUMN B — ON AIR (teleprompter / voiceover — spoken words only):**
- **ALL CAPS.** **Minimum word count** — each story is **1–3 short lines** (headline essence + one “why it matters” line max). No paragraphs, no recap of the whole web.
- **Single continuous take** — write so it flows straight through after the open; no “first story / next up / finally” padding.
- **Do not** put [B-ROLL] or shot notes here — VIDEO PROMPT only.
- START exactly: LIVE FROM THE BENCH IN LINDEN HILLS, I'M KYLE. WE'VE GOT A LOT HITTING THE SHOP TODAY.
- **Enunciation (INLINE):** phonetic in parentheses **on first mention only** next to the word — short; stress in ALL CAPS. Examples: OPENAI (oh-PEN-eye). Real acronyms spelled: A I, G P U.
- END exactly: BACK TO THE SOLDERING IRON. CATCH YOU TOMORROW.

---

**OUTPUT FORMAT (exactly three blocks, in this order — use these marker lines literally):**

<<<VIDEO_PROMPT>>>
(Brief Markdown: \`#\` + \`##\` per story, 2–3 bullets; match ON_AIR order, ${beatOrderPhrase}.)

<<<ON_AIR>>>
(ALL CAPS — **lean** script, one take, ~60–120s; same story order as VIDEO_PROMPT; no bracketed shot notes.)

<<<SOURCES>>>
(Exactly **one line** after this marker: comma-separated 1-based story numbers from the list above, e.g. 2,5,7 — no other text on that line. **Order matters**: list the covered story numbers in the **same order you cover them on air** — first number = first beat, etc. Only include stories you actually covered.)
`;

  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) {
    throw new Error('Set GEMINI_API_KEY (Google AI Studio → Get API key)');
  }

  const model = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash-lite';
  const genUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(geminiKey)}`;

  const body = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { maxOutputTokens: 2200 },
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

  const { videoPrompt, onAir: finalScript, indices } = parseStudioOutput(
    rawOut,
    collected.length
  );

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
    const kept: typeof shots = [];
    for (const s of shots) {
      if (total + s.content.length > maxBytes) {
        console.warn(
          `Screenshot size budget reached — omitting further attachments (${s.filename}).`
        );
        break;
      }
      total += s.content.length;
      kept.push(s);
    }

    if (kept.length) {
      attachments = kept.map((s) => ({
        filename: s.filename,
        content: s.content,
        contentType: 'image/jpeg',
      }));
      const names = kept.map((s) => s.filename).join(', ');
      screenshotBannerText = `\nSOURCE SCREENSHOTS (JPEG attachments — ${kept.length} file(s): ${names})\nCapture: default **mobile / iPhone-width** viewport (393×852 unless SCREENSHOT_WIDTH/HEIGHT set; SCREENSHOT_MOBILE=0 for desktop layout). SCREENSHOT_MODE=${process.env.SCREENSHOT_MODE ?? 'content'}, max crop height SCREENSHOT_MAX_CONTENT_HEIGHT, optional width caps SCREENSHOT_MAX_CONTENT_WIDTH*. JPEG SCREENSHOT_JPEG_QUALITY; DPR SCREENSHOT_DEVICE_SCALE_FACTOR. SCREENSHOT_FULL_PAGE=1 = full scroll. Failed or skipped URLs below if any.\n`;
      screenshotBannerHtml =
        `<p style="font-size:12px;font-weight:700;color:#444;margin:1.25em 0 0.35em">Source screenshots</p>` +
        `<p style="font-size:13px;line-height:1.45;margin:0 0 1em;color:#333">${escapeHtml(
          `${kept.length} JPEG(s) attached (${names}). Default is a content-region crop (article/main) to cut empty margins; paywalls / bot blocking may produce partial or error pages.`
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

  const linksHeader =
    used.length > 0
      ? 'SOURCE LINKS (for this segment — screenshots / posts)'
      : 'SOURCE LINKS (none parsed — see log)';

  const videoHeader = 'VIDEO PROMPT — Markdown (edit / Final Cut / post)';
  const onAirHeader = 'ON AIR (teleprompter / VO)';
  const socialHeader =
    'SOCIAL — Tech News Daily with Kyle (video caption / description)';

  const tickerLine = await getTickerData();
  const socialCaption = buildSocialMediaCaption();
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
