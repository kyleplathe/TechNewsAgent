import 'dotenv/config';
import { parseFeedUrl } from './feed';
import {
  buildEpisodeVerificationToken,
  chicagoDateSlug,
  getChicagoEpisodeNow,
} from './web_publish';
import { Resend } from 'resend';
import {
  LOCAL_INTERSECTION_CENTER,
  pickLocalBusiness,
  type LocalBusiness,
} from './local_businesses';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function normalizeWebsiteUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  // Treat bare domains as HTTPS so local spotlight always has a usable URL.
  return `https://${trimmed.replace(/^\/+/, '')}`;
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

const SOCIAL_READ_MORE_NEWS =
  'Read all the latest Tech News articles at instakyle.tech/news';

function buildShortTagsFromUsed(used: Collected[]): string {
  const tags = ['#TechNews'];
  if (used.some((c) => c.section === 'LOCAL')) tags.push('#Timberwolves');
  if (used.some((c) => c.section === 'REPAIR')) tags.push('#TechRepair');
  if (used.some((c) => c.section === 'SKATE')) tags.push('#Skateboarding');
  return tags.join(' ');
}

function topicTagsFromText(text: string): string[] {
  const t = text.toLowerCase();
  const out: string[] = [];
  const add = (tag: string) => {
    if (!out.includes(tag)) out.push(tag);
  };

  if (/\blinux\b/.test(t)) add('#Linux');
  if (/\b(ai|artificial intelligence|openai|gemini|llm|deepfake)\b/.test(t))
    add('#AI');
  if (/\b(e-?bike|ebike|amflow)\b/.test(t)) add('#EBikes');
  if (/\b(google|alphabet)\b/.test(t)) add('#Google');
  if (/\b(thunderbird|mozilla)\b/.test(t)) add('#Mozilla');
  if (/\b(iphone|ios|mac|macbook|apple)\b/.test(t)) add('#Apple');
  if (/\b(nvidia|gpu)\b/.test(t)) add('#GPU');

  return out.slice(0, 4);
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
  const ctaBlock = `\n\n${SOCIAL_READ_MORE_NEWS}\n\n`;
  let b = body.trim().replace(/\s+/g, ' ').slice(0, 400);
  if (!b) b = 'Daily roundup from the bench.';
  let s = `${headline}\n\n${b}${ctaBlock}${tags}`;
  if (s.length <= THREADS_CAP) return s;
  const overhead =
    headline.length +
    tags.length +
    ctaBlock.length +
    4; /* two newlines around body */
  const maxBody = Math.max(40, THREADS_CAP - overhead - 1);
  b = b.slice(0, Math.max(1, maxBody - 1)) + '…';
  s = `${headline}\n\n${b}${ctaBlock}${tags}`;
  return s.length <= THREADS_CAP ? s : s.slice(0, THREADS_CAP);
}

function stripHashtagLines(input: string): string {
  const lines = input
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const kept = lines.filter((l) => !l.startsWith('#'));
  return kept.join(' ').trim();
}

/** Letters-only ratio of A–Z — models sometimes echo ON AIR and paste ALL CAPS into <<<SOCIAL>>>. */
function isMostlyUppercaseLatin(text: string): boolean {
  const letters = text.replace(/[^A-Za-z]/g, '');
  if (letters.length < 8) return false;
  const up = [...letters].filter((c) => c >= 'A' && c <= 'Z').length;
  return up / letters.length >= 0.72;
}

/**
 * Facebook / Meta often downranks ALL CAPS as distracting. Convert shouty model output to
 * sentence case and restore common tech brand spellings.
 */
function normalizeSocialBodySentenceCase(body: string): string {
  const t = body.trim();
  if (!t || !isMostlyUppercaseLatin(t)) return t;

  let s = t.toLowerCase();
  s = s.replace(/^\s*([a-z])/, (m) => m.toUpperCase());
  s = s.replace(/([.!?])\s+([a-z])/g, (_, end: string, c: string) => `${end} ${c.toUpperCase()}`);

  const fixes: Array<[RegExp, string]> = [
    [/\bai\b/g, 'AI'],
    [/\bapi\b/g, 'API'],
    [/\bgpu\b/g, 'GPU'],
    [/\bcpu\b/gi, 'CPU'],
    [/\bcpus\b/gi, 'CPUs'],
    [/\bios\b/gi, 'iOS'],
    [/\bipados\b/gi, 'iPadOS'],
    [/\biphone\b/gi, 'iPhone'],
    [/\bipad\b/gi, 'iPad'],
    [/\bmacos\b/gi, 'macOS'],
    [/\bwatchos\b/gi, 'watchOS'],
    [/\btvos\b/gi, 'tvOS'],
    [/\bvisionos\b/gi, 'visionOS'],
    [/\busb\b/gi, 'USB'],
    [/\bssd\b/gi, 'SSD'],
    [/\bram\b/gi, 'RAM'],
    [/\bnba\b/gi, 'NBA'],
    [/\bopenai\b/gi, 'OpenAI'],
    [/\bgithub\b/gi, 'GitHub'],
    [/\byoutube\b/gi, 'YouTube'],
    [/\blinden hills\b/gi, 'Linden Hills'],
    [/\btimberwolves\b/gi, 'Timberwolves'],
    [/\bminneapolis\b/gi, 'Minneapolis'],
  ];
  for (const [re, rep] of fixes) {
    s = s.replace(re, rep);
  }
  return s;
}

function mapSectionForBlog(
  section: Collected['section']
): 'Software' | 'Hardware' | 'Skate' | 'Timberwolves' | 'Tech Repair' {
  if (section === 'TECH') return 'Software';
  if (section === 'HARDWARE') return 'Hardware';
  if (section === 'SKATE') return 'Skate';
  if (section === 'LOCAL') return 'Timberwolves';
  return 'Tech Repair';
}

/** Post JSON `seoKeywords` — neighborhood + episode + local business discovery. */
function buildSeoKeywords(biz: LocalBusiness, used: Collected[]): string[] {
  const fromStories = used
    .flatMap((u) => normalizeText(u.title).split(/\s+/))
    .filter((w) => w.length >= 4 && /^[a-z0-9]+$/i.test(w))
    .slice(0, 24);
  const base = [
    'Tech News Daily',
    'Kyle Plathe',
    'Linden Hills',
    'Minneapolis',
    '43rd and Upton',
    'Lake Harriet',
    'Southwest Minneapolis',
    biz.name,
    biz.category,
    ...biz.tags,
    ...fromStories,
  ];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of base) {
    const k = raw.trim();
    if (!k) continue;
    const lower = k.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push(k);
    if (out.length >= 48) break;
  }
  return out;
}

