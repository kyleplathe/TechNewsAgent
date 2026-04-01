import 'dotenv/config';
import { parseFeedUrl } from './feed';
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

/** Caption / description block for Reels, Shorts, TikTok, X, Threads, etc. */
function buildSocialMediaCaption(): string {
  const when = new Date().toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'America/Chicago',
  });
  return [
    `Tech News Daily with Kyle · ${when}`,
    '',
    'Your daily tech briefing — the stories that matter, without the doom-scroll. Quick hits, clear context, and what it means for you.',
    '',
    'New episode every day. Follow so you catch the next rundown the moment it drops — easiest way to stay ahead of what is moving in tech.',
    '',
    'Follow for the freshest daily tech news.',
    '',
    '#TechNews #TechNewsDaily #Technology #TechTok #DailyTechNews',
  ].join('\n');
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

function isFreshForSection(item: Collected): boolean {
  const d = parseDateSafe(item.date);
  if (!d && item.section === 'LOCAL') {
    // For Wolves, require a parseable date so stale undated items do not slip through.
    return false;
  }
  if (!d) return true;
  const ageMs = Date.now() - d.getTime();
  const maxAgeMs =
    item.section === 'LOCAL'
      ? 24 * 60 * 60 * 1000
      : item.section === 'SKATE'
        ? 48 * 60 * 60 * 1000
        : item.section === 'TECH'
          ? 48 * 60 * 60 * 1000
          : 72 * 60 * 60 * 1000;
  return ageMs <= maxAgeMs;
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

function enforceLindenHillsPlug(
  onAir: string,
  localBizName: string,
  localBizPitch: string
): string {
  const endLine = "BACK TO THE SOLDERING IRON. CATCH YOU TOMORROW.";
  const hasBiz = normalizeText(onAir).includes(normalizeText(localBizName));
  if (hasBiz) return onAir.trim();

  const plugLine = `LINDEN HILLS SHOUT-OUT: CHECK OUT ${localBizName.toUpperCase()} NEAR 43RD AND UPTON. ${localBizPitch.toUpperCase()} GO CHECK THEM OUT.`;
  const trimmed = onAir.trim();
  if (!trimmed) return `${plugLine}\n${endLine}`;
  if (trimmed.endsWith(endLine)) {
    const body = trimmed.slice(0, -endLine.length).trimEnd();
    return `${body}\n${plugLine}\n${endLine}`.trim();
  }
  return `${trimmed}\n${plugLine}\n${endLine}`.trim();
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
  /** Local = Wolves only (no neighborhood paper — avoids non-tech city/gossip). */
  const localFeeds = ['https://www.canishoopus.com/rss/current.xml'];

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

  if (!collected.length) {
    throw new Error(
      'All candidate stories were filtered out by freshness/repeat rules. Try lowering STORY_REPEAT_COOLDOWN_DAYS.'
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

  const storyPickRule = `- Pick **3–6** total beats from **[TECH]**, **[HARDWARE]**, and **[SKATE]** numbered items **combined**. Lead with the strongest stories (software, AI, industry, security, platforms, etc.) and keep skate tight (one quick hitter if anything is truly good today).
- **Hardware / devices** (phones, Macs, PCs, GPUs, wearables, accessories): include **only when** a **[HARDWARE]** item is **clearly new or newly newsworthy** — e.g. announcement, ship/preorder date, major spec drop, timely review wave, or a **fresh angle** on a product. **Do not** force a device beat every episode. **Do not** recycle the **same product** day after day when headlines are just rehashes or slow drip — skip and spend the time on better **[TECH]** stories instead.`;

  const pickedBiz = pickLocalBusiness();
  const localBizName =
    process.env.LOCAL_BIZ_NAME?.trim() || pickedBiz.name;
  const localBizPitch =
    process.env.LOCAL_BIZ_PITCH?.trim() ||
    `${pickedBiz.description} (${pickedBiz.category}).`;
  const localBizNote = process.env.LOCAL_BIZ_NOTE?.trim() || '';

  const hasWolves = collected.some((c) => c.section === 'LOCAL');

  const segmentOrderBlock = hasWolves
    ? `**SEGMENT ORDER (same in both columns — do not reorder):**
1) **TECH block** — all tech and (when worthy) device beats; pull from **[TECH]** and **[HARDWARE]** as needed. **No** separate mandatory “hardware segment” — fold devices into the tech run when they earn it.
2) **THEN SKATE** — one quick skateboarding beat (from **[SKATE]** only) if there’s a legit premiere / real news; otherwise skip skate and keep it tight.
3) **THEN WOLVES** (Timberwolves — from **[LOCAL]** RSS only, and only if the item is from the last 24 hours).
4) **THEN LINDEN HILLS** neighborhood color: plug **${localBizName}** (near ${LOCAL_INTERSECTION_CENTER}) with a quick “go check them out” recommendation. Use this pitch line: **${localBizPitch}** Then add a small Linden Hills vibe note (Lake Harriet / morning shop energy). **Do not** say “I'M GRABBING A COFFEE.”${localBizNote ? `\n   - Extra note for the plug: ${localBizNote}` : ''}`
    : `**SEGMENT ORDER (same in both columns — do not reorder):**
1) **TECH block** — all tech and (when worthy) device beats; pull from **[TECH]** and **[HARDWARE]** as needed. **No** separate mandatory “hardware segment” — fold devices into the tech run when they earn it.
2) **THEN SKATE** — one quick skateboarding beat (from **[SKATE]** only) if there’s a legit premiere / real news; otherwise skip skate and keep it tight.
3) **THEN LINDEN HILLS** neighborhood color: plug **${localBizName}** (near ${LOCAL_INTERSECTION_CENTER}) with a quick “go check them out” recommendation. Use this pitch line: **${localBizPitch}** Then add a small Linden Hills vibe note (Lake Harriet / morning shop energy). **Do not** say “I'M GRABBING A COFFEE.”${localBizNote ? `\n   - Extra note for the plug: ${localBizNote}` : ''}`;

  const beatOrderPhrase = hasWolves
    ? 'tech → skate → Wolves → Linden Hills'
    : 'tech → skate → Linden Hills';

  const parityStories =
    'Decide your **3–5 covered stories** once. **Every** story you speak in ON_AIR must have a **matching** VIDEO_PROMPT beat';

  const prompt = `
You are a punchy, high-energy tech news anchor filming from your repair shop in Linden Hills (Minneapolis). You’re **big on Apple** when it fits, but you’re a **general tech nerd** — phones, silicon, laptops, the whole bench.

NUMBERED STORIES FOR TODAY (each has a URL for your reference only — you cannot browse the web):
${storyListText}

QUALITY RULES:
${storyPickRule}
- If a headline includes a year like "(2024)", that is usually the article’s original date, not “breaking today.” Say “making the rounds” or “people are digging into…” unless it’s clearly new.
- Do not invent products, prices, or dates. Stay close to the headlines.
- **No celebrity gossip, city politics, or general government news** unless the headline is clearly **tech-related** (e.g. regulation of chips, AI, broadband).
- The only **local RSS** input is **Wolves / NBA** — use it for the basketball beat **only if** the item is from the **last 24 hours**; if the Wolves headline is older, skip Wolves entirely.
- Skateboarding: use **[SKATE]** sources for one quick, legit skate beat (premiere, SOTY/contest/news). Skip if nothing’s good.
- **Linden Hills** — the shops, blocks, and neighborhood feel (near Lake Harriet, the usual haunts) — is **your on-camera color**, not something to pull from a city news feed.
- For the Linden Hills close: plug **${localBizName}** (near ${LOCAL_INTERSECTION_CENTER}) and tell viewers to check them out. Use this pitch line: **${localBizPitch}** **Do not** say “I'M GRABBING A COFFEE.”${localBizNote ? ` Use this extra note: ${localBizNote}` : ''}
- Keep it tight for **about 60 seconds** read aloud.

You are writing for a **small professional studio**: one column is the **video / post prompt** (for Final Cut), the other is **on-air copy** (teleprompter / VO only).

${segmentOrderBlock}

**LOCKSTEP PARITY (VIDEO_PROMPT and ON_AIR must match 1:1):**
- ${parityStories} (same company, product, headline topic, order). **No** B-roll, GFX, or domains in VIDEO_PROMPT for a story you do **not** say on air; **no** on-air beats that VIDEO_PROMPT does not cover.
- Use the **same beat order** in both columns (${beatOrderPhrase}). If you use \`##\` headings or sub-labels in VIDEO_PROMPT (e.g. TECH 1 / TECH 2), ON_AIR must follow that same sequence.
- VIDEO_PROMPT is the **edit map for this exact VO** — not a wish list. Do not add extra topics, products, or games in either column that the other column omits.

---

**COLUMN A — VIDEO PROMPT (Markdown — editor / Final Cut template / screenshots):**
- Output **valid Markdown** (not plain prose paragraphs). Structure it so you can paste into a doc or sidecar for a **~5-minute** cut: one \`##\` heading per story beat (e.g. \`## Tech — OpenAI\`, \`## Wolves\`), then under each heading use **bullet lists** for shots.
- Start with a single \`# Morning bench — edit map\` (or similar) title line, then segments in order: **tech beats** (use \`###\` subheads if you split multiple tech stories), **Wolves**, **Linden Hills**.
- Each shot line: lead with a **bold** label — **CAM**, **B-ROLL**, **GFX**, **LOWER THIRD**, **FULL SCREEN**, **CUT**, **HOLD**, **SOT** — then the note (e.g. \`- **B-ROLL**: homepage grab — opencode.ai\`).
- Mirror ON_AIR **beat-for-beat**: each spoken block in ON_AIR must have a matching \`##\` / list section **in the same order**.
- Reference URLs or domains where useful for grab/screenshot **only** for stories you also say on air.
- This block is **not** read on camera — it’s for **you / the edit**.

---

**COLUMN B — ON AIR (teleprompter / voiceover — spoken words only):**
- **ALL CAPS.** Short lines. **Do not put [B-ROLL] or shot notes here** — those belong in VIDEO PROMPT only.
- START exactly: LIVE FROM THE BENCH IN LINDEN HILLS, I'M KYLE. WE'VE GOT A LOT HITTING THE SHOP TODAY.
- **Enunciation (INLINE, not a list):** Put the phonetic right **next to the word on first mention**, immediately after it in parentheses — not at the end of the beat/section. Keep it short; stress in ALL CAPS. Examples: OPENAI (oh-PEN-eye), MAMBA (MAM-buh). Spelled letters only for real acronyms (A I, G P U).
- END exactly: BACK TO THE SOLDERING IRON. CATCH YOU TOMORROW.

---

**OUTPUT FORMAT (exactly three blocks, in this order — use these marker lines literally):**

<<<VIDEO_PROMPT>>>
(Markdown edit map: \`#\` / \`##\` / \`###\`, bullet shot lists with **CAM** / **B-ROLL** / **GFX** / etc. Same stories and order as ON_AIR. Segment order: ${beatOrderPhrase}.)

<<<ON_AIR>>>
(ALL CAPS spoken script only — same stories and order as VIDEO_PROMPT above; no bracketed shot notes.)

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

  const fixedOnAir = enforceLindenHillsPlug(finalScript, localBizName, localBizPitch);
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
      screenshotBannerText = `\nSOURCE SCREENSHOTS (JPEG attachments — ${kept.length} file(s): ${names})\nViewport default ${process.env.SCREENSHOT_WIDTH ?? '1280'}×${process.env.SCREENSHOT_HEIGHT ?? '720'}; set SCREENSHOT_FULL_PAGE=1 for full scroll. Failed or skipped URLs are listed below if any.\n`;
      screenshotBannerHtml =
        `<p style="font-size:12px;font-weight:700;color:#444;margin:1.25em 0 0.35em">Source screenshots</p>` +
        `<p style="font-size:13px;line-height:1.45;margin:0 0 1em;color:#333">${escapeHtml(
          `${kept.length} JPEG(s) attached (${names}). Default viewport grab; paywalls / bot blocking may produce partial or error pages.`
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
    `<pre style="margin:0;white-space:pre-wrap;word-break:break-word;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:14px;line-height:1.45;color:#18181b;user-select:all;-webkit-user-select:all">${escapeHtml(tickerLine)}</pre>` +
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