/**
 * Hardware feeds (Apple Newsroom, 9to5Mac, Tom's Hardware) mix device news with OS/app/platform
 * stories. Re-tag obvious software beats as TECH so prompts, email tags, and blog categories stay
 * [TECH] / Software instead of mislabeled Hardware.
 */
function looksLikeSoftwareStoryFromHardwareFeed(text: string): boolean {
  const t = text.toLowerCase();

  if (/\bapp store\b/.test(t)) return true;
  if (/\b(google play|play store)\b/.test(t)) return true;

  // Windows / Microsoft OS servicing (require Windows or Microsoft — avoids "insider" GPU rumor posts)
  if (/\bwindows\s+insider\b/.test(t)) return true;
  if (
    /\binsider\s+(?:preview|program|build|channel)\b/.test(t) &&
    /\bwindows\b/.test(t)
  )
    return true;
  if (
    /\bwindows\s+(?:1[01]|server\s*202)\b/.test(t) &&
    /\b(?:insider|preview|update|patch|build|kb\d|cumulative|servicing|version)\b/.test(t)
  )
    return true;
  if (/\bpatch tuesday\b/.test(t) && /\b(microsoft|windows)\b/.test(t)) return true;

  if (
    /\b(?:macos|mac os x|ipados|watchos|tvos|visionos)\b/.test(t) &&
    /\b(?:beta|update|preview|release|security|features|available|rolls out|announces|developer)\b/.test(
      t
    )
  )
    return true;

  if (/\bios\s+\d{2}\b/.test(t) && /\b(?:beta|update|developer|public preview|rc\b)\b/.test(t))
    return true;

  if (/\b(xcode|testflight)\b/.test(t)) return true;

  return false;
}

function refineHardwareSectionIfSoftwareStory(c: Collected): Collected {
  if (c.section !== 'HARDWARE') return c;
  const blob = `${c.title}\n${c.link}`;
  if (!looksLikeSoftwareStoryFromHardwareFeed(blob)) return c;
  return { ...c, section: 'TECH' };
}

type Collected = {
  section: 'TECH' | 'LOCAL' | 'HARDWARE' | 'SKATE' | 'REPAIR';
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
const CORE_SOURCE_STORIES = 4;
const CULTURE_SOURCE_STORIES = 1;
const TARGET_SOURCE_STORIES = CORE_SOURCE_STORIES + CULTURE_SOURCE_STORIES;
const MAX_SOURCE_STORIES = TARGET_SOURCE_STORIES;

function parseSourceIndices(afterSources: string, maxIndex: number): number[] {
  const numLine = afterSources.split(/\n/)[0] ?? '';
  const indices = numLine
    .split(/[,;\s]+/)
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n >= 1 && n <= maxIndex);
  const seen = new Set<number>();
  return indices
    .filter((n) => (seen.has(n) ? false : (seen.add(n), true)))
    .slice(0, MAX_SOURCE_STORIES);
}

/**
 * Studio layout: ON AIR → SOURCES (indices) → SOCIAL (optional body).
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

function parseRetryAfterSeconds(message: string): number | null {
  const m =
    message.match(/retry[- ]after[:\s]+(\d+)\s*s?/i) ??
    message.match(/retry in[:\s]+(\d+)\s*s?/i);
  if (!m) return null;
  const secs = parseInt(m[1] ?? '', 10);
  if (!Number.isFinite(secs) || secs <= 0) return null;
  return Math.min(120, secs);
}

function isRetryableResendError(err: { name?: string; message?: string }): boolean {
  const name = (err.name ?? '').toLowerCase();
  const msg = (err.message ?? '').toLowerCase();
  if (name.includes('application_error') || name.includes('timeout')) return true;
  if (/\b(429|500|502|503|504)\b/.test(msg)) return true;
  if (
    msg.includes('internal server error') ||
    msg.includes('try again later') ||
    msg.includes('temporar')
  ) {
    return true;
  }
  return false;
}

function isResendApplicationNotFound(err: {
  name?: string;
  message?: string;
}): boolean {
  const name = (err.name ?? '').toLowerCase();
  const msg = (err.message ?? '').toLowerCase();
  return name.includes('application_not_found') || msg.includes('application not found');
}

function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function spokenNameAppearsInOnAir(onAir: string, bizName: string): boolean {
  const squash = (s: string) =>
    normalizeText(s).replace(/\s+/g, '');
  const hay = squash(onAir);
  const needle = squash(bizName);
  if (!needle) return false;
  if (hay.includes(needle)) return true;
  const words = bizName.split(/\s+/).filter((w) => {
    const core = w.replace(/[^a-z0-9]/gi, '');
    return core.length >= 3;
  });
  return words.length > 0 && words.every((w) => hay.includes(squash(w)));
}

/**
 * Gemini sometimes drops the required neighbor close. Inject one ALL CAPS line with the business
 * name before the fixed END lines when it’s missing.
 */
function ensureLocalBusinessInOnAir(onAir: string, bizName: string): string {
  const t = onAir.trim();
  const name = bizName.trim();
  if (!name) return t;
  if (spokenNameAppearsInOnAir(t, name)) return t;
  const insert = `LINDEN HILLS IS QUIET THIS EARLY, AND ${name.toUpperCase()} ALWAYS FITS THE NEIGHBORHOOD RHYTHM ON THIS CORNER.`;
  const re = /^([\s\S]*?)(BACK TO THE SOLDERING IRON\b[\s\S]*)$/im;
  const m = t.match(re);
  if (m && m[1] !== undefined && m[2] !== undefined) {
    return `${m[1].trim()}\n\n${insert}\n\n${m[2].trim()}`;
  }
  return `${t}\n\n${insert}\n\nBACK TO THE SOLDERING IRON. CATCH YOU TOMORROW.`;
}

function countBusinessMentions(onAir: string, bizName: string): number {
  const hay = normalizeText(onAir);
  const needle = normalizeText(bizName);
  if (!needle) return 0;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  const m = hay.match(new RegExp(`\\b${escaped}\\b`, 'gi'));
  return m?.length ?? 0;
}

function countApproxNewsBeats(onAir: string): number {
  const body = onAir
    .replace(
      /^LIVE FROM THE BENCH IN LINDEN HILLS, I'M KYLE\. AND WE'VE GOT A LOT HITTING THE SHOP TODAY\./i,
      ''
    )
    .replace(/BACK TO THE SOLDERING IRON\.[\s\S]*$/i, '')
    .trim();
  if (!body) return 0;
  const paragraphBlocks = body
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean).length;
  if (paragraphBlocks >= 3) return paragraphBlocks;
  // Fallback when model returns one dense block: estimate beats from sentence density.
  const sentenceCount = (body.match(/[.!?](?=\s|$)/g) ?? []).length;
  if (sentenceCount <= 0) return paragraphBlocks;
  return Math.max(paragraphBlocks, Math.ceil(sentenceCount / 2));
}

function countOnAirWords(onAir: string): number {
  return onAir
    .replace(/\r\n/g, '\n')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function validateStudioOutput(
  onAir: string,
  indices: number[],
  localBizName: string,
  selectedStories: Collected[],
  hasFreshSkateCandidate: boolean
): string[] {
  const issues: string[] = [];
  const sourceCount = indices.length;
  if (sourceCount !== TARGET_SOURCE_STORIES) {
    issues.push(
      `SOURCES must include exactly ${TARGET_SOURCE_STORIES} story numbers; got ${sourceCount}.`
    );
  }
  const hasWolvesSelected = selectedStories.some((s) => s.section === 'LOCAL');
  const hasSkateSelected = selectedStories.some((s) => s.section === 'SKATE');
  if (hasFreshSkateCandidate && !hasSkateSelected) {
    issues.push(
      'When a fresh skate story exists, include one SKATE story in SOURCES.'
    );
  }
  // Keep ON AIR mentions aligned with chosen source sections.
  if (!hasWolvesSelected && /\b(timberwolves|wolves)\b/i.test(onAir)) {
    issues.push('ON AIR mentions Wolves but SOURCES does not include a LOCAL story.');
  }
  if (!hasSkateSelected && /\b(skate|skateboard|skateboarding)\b/i.test(onAir)) {
    issues.push('ON AIR mentions skate but SOURCES does not include a SKATE story.');
  }
  if (/\blake street\b/i.test(onAir)) {
    issues.push('ON AIR must not mention Lake Street.');
  }
  if (/\blynx\b/i.test(onAir)) {
    issues.push('ON AIR must not mention Lynx.');
  }
  const bizMentions = countBusinessMentions(onAir, localBizName);
  if (bizMentions !== 1) {
    issues.push(`ON AIR must mention "${localBizName}" exactly once; got ${bizMentions}.`);
  }
  const beatCount = countApproxNewsBeats(onAir);
  const maxAllowedBeats = TARGET_SOURCE_STORIES + 1; // story beats + neighborhood close
  if (beatCount > maxAllowedBeats) {
    issues.push(
      `ON AIR appears to contain too many beats (${beatCount}); keep to ${TARGET_SOURCE_STORIES} story beats plus close.`
    );
  }
  const words = countOnAirWords(onAir);
  if (words > 235) {
    issues.push(`ON AIR is too long (${words} words); trim to ~175-215 words.`);
  }
  return issues;
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

function toOrderedUniqueSourceIndices(indices: number[], maxIndex: number): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const i of indices) {
    if (!Number.isFinite(i)) continue;
    const n = Math.trunc(i);
    if (n < 1 || n > maxIndex) continue;
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

/**
 * Default freshness (hours). Override per section with `MAX_STORY_AGE_HOURS_TECH`, `_HARDWARE`,
 * `_SKATE`, `_LOCAL`, `_REPAIR` in `.env`.
 */
const DEFAULT_MAX_STORY_AGE_HOURS: Record<Collected['section'], number> = {
  LOCAL: 18,
  REPAIR: 18,
  SKATE: 18,
  TECH: 18,
  HARDWARE: 18,
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

const NON_TECH_HEADLINE_SIGNAL_RE =
  /\b(car\s+insurance|auto\s+insurance|homeowners?\s+insurance|life\s+insurance|insurance\s+rates?|state\s+farm|geico|allstate|progressive|insurance\s+claim|mortgage|refinance|credit\s+card|debt\s+relief|personal\s+loan|real\s+estate|housing\s+market|travel\s+tips?|fashion|celebrity|horoscope)\b/i;

const TECH_HEADLINE_SIGNAL_RE =
  /\b(ai|a i|software|app|apps|os\b|iphone|ipad|mac|macbook|android|pixel|galaxy|windows|microsoft|apple|google|openai|anthropic|nvidia|gpu|cpu|chip|silicon|cloud|api|developer|github|cybersecurity|security|ransomware|xbox|playstation|nintendo|steam|vr\b|ar\b|robot|autonomous|self\s*driving|electric\s+vehicle|ev\b|tesla|spacex|bitcoin|lightning)\b/i;

const REPAIR_HEADLINE_SIGNAL_RE =
  /\b(repair|right\s+to\s+repair|serviceability|teardown|ifixit|parts|diagnostic|fix|maintenance|replace|battery|screen|warranty|recall)\b/i;

const TECH_REPAIR_TARGET_RE =
  /\b(phone|smartphone|iphone|android|pixel|galaxy|tablet|ipad|laptop|notebook|macbook|pc\b|computer|desktop|gpu|cpu|chip|motherboard|console|xbox|playstation|nintendo|switch|controller|headset|vr\b|ar\b|wearable|watch|apple\s+watch|airpods|earbuds|router|modem|drone|printer|camera|firmware|software|electronics?)\b/i;

function passesEditorialScopeRule(item: Collected): boolean {
  if (item.section === 'TECH' || item.section === 'HARDWARE') {
    if (!NON_TECH_HEADLINE_SIGNAL_RE.test(item.title)) return true;
    return TECH_HEADLINE_SIGNAL_RE.test(item.title);
  }
  if (item.section === 'REPAIR') {
    // Keep REPAIR strictly in tech/electronics lanes.
    return (
      REPAIR_HEADLINE_SIGNAL_RE.test(item.title) &&
      TECH_REPAIR_TARGET_RE.test(item.title) &&
      !NON_TECH_HEADLINE_SIGNAL_RE.test(item.title)
    );
  }
  if (item.section === 'LOCAL') {
    // LOCAL is Timberwolves-only; drop Lynx items from mixed feeds.
    return !/\blynx\b/i.test(item.title);
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

function hostFirstLabels(link: string): string[] {
  try {
    const h = new URL(link).hostname.replace(/^www\./i, '').toLowerCase();
    const parts = h.split('.').filter(Boolean);
    if (parts.length < 1) return [];
    const out: string[] = [];
    const head = parts[0];
    if (head.length >= 3) out.push(head);
    return out;
  } catch {
    return [];
  }
}

/**
 * First word position in normalized ON AIR (0-based). Lower = earlier in the VO.
 * Uses hostname label + title tokens so order tracks what you said, not necessarily `<<<SOURCES>>>`.
 */
function firstMentionWordIndex(c: Collected, onAirWords: string[]): number {
  const candidates = new Set<string>();
  for (const h of hostFirstLabels(c.link)) candidates.add(h);

  for (const w of titleFingerprint(c.title).split(' ')) {
    if (w.length >= 3) candidates.add(w);
  }
  for (const w of normalizeText(c.title).split(' ')) {
    if (w.length >= 4) candidates.add(w);
  }

  let best = Number.MAX_SAFE_INTEGER;
  for (const cand of candidates) {
    const idx = onAirWords.indexOf(cand);
    if (idx >= 0 && idx < best) best = idx;
  }
  return best;
}

/** Reorder selected story indices to match spoken order in ON AIR (stable for ties). */
function reorderIndicesToMatchOnAir(
  indices: number[],
  collected: Collected[],
  onAir: string
): number[] {
  const onAirWords = normalizeText(onAir).split(/\s+/).filter(Boolean);
  const decorated = indices.map((idx, orderInSources) => ({
    idx,
    wordIdx: (() => {
      const c = collected[idx - 1];
      return c ? firstMentionWordIndex(c, onAirWords) : Number.MAX_SAFE_INTEGER;
    })(),
    orderInSources,
  }));
  decorated.sort((a, b) => {
    if (a.wordIdx !== b.wordIdx) return a.wordIdx - b.wordIdx;
    return a.orderInSources - b.orderInSources;
  });
  return decorated.map((d) => d.idx);
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

  /** Repair-first pool: bench fixes, right-to-repair, teardowns, serviceability. */
  const repairFeeds = [
    'https://www.ifixit.com/News/rss',
    'https://www.repairerdrivennews.com/feed/',
  ];
  /**
   * Tech = software, platforms, AI, security (when tech), gaming news, dev ecosystem —
   * **not** altcoins (Bitcoin-only rule applies on headlines). Add/remove URLs here.
   */
  const techFeeds = [
    'https://news.ycombinator.com/rss',
    'https://feeds.arstechnica.com/arstechnica/index',
    'https://www.theverge.com/rss/index.xml',
    'https://techcrunch.com/feed/',
    'https://www.polygon.com/rss/index.xml/',
    'https://www.engadget.com/rss.xml',
    'https://www.gamesindustry.biz/feed',
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
    section: 'TECH' | 'LOCAL' | 'HARDWARE' | 'SKATE' | 'REPAIR'
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

  console.log('Fetching repair, global, hardware, skate, and local feeds...');
  await pull(repairFeeds, 'REPAIR');
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

  collected = collected.map(refineHardwareSectionIfSoftwareStory);

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
  const droppedOffScope: string[] = [];
  collected = collected.filter((c) => {
    const ok = passesEditorialScopeRule(c);
    if (!ok) droppedOffScope.push(`[${c.section}] ${c.title}`);
    return ok;
  });
  if (droppedOffScope.length) {
    console.warn(
      'Dropped off-scope headlines (non-tech within TECH/HARDWARE feeds):\n' +
        droppedOffScope.join('\n')
    );
  }

  if (!collected.length) {
    throw new Error(
      'All candidate stories were filtered out by freshness, editorial scope, Bitcoin-only currency rule, undated items (set ALLOW_UNDATED_FEED_ITEMS=1 only if a feed omits dates), or repeat rules. Try MAX_STORY_AGE_HOURS_* , BITCOIN_ONLY_CURRENCY_RULE=0, or STORY_REPEAT_COOLDOWN_DAYS.'
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

  // Newest-first in the numbered list so the model reaches for fresh headlines first.
  collected.sort((a, b) => {
    const ta = parseDateSafe(a.date)?.getTime() ?? Number.NEGATIVE_INFINITY;
    const tb = parseDateSafe(b.date)?.getTime() ?? Number.NEGATIVE_INFINITY;
    return tb - ta;
  });

  const storyListText = collected
    .map((c, i) => {
      const n = i + 1;
      const url = c.link || '(no URL in feed)';
      return `${n}. [${c.section}] ${c.title}\n   URL: ${url}`;
    })
    .join('\n\n');

  const storyPickRule = `- **<<<SOURCES>>> length = slide count:** Pick **exactly ${TARGET_SOURCE_STORIES} story numbers** total (**never ${TARGET_SOURCE_STORIES + 1}+**).
- **Lineup shape (default):** Build **${CORE_SOURCE_STORIES} core beats** (REPAIR/TECH/HARDWARE) **plus ${CULTURE_SOURCE_STORIES} culture/sports beat** (**[LOCAL]** Timberwolves or **[SKATE]**), then do the neighborhood close.
- **Freshest wins:** **NUMBERED STORIES** below are sorted **newest-first** (publish time). When several headlines are similarly strong, prefer the **newer** item.
- **Pillars (wide pool, thin show):** The bench covers **repair/right-to-repair**, **software**, **AI/ML**, **hardware & gadgets**, **Bitcoin-only** digital-asset news (when sourced), **skate**, **Timberwolves**, and the **neighborhood** close. You **do not** need every pillar every episode — pick what is **fresh and worth the air**; skipping skate or Wolves is fine when it keeps you near **~90s**.
- **Culture / sports slot:** Keep this as **one beat**. Use **[SKATE]** when a fresh skate item exists; if not, use a fresh **Wolves** (**[LOCAL]**) beat.
- **Hard slot rule (sports/culture):** The 5th beat should be **SKATE first**, with **Wolves fallback** only when skate has no fresh candidate.
- **Fallback sports cue:** If skate is unavailable, use one fresh **Wolves** beat; if both are unavailable, keep the 4 core beats and close.
- **Hardware** only when it clearly earns it; never force a gadget beat.`;

  const hasWolves = collected.some((c) => c.section === 'LOCAL');
  const hasSkate = collected.some((c) => c.section === 'SKATE');

  const pickedBiz = pickLocalBusiness();
  const localBizName =
    process.env.LOCAL_BIZ_NAME?.trim() || pickedBiz.name;
  const localBizPitch =
    process.env.LOCAL_BIZ_PITCH?.trim() ||
    `${pickedBiz.description} (${pickedBiz.category}).`;
  const localBizCategory = pickedBiz.category.trim();
  const localBizTags = pickedBiz.tags.join(', ');
  const coffeeAllowed =
    /\b(cafe|coffee|tea)\b/i.test(localBizCategory) ||
    pickedBiz.tags.some((t) => /\b(cafe|coffee|tea)\b/i.test(t));
  const localBizNote = process.env.LOCAL_BIZ_NOTE?.trim() || '';

  const localColorBlock = `
**LINDEN HILLS / NEIGHBORHOOD + LOCAL BUSINESS (before the fixed END lines — NOT optional):**
- **Context:** You **post this show before most businesses open** — that’s just your schedule, not a story beat. Do **not** say you “walked by,” “passed,” or “stopped at” **${localBizName}** or any other shop; do **not** talk about who’s open, closed, or opening first. Keep it a **neighbor-context line** for **${localBizName}** alone (${localBizPitch}) — identity and place with a light positive nod.
- **Do not** name **any other** café, restaurant, or shop in the close — only **${localBizName}** (exactly **once** by name).
- **Business-type anchor:** Keep the mention tied to what this place actually is (**category:** ${localBizCategory}; **tags:** ${localBizTags}).
- **No default coffee line:** ${coffeeAllowed ? `Coffee/tea wording is allowed here because this business fits that lane, but still keep it brief and non-promotional.` : `Do **not** mention coffee, espresso, or “grabbing a cup” for this business.`}
- **1–2 short lines** of generic Linden Hills color near **${LOCAL_INTERSECTION_CENTER}** (Lake Harriet, quiet blocks, etc.) if it fits — still **without** naming other businesses.
- **Style target:** One calm sentence with a **light plug** (friendly and local, not hype).
- **Good pattern:** Neighborhood atmosphere + what the business is known for + why it fits the corner. **Bad pattern:** category mismatch (for example coffee wording for a hardware store), generic filler, or recommendation voice.
- **Non-negotiable:** The spoken name **${localBizName}** must appear **exactly once** in **COLUMN B (ON AIR)** in this close segment **before** “BACK TO THE SOLDERING IRON…” Light praise is fine; avoid influencer clichés, hard sell, “GO CHECK THEM OUT,” or direct calls to action.
- If you omit **${localBizName}** from ON AIR, the script is **wrong**.${localBizNote ? `\n- Extra note: ${localBizNote}` : ''}`;

  const segmentOrderBlock = hasWolves
    ? `**SEGMENT ORDER (same in both columns — do not reorder):**
1) **REPAIR FIRST** — open with one repair / right-to-repair beat from **[REPAIR]** when available and fresh; if no repair beat qualifies, start with the strongest **TECH**/**HARDWARE** headline.
2) **TECH block** — **1–2** beats from **[TECH]** + **[HARDWARE]** (software, AI, hardware, gaming industry, **Bitcoin** when the headline is Bitcoin-specific) — **freshest and most newsworthy**, not “cover everything.”
3) **OPTIONAL: WOLVES then SKATE** — if you include sports, cover a fresh **Wolves** beat from **[LOCAL]** (Canis Hoopus + **NBA.com** index) **before** any **[SKATE]** line. **Prefer at most one** of Wolves or skate; only use **both** if Wolves comes **first**, each is **one short sentence**, and you stay under the ON AIR word budget; otherwise skip to close.
4) **CLOSE** — **Linden Hills / neighborhood beat** (see block below), then soldering / deck; end with the required sign-off.`
    : `**SEGMENT ORDER (same in both columns — do not reorder):**
1) **REPAIR FIRST** — open with one repair / right-to-repair beat from **[REPAIR]** when available and fresh; if no repair beat qualifies, start with the strongest **TECH**/**HARDWARE** headline.
2) **TECH block** — **1–2** beats from **[TECH]** + **[HARDWARE]** (software, AI, hardware, gaming industry, **Bitcoin** when the headline is Bitcoin-specific) — **freshest and most newsworthy**, not “cover everything.”
3) **OPTIONAL: SKATE** — one quick **[SKATE]** beat only if it’s legit; otherwise skip to close.
4) **CLOSE** — **Linden Hills / neighborhood beat** (see block below), then soldering / deck; end with the required sign-off.`;

  const prompt = `
You are a **direct, plain-spoken** tech reporter at your repair bench in Linden Hills (Minneapolis) — calm morning desk, not hype. You’re **big on Apple** when it fits, but you’re a **general tech nerd** — phones, silicon, laptops, the whole bench.

NUMBERED STORIES FOR TODAY — **sorted newest-first**, **each line is numbered 1, 2, 3…** Use those numbers in **<<<SOURCES>>>** (same number = same story = same email JPEG / slide):
${storyListText}

QUALITY RULES:
${storyPickRule}
- **Recency (critical):** The list is **pre-filtered** for freshness (**~18 hours** per section by default). Treat everything as **today’s desk** — not “yesterday” or “overnight” unless the item’s date is clearly **today** in US **Central**. Skip stale vibes, republished “classics,” and year-stamped reruns unless the headline proves it’s **new today**. If a headline includes “(2024)” or an old year, it is usually **not** breaking — either skip or frame as “making the rounds again,” not fresh news.
- Do not invent products, prices, or dates. Stay close to the headlines.
- **Digital money / chains:** The show is **Bitcoin-only**. Do **not** cover altcoins, stablecoins, NFT/DeFi/Web3 industry, or generic **“crypto”** as an asset class. **Do** cover **Bitcoin** when a sourced headline is clearly about Bitcoin (ETFs, adoption, mining, Lightning, regulation aimed at Bitcoin, etc.). On air, avoid saying **“crypto”** as a bucket — say **Bitcoin** or neutral tech wording.
- **No celebrity gossip, city politics, or general government news** unless the headline is clearly **tech-related** (e.g. regulation of chips, AI, broadband).
- **Wolves / LOCAL** — **Canis Hoopus (RSS)** plus **NBA.com Timberwolves** index (same **[LOCAL]** list). Use the basketball beat **only** when the item is **fresh**; if nothing qualifies, **skip Wolves** entirely.
- Skateboarding: use **[SKATE]** for one quick, legit beat (premiere, contest, real news). Skip if nothing’s good.
- **Section/source lock:** Do **not** mention Wolves unless a **[LOCAL]** story number is in **<<<SOURCES>>>**. Do **not** mention skate unless a **[SKATE]** number is in **<<<SOURCES>>>**.
- **Length (non-negotiable):** One vertical take **~90 seconds** — treat **~85s as a soft floor** and **~95s as a hard ceiling** at a calm read. **Budget ~175–215 spoken words** between the fixed START line and the fixed END lines (ALL CAPS reads a little slow — stay lean). **If you are over budget, cut beats** before you cut the **${localBizName}** close.
- **No extra headlines:** In **ON AIR**, cover **only** the stories whose numbers you list in **<<<SOURCES>>>**. No bonus or side mentions outside those ${TARGET_SOURCE_STORIES} picks.
- **Tight but not thin:** On **main** beats only, add **one concrete detail** when the headline gives you something real (a number, vendor, mechanism) — **no** filler, **no** essay transitions (“building on that,” “wrapping up,” “let’s unpack,” **“let’s dive in,”** **“deep dive,”** **“we’ll unpack”**). **Visuals:** screenshot stills only; never promise a full preview or live site scroll; say “on the screenshot” / “in the grab” if needed.
- **Banned hype / podcast clichés (ON AIR and social — never say or echo):** “hold on to your hat(s),” “buckle up,” “deep dive,” “let’s dive in,” “fire hose,” “grab your popcorn,” “you won’t believe,” “crazy,” “insane” (unless the headline literally uses it), or **any** “fasten your seatbelts” style padding. Sound like a colleague at the bench, not a trailer voice.
- **Local business (every episode):** The ON AIR close **must** name **${localBizName}** once (see **LINDEN HILLS** block). That line is **not** filler — **include it** even on tight ~90s reads.

You are writing for one **on-air column only** (teleprompter / VO).

${segmentOrderBlock}
${localColorBlock}

**COLUMN B — ON AIR (teleprompter / voiceover — spoken words only):**
- **ALL CAPS.** Each **main** story (**REPAIR** + **TECH**/**HARDWARE**) is **1–3 short lines** max: headline essence + **why it matters** + **one concrete detail** only when it fits without bloat (**skip** the detail if it forces wordiness). **SKATE** / **Wolves**: **≤2 short lines** each; often **one sentence** is enough. No long paragraphs, no recap of the whole web.
- **Single continuous take** — write so it flows straight through after the open; **no** “coming up / we’ve also got” runway; no “first story / next up / finally” padding; **no** “hold on to your hats,” **no** “deep dive,” **no** “buckle up” or similar.
- **Do not** put [B-ROLL] or shot notes in ON AIR.
- START exactly: LIVE FROM THE BENCH IN LINDEN HILLS, I'M KYLE. AND WE'VE GOT A LOT HITTING THE SHOP TODAY.
- **Enunciation (INLINE):** phonetic in parentheses **on first mention only** next to the word — short; stress in ALL CAPS. Examples: OPENAI (oh-PEN-eye). Real acronyms spelled: A I, G P U.
- **Close:** After your last **news** beat, **before** the two fixed END lines: **one** tight **ALL CAPS** line (two only if still under word budget) mixing **Linden Hills** color with **${localBizName}** spoken **once** by name (required — see LINDEN HILLS block). A **light plug** is okay, but keep it specific to business type and avoid hard sell / direct calls to action.
- END exactly (literal, final two sentences of ON AIR): BACK TO THE SOLDERING IRON. CATCH YOU TOMORROW.

---

**OUTPUT FORMAT (exactly three blocks, in this order — use these marker lines literally):**

<<<ON_AIR>>>
(ALL CAPS — one take, **~90s** with **~175–215 words** between START and END; same order as SOURCES; **must** include **${localBizName}** once in the close before **BACK TO THE SOLDERING IRON**.)

<<<SOURCES>>>
(Exactly **one line**: comma-separated **1-based story numbers** from **NUMBERED STORIES FOR TODAY** — **exactly ${TARGET_SOURCE_STORIES} numbers**. E.g. \`2,5,7,9,11\` = story **2**, then **5**, then **7**, then **9**, then **11**. **Order = slide order** = JPEG order in the email = **the exact sequence of news beats in COLUMN B (ON AIR)** — first story you speak → first number, second beat → second number, and so on. Do **not** sort or group by section; if the numbered list has Heathkit as **3** and iPhone as **4** but you speak iPhone before Heathkit, emit **4** before **3** in this line. **Never** put **[LOCAL]** / Wolves first in this line just because it’s a different feed — if Wolves is the **last** news beat before the neighborhood close, its number must be **last** among the indices you list (unless you genuinely **open** ON AIR with Wolves).)

<<<SOCIAL>>>
(**Body text only** — do **not** repeat the “Tech News Daily with Kyle · date” line; do **not** include hashtags; the system adds one hashtag row automatically. Max **~280 characters**, 1–2 tight sentences echoing **specific topics** you actually covered — product names, Wolves, skate, bench vibe — not generic filler. **Write in sentence case** (normal Facebook / Instagram style): capitalize the first word and proper nouns only. **Do not** use ALL CAPS, title case for the whole paragraph, or fake emphasis — platforms flag shouty text as low quality. Standard tech spellings are fine (OpenAI, iPhone, GPU). No “link in bio,” no explaining screenshots. Threads-length.)
`;

  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) {
    throw new Error('Set GEMINI_API_KEY (Google AI Studio → Get API key)');
  }

  const model = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash-lite';
  const genUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(geminiKey)}`;

  const buildGeminiBody = (text: string) =>
    JSON.stringify({
      contents: [{ parts: [{ text }] }],
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
  const maxGeminiTotalAttempts = Math.min(
    36,
    Math.max(
      4,
      parseInt(process.env.GEMINI_MAX_TOTAL_ATTEMPTS ?? '14', 10) || 14
    )
  );
  let geminiTotalAttempts = 0;

  async function generateWithBackoff(requestText: string): Promise<string> {
    let raw = '';
    let lastErr = '';
    for (let attempt = 1; attempt <= maxGeminiAttempts; attempt++) {
      geminiTotalAttempts += 1;
      if (geminiTotalAttempts > maxGeminiTotalAttempts) {
        throw new Error(
          `Gemini: exceeded total attempt budget (${maxGeminiTotalAttempts}) across retries/validation loops (attempted ${geminiTotalAttempts}).`
        );
      }
      const aiResponse = await fetch(genUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: buildGeminiBody(requestText),
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
        await new Promise((r) => setTimeout(r, Math.ceil(waitSec * 1000)));
        continue;
      }
      if (!aiResponse.ok) {
        throw new Error(
          `Gemini API ${aiResponse.status}: ${data.error?.message ?? JSON.stringify(data)}`
        );
      }
      const parts = data.candidates?.[0]?.content?.parts;
      raw = parts?.map((p) => p.text).filter(Boolean).join('') ?? '';
      if (!raw) {
        throw new Error(`Gemini returned no text: ${JSON.stringify(data)}`);
      }
      break;
    }
    if (!raw) {
      throw new Error(
        `Gemini: exhausted ${maxGeminiAttempts} attempts (429). Last error: ${lastErr || 'unknown'}`
      );
    }
    return raw;
  }

  const maxValidationRetries = Math.min(
    3,
    Math.max(1, parseInt(process.env.GEMINI_VALIDATION_RETRIES ?? '2', 10) || 2)
  );
  let rawOut = '';
  let fixedOnAir = '';
  let onAirForEmail = '';
  let indices: number[] = [];
  let modelSocial = '';
  let validationIssues: string[] = [];

  for (let pass = 1; pass <= maxValidationRetries + 1; pass++) {
    const requestText =
      pass === 1
        ? prompt
        : `${prompt}\n\nRETRY NOTE: Your last output violated hard rules.\n${validationIssues
            .map((i) => `- ${i}`)
            .join('\n')}\nRegenerate all three blocks now, following the exact markers.`;
    rawOut = await generateWithBackoff(requestText);
    const parsed = parseStudioOutput(rawOut, collected.length);
    fixedOnAir = parsed.onAir.trim();
    indices = toOrderedUniqueSourceIndices(parsed.indices, collected.length).slice(
      0,
      TARGET_SOURCE_STORIES
    );
    modelSocial = parsed.social;
    onAirForEmail = ensureLocalBusinessInOnAir(fixedOnAir, localBizName);
    const selectedStories = indices
      .map((i) => collected[i - 1])
      .filter((c): c is Collected => Boolean(c));
    validationIssues = validateStudioOutput(
      onAirForEmail,
      indices,
      localBizName,
      selectedStories,
      hasSkate
    );
    if (!validationIssues.length) break;
    if (pass <= maxValidationRetries) {
      console.warn(
        `Gemini output failed validation (pass ${pass}/${maxValidationRetries + 1}); retrying:\n${validationIssues.join('\n')}`
      );
    }
  }

  if (validationIssues.length) {
    console.warn(
      'Proceeding after validation retries exhausted; preserving best effort output:\n' +
        validationIssues.join('\n')
    );
  }
  if (onAirForEmail.trim() !== fixedOnAir.trim()) {
    console.warn(
      'ON AIR: Injected a neighbor line with the local business name (model output did not include it).'
    );
  }
  /**
   * Default: **`<<<SOURCES>>>` line order** (matches Gemini’s slide / VO sequence).
   * Set **`USE_ON_AIR_SOURCE_REORDER=1`** to re-sort indices by hostname/title hits in ON AIR text
   * (legacy heuristic; can diverge from the model’s `<<<SOURCES>>>` line).
   */
  const orderedIndices =
    process.env.USE_ON_AIR_SOURCE_REORDER?.trim() === '1'
      ? reorderIndicesToMatchOnAir(indices, collected, fixedOnAir)
      : indices;

  const used = orderedIndices
    .map((i) => collected[i - 1])
    .filter(Boolean)
    .filter((c) => c.link);

  const socialHeadline = formatSocialHeadline();
  let socialBody = normalizeSocialBodySentenceCase(
    stripHashtagLines(modelSocial.trim())
  );
  if (!socialBody) socialBody = fallbackSocialBodyFromUsed(used);
  const topicTags = topicTagsFromText(
    [socialBody, ...used.map((u) => u.title)].join(' ')
  );
  const shortTags = Array.from(
    new Set([buildShortTagsFromUsed(used), ...topicTags].join(' ').split(/\s+/))
  )
    .filter(Boolean)
    .slice(0, 5)
    .join(' ');
  const socialCaption = finalizeSocialCaption(
    socialHeadline,
    socialBody,
    shortTags
  );

  if (!orderedIndices.length) {
    console.warn(
      'No <<<SOURCES>>> line parsed — email will omit screenshot links (check model output).'
    );
  } else {
    console.log('Sources used for segment (screenshots):', orderedIndices.join(', '));
  }

  const localBizWebsiteResolved = normalizeWebsiteUrl(
    process.env.LOCAL_BIZ_WEBSITE?.trim() || pickedBiz.website?.trim() || ''
  );
  const hasLocalSpotlightLink =
    !!localBizWebsiteResolved && /^https?:\/\//i.test(localBizWebsiteResolved);

  /** Plain text: [SECTION] Title then URL on next line (matches FCP / screenshot workflow). */
  const linkRowsText = used.map((c) => `[${c.section}] ${c.title}\n${c.link}`);
  if (hasLocalSpotlightLink) {
    linkRowsText.push(`[Local Spotlight] ${localBizName}\n${localBizWebsiteResolved}`);
  }
  const linksText = linkRowsText.join('\n\n');

  const linksHtmlRows = used.map(
    (c) =>
      `<p style="margin:0 0 0.15em;font-size:14px;line-height:1.4">[${escapeHtml(c.section)}] ${escapeHtml(c.title)}</p>` +
      `<p style="margin:0 0 1.1em;font-size:13px;word-break:break-all"><a href="${escapeHtml(c.link)}">${escapeHtml(c.link)}</a></p>`
  );
  if (hasLocalSpotlightLink) {
    linksHtmlRows.push(
      `<p style="margin:0 0 0.15em;font-size:14px;line-height:1.4">[Local Spotlight] ${escapeHtml(localBizName)}</p>` +
        `<p style="margin:0 0 1.1em;font-size:13px;word-break:break-all"><a href="${escapeHtml(localBizWebsiteResolved)}">${escapeHtml(localBizWebsiteResolved)}</a></p>`
    );
  }
  const linksHtml =
    linksHtmlRows.length > 0
      ? linksHtmlRows.join('')
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

  let localSpotlightShot: { filename: string; content: Buffer } | null = null;
  if (
    localBizWebsiteResolved &&
    /^https?:\/\//i.test(localBizWebsiteResolved) &&
    envScreenshotsEnabled()
  ) {
    const { screenshotSources } = await import('./screenshot_sources');
    const spotlightInput = {
      storyIndex: 99,
      section: 'LOCAL',
      title: localBizName,
      link: localBizWebsiteResolved,
      filenameOverride: '99-local-spotlight.jpg',
    };
    let { ok: locOk, failures: locFail } = await screenshotSources([
      spotlightInput,
    ]);
    let hit = locOk[0];
    if (!hit) {
      console.warn(
        'Local spotlight (default viewport/UA) failed — retrying with desktop layout…',
        locFail
      );
      const prevMobile = process.env.SCREENSHOT_MOBILE;
      process.env.SCREENSHOT_MOBILE = '0';
      try {
        const r2 = await screenshotSources([spotlightInput]);
        hit = r2.ok[0];
        if (!hit) {
          console.warn('Local spotlight (desktop retry) failed:', r2.failures);
        }
      } finally {
        if (prevMobile === undefined) {
          delete process.env.SCREENSHOT_MOBILE;
        } else {
          process.env.SCREENSHOT_MOBILE = prevMobile;
        }
      }
    }
    if (hit) {
      localSpotlightShot = { filename: hit.filename, content: hit.content };
    }
  } else if (!localBizWebsiteResolved) {
    console.warn(
      'LOCAL SPOTLIGHT: No business website URL — set LOCAL_BIZ_WEBSITE or add optional `website` on entries in local_businesses.ts for a storefront grab and email JPEG.'
    );
  } else if (!envScreenshotsEnabled()) {
    console.warn(
      'LOCAL SPOTLIGHT: SCREENSHOT_SOURCES is off — no storefront JPEG (website link can still appear in the email).'
    );
  }

  const maxBytesAttach = Math.min(
    38 * 1024 * 1024,
    Math.max(
      5 * 1024 * 1024,
      parseInt(process.env.SCREENSHOT_MAX_TOTAL_BYTES ?? '34000000', 10) ||
        34_000_000
    )
  );
  const emailAttachments: Array<{
    filename: string;
    content: Buffer;
    contentType?: string;
  }> = [...(attachments ?? [])];
  if (localSpotlightShot) {
    const totalSoFar = emailAttachments.reduce((n, a) => n + a.content.length, 0);
    if (totalSoFar + localSpotlightShot.content.length <= maxBytesAttach) {
      emailAttachments.push({
        filename: localSpotlightShot.filename,
        content: localSpotlightShot.content,
        contentType: 'image/jpeg',
      });
    } else {
      console.warn(
        'LOCAL SPOTLIGHT: attachment skipped — would exceed SCREENSHOT_MAX_TOTAL_BYTES.'
      );
    }
  }

  const resendKey = process.env.RESEND_API_KEY;
  const toRaw = process.env.RESEND_TO?.trim();
  const configuredFrom = process.env.RESEND_FROM?.trim() || '';
  const defaultPrimaryFrom = 'Daily Script <agent@instakyle.tech>';
  const defaultFallbackFrom = 'Daily Script <onboarding@resend.dev>';
  const fromCandidates = Array.from(
    new Set(
      [configuredFrom, defaultPrimaryFrom, defaultFallbackFrom].filter(
        (v) => v.length > 0
      )
    )
  );

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

  const onAirHeader = 'ON AIR (teleprompter / VO)';
  const socialHeader =
    'Social — Tech News Daily with Kyle (video caption / description)';
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
    onAirHeader,
    onAirForEmail.trim(),
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
    `<p style="font-size:12px;font-weight:700;letter-spacing:0.04em;color:#444;margin:0 0 0.5em">${escapeHtml(onAirHeader)}</p>` +
    `<pre style="white-space:pre-wrap;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;line-height:1.5;margin:0 0 1.5em;padding:12px;background:#fff;border-radius:8px;border:1px solid #ddd">${escapeHtml(onAirForEmail.trim())}</pre>` +
    `<p style="font-size:12px;font-weight:700;letter-spacing:0.04em;color:#444;margin:0 0 0.5em">${escapeHtml(socialHeader)}</p>` +
    socialCaptionHtml +
    `<p style="font-size:12px;font-weight:700;letter-spacing:0.04em;color:#444;margin:0 0 0.5em">${escapeHtml(ytVerifyHeader)}</p>` +
    `<pre style="white-space:pre-wrap;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;line-height:1.5;margin:0 0 1.25em;padding:12px;background:#fefce8;border-radius:8px;border:1px solid #eab308;user-select:all;-webkit-user-select:all">${escapeHtml(ytVerifyLine)}</pre>` +
    `<p style="font-size:12px;font-weight:700;color:#444;margin:0 0 0.5em">${escapeHtml(linksHeader)}</p>` +
    `<div style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;line-height:1.45">${linksHtml}</div>` +
    screenshotBannerHtml +
    `</div>`;

  const resendMaxAttempts = Math.min(
    8,
    Math.max(1, parseInt(process.env.RESEND_MAX_RETRIES ?? '4', 10) || 4)
  );
  let sendData:
    | {
        id?: string | null;
      }
    | undefined;
  let lastSendErr: { name?: string; message?: string } | undefined;

  for (const from of fromCandidates) {
    for (let attempt = 1; attempt <= resendMaxAttempts; attempt++) {
      const res = await resend.emails.send({
        from,
        to,
        subject: `📺 Your News Script for ${getChicagoEpisodeNow().toLocaleDateString('en-US', { timeZone: 'America/Chicago' })}${emailAttachments.length ? ' 📎' : ''}`,
        text: emailText,
        html: emailHtml,
        ...(emailAttachments.length ? { attachments: emailAttachments } : {}),
      });

      if (!res.error) {
        sendData = res.data;
        lastSendErr = undefined;
        break;
      }

      lastSendErr = {
        name: res.error.name,
        message: res.error.message,
      };
      const retryable = isRetryableResendError(lastSendErr);
      const appMissing = isResendApplicationNotFound(lastSendErr);

      if (appMissing) {
        if (from !== fromCandidates[fromCandidates.length - 1]) {
          console.warn(
            `Resend sender "${from}" unavailable (${lastSendErr.message}). Trying fallback sender…`
          );
        }
        break;
      }
      if (!retryable || attempt >= resendMaxAttempts) {
        break;
      }

      const parsedRetryAfter = parseRetryAfterSeconds(lastSendErr.message ?? '');
      const waitSec = parsedRetryAfter ?? Math.min(12 * attempt, 60);
      console.warn(
        `Resend send failed (${lastSendErr.name ?? 'error'}). Waiting ${waitSec}s — retry ${attempt + 1}/${resendMaxAttempts}…`
      );
      await new Promise((r) => setTimeout(r, waitSec * 1000));
    }

    if (!lastSendErr) break;
    if (!isResendApplicationNotFound(lastSendErr)) break;
  }

  if (lastSendErr) {
    throw new Error(`Resend: ${lastSendErr.message} (${lastSendErr.name})`);
  }

  const webDir = process.env.TECHNEWS_WEB_DIR?.trim();
  const instakyleNewsDir = process.env.TECHNEWS_INSTAKYLE_NEWS_DIR?.trim();
  const techNewsVideoUrl = process.env.TECHNEWS_VIDEO_URL?.trim() || null;

  if ((webDir || instakyleNewsDir) && used.length) {
    let localSpotlightForWeb: {
      websiteUrl: string;
      businessName: string;
      imageFilename?: string;
      imageBuffer?: Buffer;
    } | null = null;
    if (
      localBizWebsiteResolved &&
      /^https?:\/\//i.test(localBizWebsiteResolved)
    ) {
      localSpotlightForWeb = {
        websiteUrl: localBizWebsiteResolved,
        businessName: localBizName,
        ...(localSpotlightShot
          ? {
              imageFilename: localSpotlightShot.filename,
              imageBuffer: localSpotlightShot.content,
            }
          : {}),
      };
    }

    const { writeTechNewsWebBundle } = await import('./web_publish');
    const bizForSeo: LocalBusiness = { ...pickedBiz, name: localBizName };
    const seoKeywords = buildSeoKeywords(bizForSeo, used);
    const webStories = used.map((c, j) => {
      const storyIndex = orderedIndices[j]!;
      const shot = screenshotKept.find((k) => k.storyIndex === storyIndex);
      return {
        storyIndex,
        section: mapSectionForBlog(c.section),
        title: c.title,
        link: c.link,
        publishedAt: c.date,
        imageFilename: shot?.filename,
        imageBuffer: shot?.content,
      };
    });
    await writeTechNewsWebBundle({
      ...(webDir ? { outDir: webDir } : {}),
      ...(instakyleNewsDir ? { instakyleNewsDir } : {}),
      tickerLine,
      socialCaption,
      videoPrompt: '',
      onAirPlain: onAirForEmail.trim(),
      stories: webStories,
      seoKeywords,
      ...(localSpotlightForWeb ? { localSpotlight: localSpotlightForWeb } : {}),
      localBusiness: {
        name: localBizName,
        category: pickedBiz.category,
        description: pickedBiz.description,
        website: localBizWebsiteResolved || null,
      },
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
  if (linksText) {
    console.log('\n--- Segment links ---\n' + linksText);
  }
}

runNewsAgent().catch((err) => {
  console.error(err);
  process.exit(1);
});
