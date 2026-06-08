import 'dotenv/config';
import { parseFeedUrl } from './feed';
import {
  buildEpisodeVerificationToken,
  chicagoDateSlug,
  getChicagoEpisodeNow,
} from './web_publish';
import {
  finalizeSocialCaption,
  formatSocialHeadline,
  normalizeSocialBodySentenceCase,
  stripHashtagLines,
} from './lib/social';
import { parseStudioOutput } from './lib/studio_parse';
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

type FinalSegment = {
  index: number;
  storyIndex: number;
  row: Collected;
};

type CultureSectionMode = 'AUTO' | 'SKATE' | 'LOCAL';

function cultureSectionMode(): CultureSectionMode {
  const raw = (process.env.CULTURE_SECTION_MODE ?? '').trim().toUpperCase();
  if (raw === 'SKATE') return 'SKATE';
  if (raw === 'LOCAL' || raw === 'WOLVES' || raw === 'TIMBERWOLVES') return 'LOCAL';
  return 'AUTO';
}

type AirLogEntry = {
  fingerprint: string;
  title: string;
  section: Collected['section'];
  productKey: string;
  airedAt: string;
};

/** Three repair/tech/hardware picks + optional sports slot (see caps — never Wolves and skate together). */
const CORE_SOURCE_STORIES = 3;
const CULTURE_SOURCE_STORIES = 1;
const TARGET_SOURCE_STORIES = CORE_SOURCE_STORIES + CULTURE_SOURCE_STORIES;
const MAX_SOURCE_STORIES = TARGET_SOURCE_STORIES;

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

/** Tokens too vague to prove a specific SOURCES headline got its own VO beat. */
const GENERIC_TITLE_ANCHORS = new Set([
  'apple',
  'google',
  'meta',
  'microsoft',
  'amazon',
  'samsung',
  'intel',
  'amd',
  'nvidia',
  'iphone',
  'ipad',
  'macbook',
  'mac',
  'ios',
  'android',
  'watch',
  'vision',
  'airpods',
  'latest',
  'today',
  'update',
  'updates',
  'news',
  'breaking',
  'report',
  'reports',
  'announces',
  'launch',
  'launches',
]);

function siliconAnchorsFromTitle(title: string): string[] {
  const out: string[] = [];
  for (const m of title.matchAll(/\bm\d+[a-z]?\b/gi)) {
    const t = normalizeText(m[0] ?? '');
    if (t) out.push(t);
  }
  return out;
}

/** Product / SKU fragments models often say aloud differently than one verbose headline verb (e.g. C64 vs REINTRODUCES). */
function alphanumericAnchorsFromTitle(title: string): string[] {
  const lower = title.toLowerCase();
  const out: string[] = [];
  const re = /\b(?=[a-z0-9]*\d)[a-z0-9]{2,}\b/gi;
  for (const m of lower.matchAll(re)) {
    const t = (m[0] ?? '').replace(/[^a-z0-9]/g, '');
    if (t.length >= 2) out.push(t);
  }
  return [...new Set(out)];
}

const MAX_ANCHOR_CANDIDATES_PER_STORY = 18;

/**
 * Ordered keyword candidates for validation — VO may paraphrase one headline token while still covering the story.
 * Match succeeds if **any** candidate appears in normalized ON AIR text.
 */
function anchorCandidatesForStory(
  story: Collected,
  storyIndex: number,
  allStories: Collected[]
): string[] {
  const titlesNorm = allStories.map((s) => normalizeText(s.title));
  const mine = titlesNorm[storyIndex] ?? '';
  const words = [...new Set(mine.split(/\s+/).filter((w) => w.length >= 4))].sort(
    (a, b) => b.length - a.length
  );

  const silicon = siliconAnchorsFromTitle(story.title);
  const alnum = alphanumericAnchorsFromTitle(story.title);

  const pushUnique = (dst: string[], v: string) => {
    const x = v.trim().toLowerCase();
    if (x.length < 3) return;
    if (!dst.includes(x)) dst.push(x);
  };

  const out: string[] = [];
  for (const x of [...silicon, ...alnum]) pushUnique(out, x);
  for (const w of words) {
    if (GENERIC_TITLE_ANCHORS.has(w)) continue;
    const aloneInBatch = !titlesNorm.some(
      (t, j) => j !== storyIndex && t.includes(w)
    );
    if (aloneInBatch || w.length >= 6) pushUnique(out, w);
  }
  for (const w of words) {
    if (!GENERIC_TITLE_ANCHORS.has(w)) pushUnique(out, w);
  }
  for (const w of words) pushUnique(out, w);

  return out.slice(0, MAX_ANCHOR_CANDIDATES_PER_STORY);
}

/** VO paragraphs before sign-off — models must separate beats with blank lines so structure stays 1:1 with <<<SOURCES>>>. */
function countParagraphBlocksBeforeSignoff(onAir: string): number {
  const normalized = onAir.replace(/\r\n/g, '\n').trim();
  const cut = normalized.search(/\n\s*BACK TO THE SOLDERING IRON\./i);
  const head = cut >= 0 ? normalized.slice(0, cut) : normalized;
  const afterOpen = head.replace(/^LIVE FROM THE BENCH IN LINDEN HILLS[^\n]*\n*/i, '').trim();
  if (!afterOpen) return 0;
  return afterOpen.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean).length;
}

/** Names models often paste without a matching headline in <<<SOURCES>>>. */
function validateUnsourcedBrandMentions(
  onAir: string,
  selectedStories: Collected[]
): string[] {
  const issues: string[] = [];
  const blob = selectedStories.map((s) => `${s.title}\n${s.link}`).join('\n');
  const checks: Array<{ re: RegExp; label: string }> = [
    { re: /\bMETA\b|\bFACEBOOK\b/i, label: 'Meta/Facebook' },
    { re: /\bTSMC\b/i, label: 'TSMC' },
  ];
  for (const { re, label } of checks) {
    if (!re.test(onAir)) continue;
    if (re.test(blob)) continue;
    issues.push(
      `ON AIR mentions **${label}** but none of the ${TARGET_SOURCE_STORIES} <<<SOURCES>>> headlines/sources contain that name — drop it or swap in the numbered pick that actually covers it.`
    );
  }
  return issues;
}

function validateStoryAnchorsInOnAir(
  onAir: string,
  selectedStories: Collected[]
): string[] {
  const issues: string[] = [];
  const hay = normalizeText(onAir);
  for (let i = 0; i < selectedStories.length; i++) {
    const row = selectedStories[i];
    if (!row) continue;
    const candidates = anchorCandidatesForStory(row, i, selectedStories);
    if (candidates.some((c) => hay.includes(c))) continue;
    const clip = row.title.replace(/\s+/g, ' ').trim().slice(0, 72);
    const hint = candidates.slice(0, 4).join(', ') || '(no keywords extracted)';
    issues.push(
      `ON AIR beat ${i + 1} must reflect its headline (not a merged roundup): include **at least one** concrete keyword from that row — try speaking something like **${hint.toUpperCase()}** — picked headline starts “${clip}”.`
    );
  }
  return issues;
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

const SOLDERING_SIGNOFF_RE = /^([\s\S]*?)(BACK TO THE SOLDERING IRON\b[\s\S]*)$/im;

function insertBeforeSolderingSignOff(onAir: string, paragraph: string): string {
  const t = onAir.trim();
  const insert = paragraph.trim();
  if (!insert) return t;
  const m = t.match(SOLDERING_SIGNOFF_RE);
  if (m && m[1] !== undefined && m[2] !== undefined) {
    return `${m[1].trim()}\n\n${insert}\n\n${m[2].trim()}`;
  }
  return `${t}\n\n${insert}`;
}

const ON_AIR_OPEN_LINE_RE =
  /^LIVE FROM THE BENCH IN LINDEN HILLS, I'M KYLE\. AND WE'VE GOT A LOT HITTING THE SHOP TODAY\./im;

/** Podcast-style runway the prompt bans — fail validation so Gemini retries. */
const ON_AIR_BANNED_PADDING_RES: Array<{ re: RegExp; label: string }> = [
  { re: /\bFIRST UP\b/i, label: '“FIRST UP”' },
  { re: /\bMEANWHILE\b/i, label: '“MEANWHILE”' },
  { re: /\bON THE HARDWARE FRONT\b/i, label: '“ON THE HARDWARE FRONT”' },
  { re: /\bSPEAKING OF HARDWARE\b/i, label: '“SPEAKING OF HARDWARE”' },
  { re: /\bTHAT'S THE TECH WRAP\b/i, label: '"THAT\'S THE TECH WRAP"' },
  { re: /\bNEXT UP\b/i, label: '"NEXT UP"' },
  { re: /\bFINALLY\b,/i, label: '"FINALLY,"' },
  { re: /\bWRAPPING UP\b/i, label: '"WRAPPING UP"' },
  { re: /\bLET'S UNPACK\b/i, label: '"LET\'S UNPACK"' },
];

function validateBannedOnAirPadding(onAir: string): string[] {
  const issues: string[] = [];
  for (const { re, label } of ON_AIR_BANNED_PADDING_RES) {
    if (re.test(onAir)) {
      issues.push(
        `ON AIR uses banned transition padding ${label} — cut runway phrases; go straight from beat to beat.`
      );
    }
  }
  return issues;
}

/**
 * Missing sports VO lines belong **before** the Linden Hills / business close, not after sign-off.
 */
function insertBeforeNeighborhoodClose(
  onAir: string,
  paragraph: string,
  bizName: string
): string {
  const t = onAir.replace(/\r\n/g, '\n').trim();
  const insert = paragraph.trim();
  if (!insert) return t;

  let cut = -1;
  const openMatch = t.match(ON_AIR_OPEN_LINE_RE);
  const bodyStart = openMatch?.index !== undefined ? openMatch.index + openMatch[0].length : 0;
  const body = t.slice(bodyStart);
  const lindenIdx = body.search(/\bLINDEN HILLS\b/i);
  if (lindenIdx >= 0) {
    const absIdx = bodyStart + lindenIdx;
    cut = t.lastIndexOf('\n\n', absIdx);
    if (cut < bodyStart) cut = bodyStart;
  } else {
    const bn = bizName.trim();
    if (bn.length >= 3) {
      const escaped = bn
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\s+/g, '\\s+');
      const re = new RegExp(`\\b${escaped}\\b`, 'i');
      const hit = re.exec(t);
      if (hit && hit.index !== undefined && hit.index > 0) {
        cut = t.lastIndexOf('\n\n', hit.index);
        if (cut < 0) cut = 0;
      }
    }
  }

  if (cut >= 0) {
    const head = t.slice(0, cut).trimEnd();
    const tail = t.slice(cut).trimStart();
    return `${head}\n\n${insert}\n\n${tail}`;
  }
  return insertBeforeSolderingSignOff(t, insert);
}

function briefHeadlineAllCaps(title: string, maxLen = 100): string {
  let s = title.replace(/\s+/g, ' ').trim();
  if (!s) return 'HEADLINE ON THE BOARD — SEE SOURCE LINK.';
  if (s.length > maxLen) {
    s = `${s.slice(0, maxLen - 3).trimEnd()}...`;
  }
  return s.toUpperCase();
}

function countBusinessMentions(onAir: string, bizName: string): number {
  const hay = normalizeText(onAir);
  const needle = normalizeText(bizName);
  if (!needle) return 0;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  const m = hay.match(new RegExp(`\\b${escaped}\\b`, 'gi'));
  return m?.length ?? 0;
}

/**
 * Gemini often splits one VO beat across several blank-line paragraphs (allowed “1–3 short lines”).
 * Merge line-like chunks so beat counts track stories, not paragraph breaks.
 */
function mergeAdjacentMicroParagraphs(blocks: string[], maxMicroLen = 200): string[] {
  const out: string[] = [];
  for (const raw of blocks) {
    const t = raw.trim();
    if (!t) continue;
    const prev = out[out.length - 1];
    if (
      prev !== undefined &&
      prev.length <= maxMicroLen &&
      t.length <= maxMicroLen
    ) {
      out[out.length - 1] = `${prev} ${t}`;
    } else {
      out.push(t);
    }
  }
  return out;
}

function countApproxNewsBeats(onAir: string): number {
  const body = onAir
    .replace(/\r\n/g, '\n')
    .replace(
      /^LIVE FROM THE BENCH IN LINDEN HILLS, I'M KYLE\. AND WE'VE GOT A LOT HITTING THE SHOP TODAY\./i,
      ''
    )
    .replace(/BACK TO THE SOLDERING IRON\.[\s\S]*$/i, '')
    .trim();
  if (!body) return 0;
  const blocks = body
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);
  const merged = mergeAdjacentMicroParagraphs(blocks);
  let beats = merged.length;

  const sentenceMatch = body.match(/[.!?](?=\s|$)/g);
  const sentenceCount = sentenceMatch?.length ?? 0;

  // When paragraph splitting inflates the count, anchor on spoken sentence density (~2–3 sentences / beat).
  if (sentenceCount > 0 && merged.length > TARGET_SOURCE_STORIES + 1) {
    beats = Math.ceil(sentenceCount / 2.6);
  } else if (beats < 3 && sentenceCount > 0) {
    beats = Math.max(beats, Math.ceil(sentenceCount / 2));
  }

  return beats;
}

/**
 * Gemini sometimes pastes the same story block twice (two paragraphs, identical copy).
 * That burns VO time and leaves one <<<SOURCES>>> row without a real beat.
 */
function hasAdjacentDuplicateNewsParagraphs(onAir: string): boolean {
  const body = onAir
    .replace(
      /^LIVE FROM THE BENCH IN LINDEN HILLS, I'M KYLE\. AND WE'VE GOT A LOT HITTING THE SHOP TODAY\./i,
      ''
    )
    .replace(/BACK TO THE SOLDERING IRON\.[\s\S]*$/i, '')
    .trim();
  if (!body) return false;
  const blocks = body
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);
  for (let i = 1; i < blocks.length; i++) {
    const a = normalizeText(blocks[i - 1] ?? '');
    const b = normalizeText(blocks[i] ?? '');
    if (a.length < 40 || b.length < 40) continue;
    if (a === b) return true;
  }
  return false;
}

function countOnAirWords(onAir: string): number {
  return onAir
    .replace(/\r\n/g, '\n')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

/**
 * Applied to ON AIR **after** `ensureLocalBusinessInOnAir` / optional culture injections
 * (those lines add words — CI used to fail at a tight 195 cap).
 * Editorial target stays ~150–195 in the prompt; bounds are the automation gate.
 */
function onAirWordBounds(): { min: number; max: number } {
  const minParsed = parseInt(process.env.ON_AIR_MIN_WORDS ?? '105', 10);
  const maxParsed = parseInt(process.env.ON_AIR_MAX_WORDS ?? '218', 10);
  const min =
    Number.isFinite(minParsed) && minParsed >= 0
      ? Math.min(Math.max(minParsed, 70), 200)
      : 105;
  let max =
    Number.isFinite(maxParsed) && maxParsed > 0
      ? Math.min(Math.max(maxParsed, min + 30), 360)
      : 218;
  if (max < min + 20) max = min + 20;
  return { min, max };
}

/**
 * Word bounds for PICK_MODE, scaled to however many stories the editor chose
 * (~one beat each + a short neighborhood close). `ON_AIR_MIN_WORDS` /
 * `ON_AIR_MAX_WORDS` override when explicitly set.
 */
function pickModeWordBounds(targetCount: number): { min: number; max: number } {
  const perBeatMin = 26;
  const perBeatMax = 52;
  const closeWords = 24;
  let min = Math.max(60, targetCount * perBeatMin + closeWords);
  let max = targetCount * perBeatMax + closeWords + 16;
  const envMin = parseInt(process.env.ON_AIR_MIN_WORDS ?? '', 10);
  const envMax = parseInt(process.env.ON_AIR_MAX_WORDS ?? '', 10);
  if (Number.isFinite(envMin) && envMin > 0) min = envMin;
  if (Number.isFinite(envMax) && envMax > 0) max = envMax;
  if (max < min + 20) max = min + 20;
  return { min, max };
}

/** Matches Timberwolves / Wolves on air — must align with [LOCAL] in <<<SOURCES>>>. */
const ON_AIR_WOLVES_RE =
  /\b(timberwolves|\bwolves\b|minnesota\s+timberwolves)\b/i;

/**
 * Skate beat on air: say "skate" / "Thrasher" / etc. — models sometimes name the outlet without "skate".
 * Must align with [SKATE] in <<<SOURCES>>>.
 */
const ON_AIR_SKATE_RE =
  /\b(skate|skateboard|skateboarding|skaters?|thrasher)\b/i;

function onAirReferencesWolvesBeat(onAir: string): boolean {
  return ON_AIR_WOLVES_RE.test(onAir);
}

function onAirReferencesSkateBeat(onAir: string): boolean {
  return ON_AIR_SKATE_RE.test(onAir);
}

function buildFinalSegments(indices: number[], collected: Collected[]): FinalSegment[] {
  const out: FinalSegment[] = [];
  for (const idx of indices) {
    const row = collected[idx - 1];
    if (!row?.link?.trim()) continue;
    out.push({ index: out.length + 1, storyIndex: idx, row });
  }
  return out;
}

function autoRepairOnAirCultureMismatch(
  onAir: string,
  finalSegments: FinalSegment[],
  localBizName: string
): string {
  let next = onAir.trim();
  const localSeg = finalSegments.find((s) => s.row.section === 'LOCAL');
  const skateSeg = finalSegments.find((s) => s.row.section === 'SKATE');

  if (localSeg && !onAirReferencesWolvesBeat(next)) {
    const line = `TIMBERWOLVES BEAT — ${briefHeadlineAllCaps(localSeg.row.title)}`;
    next = insertBeforeNeighborhoodClose(next, line, localBizName);
  }
  if (skateSeg && !onAirReferencesSkateBeat(next)) {
    const line = `SKATEBOARDING BEAT — ${briefHeadlineAllCaps(skateSeg.row.title)}`;
    next = insertBeforeNeighborhoodClose(next, line, localBizName);
  }
  return next.trim();
}

/**
 * At most one sports row ([LOCAL] or [SKATE]); if present it must be first or last in <<<SOURCES>>>.
 */
function validateCultureBeatPlacement(selectedStories: Collected[]): string[] {
  const issues: string[] = [];
  if (selectedStories.length !== TARGET_SOURCE_STORIES) return issues;

  const positions = selectedStories
    .map((s, i) =>
      s.section === 'LOCAL' || s.section === 'SKATE' ? i : -1
    )
    .filter((i) => i >= 0);

  if (positions.length > 1) {
    issues.push(
      'Pick **exactly one** sports beat: **[LOCAL]** Timberwolves **or** **[SKATE]** — never both in the same episode.'
    );
    return issues;
  }

  if (positions.length === 0) return issues;

  const last = selectedStories.length - 1;
  const c = positions[0]!;
  if (c !== 0 && c !== last) {
    issues.push(
      'Sports ([LOCAL] or [SKATE]) must be **first or last** in <<<SOURCES>>> — never between core beats.'
    );
  }
  return issues;
}

function validateStudioOutput(
  onAir: string,
  indices: number[],
  localBizName: string,
  selectedStories: Collected[],
  shouldRequireSkateBeat: boolean,
  cultureMode: CultureSectionMode,
  /** Raw model ON AIR (before culture auto-repair) — sports beats must be written here, not injected. */
  modelOnAir?: string
): string[] {
  const modelText = (modelOnAir ?? onAir).trim();
  const issues: string[] = [];
  const sourceCount = indices.length;
  if (sourceCount !== TARGET_SOURCE_STORIES) {
    issues.push(
      `SOURCES must include exactly ${TARGET_SOURCE_STORIES} story numbers; got ${sourceCount}.`
    );
  }
  if (sourceCount > 0 && selectedStories.length !== sourceCount) {
    issues.push(
      `Resolved ${selectedStories.length} sourced row(s) from ${sourceCount} indices — each index must map to a collected item with a non-empty link (otherwise email/blog rows desync).`
    );
  }
  const localCount = selectedStories.filter((s) => s.section === 'LOCAL').length;
  const skateCount = selectedStories.filter((s) => s.section === 'SKATE').length;
  if (localCount > 1) {
    issues.push(
      `SOURCES must include at most 1 LOCAL (Timberwolves) story; got ${localCount}.`
    );
  }
  if (skateCount > 1) {
    issues.push(`SOURCES must include at most 1 SKATE story; got ${skateCount}.`);
  }
  if (localCount >= 1 && skateCount >= 1) {
    issues.push(
      'SOURCES must include **at most one** sports story total: [LOCAL] **or** [SKATE], never both.'
    );
  }
  const hasWolvesSelected = selectedStories.some((s) => s.section === 'LOCAL');
  const hasSkateSelected = selectedStories.some((s) => s.section === 'SKATE');
  if (cultureMode === 'LOCAL' && !hasWolvesSelected) {
    issues.push(
      'CULTURE_SECTION_MODE=LOCAL requires one LOCAL (Timberwolves) source with a valid URL.'
    );
  }
  if (cultureMode === 'SKATE' && !hasSkateSelected) {
    issues.push(
      'CULTURE_SECTION_MODE=SKATE requires one SKATE source with a valid URL.'
    );
  }
  if (
    shouldRequireSkateBeat &&
    !hasSkateSelected &&
    !onAirReferencesWolvesBeat(modelText)
  ) {
    issues.push(
      'Skate cadence rule: include one SKATE story in SOURCES this run (waived when ON AIR references Wolves — keep [LOCAL] only).'
    );
  }
  // Bidirectional section lock: SOURCES ↔ ON AIR (avoid Wolves URL with no VO line, or VO skate with no URL).
  if (!hasWolvesSelected && onAirReferencesWolvesBeat(modelText)) {
    issues.push('ON AIR mentions Wolves but SOURCES does not include a LOCAL story.');
  }
  if (!hasSkateSelected && onAirReferencesSkateBeat(modelText)) {
    issues.push(
      'ON AIR covers a skate beat but SOURCES does not include a SKATE story — add that number or remove the skate copy.'
    );
  }
  if (hasWolvesSelected && !onAirReferencesWolvesBeat(modelText)) {
    issues.push(
      'SOURCES includes [LOCAL] (Timberwolves) but ON AIR does not mention Wolves — cover that pick or replace it in <<<SOURCES>>>.'
    );
  }
  if (hasSkateSelected && !onAirReferencesSkateBeat(modelText)) {
    issues.push(
      'SOURCES includes [SKATE] but ON AIR does not cover the skate beat — write one spoken sentence (say skate/skateboarding or the outlet, e.g. Thrasher); a label-only “SKATEBOARDING BEAT —” header does not count.'
    );
  }
  if (/\blake street\b/i.test(onAir)) {
    issues.push('ON AIR must not mention Lake Street.');
  }
  if (/\blynx\b/i.test(onAir)) {
    issues.push('ON AIR must not mention Lynx.');
  }
  const paraBlocks = countParagraphBlocksBeforeSignoff(onAir);
  const maxAllowedParaBlocks = TARGET_SOURCE_STORIES + 2;
  if (paraBlocks < TARGET_SOURCE_STORIES) {
    issues.push(
      `ON AIR structure: use **one paragraph per <<<SOURCES>>> beat** (blank line between beats, another before the Linden Hills close). Found ${paraBlocks} paragraph block(s) before sign-off; need **at least ${TARGET_SOURCE_STORIES}** — do not merge multiple numbered picks into one “roundup” paragraph (even if they share a brand like Apple).`
    );
  }
  if (paraBlocks > maxAllowedParaBlocks) {
    issues.push(
      `ON AIR structure: ${paraBlocks} paragraph block(s) before sign-off — max **${maxAllowedParaBlocks}** (${TARGET_SOURCE_STORIES} sourced beats + neighborhood close). Drop extra beats or merge padding; cover **only** <<<SOURCES>>> rows.`
    );
  }
  issues.push(...validateUnsourcedBrandMentions(onAir, selectedStories));
  issues.push(...validateBannedOnAirPadding(onAir));
  issues.push(...validateStoryAnchorsInOnAir(onAir, selectedStories));
  const bizMentions = countBusinessMentions(onAir, localBizName);
  if (bizMentions !== 1) {
    issues.push(`ON AIR must mention "${localBizName}" exactly once; got ${bizMentions}.`);
  }
  const beatCount = countApproxNewsBeats(onAir);
  // Allow an extra paragraph for neighborhood close splits + injected culture lines vs strict one-block close.
  const maxAllowedBeats = TARGET_SOURCE_STORIES + 2;
  if (beatCount > maxAllowedBeats) {
    issues.push(
      `ON AIR appears to contain too many beats (${beatCount}); keep to ${TARGET_SOURCE_STORIES} story beats plus close.`
    );
  }
  const words = countOnAirWords(onAir);
  const { min: onAirMin, max: onAirMax } = onAirWordBounds();
  if (words > onAirMax) {
    issues.push(
      `ON AIR is too long (${words} words); trim so total between START and END is ${onAirMin}–${onAirMax} words (editorial target ~125–175 after injections — drop clauses per beat if needed).`
    );
  }
  if (words < onAirMin) {
    issues.push(
      `ON AIR is too short (${words} words); expand to ${onAirMin}–${onAirMax} words (editorial target ~125–175 — add one concrete detail per beat where thin).`
    );
  }
  const editorialMax = Math.min(
    onAirMax,
    Math.max(
      onAirMin + 40,
      parseInt(process.env.ON_AIR_EDITORIAL_MAX_WORDS ?? '185', 10) || 185
    )
  );
  if (words > editorialMax && words <= onAirMax) {
    issues.push(
      `ON AIR is wordy (${words} words); editorial target is ${onAirMin}–${editorialMax} between START and END — trim filler and one clause per beat before retrying.`
    );
  }
  issues.push(...validateCultureBeatPlacement(selectedStories));
  return issues;
}

/**
 * Lighter validation for PICK_MODE: the editor already chose the lineup, so we
 * skip composition rules (section caps, sports slot, skate cadence) and keep only
 * the writing-quality gates — structure, business mention, banned padding,
 * per-story anchors, and a story-count-scaled word budget.
 */
function validatePickModeOutput(
  onAir: string,
  localBizName: string,
  selectedStories: Collected[],
  targetCount: number
): string[] {
  const issues: string[] = [];
  if (/\blake street\b/i.test(onAir)) {
    issues.push('ON AIR must not mention Lake Street.');
  }
  if (/\blynx\b/i.test(onAir)) {
    issues.push('ON AIR must not mention Lynx.');
  }
  const paraBlocks = countParagraphBlocksBeforeSignoff(onAir);
  const maxAllowedParaBlocks = targetCount + 2;
  if (paraBlocks < targetCount) {
    issues.push(
      `ON AIR structure: use **one paragraph per picked story** (blank line between beats, another before the Linden Hills close). Found ${paraBlocks} paragraph block(s) before sign-off; need **at least ${targetCount}** — do not merge picks into one paragraph.`
    );
  }
  if (paraBlocks > maxAllowedParaBlocks) {
    issues.push(
      `ON AIR structure: ${paraBlocks} paragraph block(s) before sign-off — max **${maxAllowedParaBlocks}** (${targetCount} picked beats + neighborhood close). Cover **only** the picked stories.`
    );
  }
  issues.push(...validateUnsourcedBrandMentions(onAir, selectedStories));
  issues.push(...validateBannedOnAirPadding(onAir));
  issues.push(...validateStoryAnchorsInOnAir(onAir, selectedStories));
  const bizMentions = countBusinessMentions(onAir, localBizName);
  if (bizMentions !== 1) {
    issues.push(`ON AIR must mention "${localBizName}" exactly once; got ${bizMentions}.`);
  }
  const beatCount = countApproxNewsBeats(onAir);
  if (beatCount > targetCount + 2) {
    issues.push(
      `ON AIR appears to contain too many beats (${beatCount}); keep to ${targetCount} story beats plus close.`
    );
  }
  const words = countOnAirWords(onAir);
  const { min, max } = pickModeWordBounds(targetCount);
  if (words > max) {
    issues.push(
      `ON AIR is too long (${words} words); trim so total between START and END is ${min}–${max} words.`
    );
  }
  if (words < min) {
    issues.push(
      `ON AIR is too short (${words} words); expand to ${min}–${max} words (one concrete detail per beat where thin).`
    );
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

function findLastCoreSlotPosition(
  indices: number[],
  collected: Collected[]
): number {
  for (let pos = indices.length - 1; pos >= 0; pos--) {
    const c = collected[indices[pos] - 1];
    if (
      c?.section === 'TECH' ||
      c?.section === 'REPAIR' ||
      c?.section === 'HARDWARE'
    ) {
      return pos;
    }
  }
  return -1;
}

function enforceSourceSectionCaps(
  indices: number[],
  collected: Collected[],
  targetCount: number
): number[] {
  /** At most one sports slot per episode: Timberwolves **or** skate, never both. */
  let keptSports = 0;
  const keep: number[] = [];
  const seen = new Set<number>();

  for (const idx of indices) {
    if (keep.length >= targetCount) break;
    if (!Number.isFinite(idx)) continue;
    const n = Math.trunc(idx);
    if (n < 1 || n > collected.length) continue;
    if (seen.has(n)) continue;
    const c = collected[n - 1];
    if (!c) continue;

    if (c.section === 'LOCAL' || c.section === 'SKATE') {
      if (keptSports >= 1) continue;
      keptSports++;
    }
    seen.add(n);
    keep.push(n);
  }

  if (keep.length >= targetCount) return keep;

  // Top up using newest-first collected list order; still max one [LOCAL]/[SKATE].
  for (let i = 1; i <= collected.length && keep.length < targetCount; i++) {
    if (seen.has(i)) continue;
    const c = collected[i - 1];
    if (!c) continue;
    if (!c.link) continue;
    if ((c.section === 'LOCAL' || c.section === 'SKATE') && keptSports >= 1) {
      continue;
    }
    if (c.section === 'LOCAL' || c.section === 'SKATE') keptSports++;
    seen.add(i);
    keep.push(i);
  }

  return keep;
}

/**
 * Ensure every selected source has a usable URL so beat count stays aligned
 * with SOURCE LINKS.
 */
function enforceSourcesHaveLinks(
  indices: number[],
  collected: Collected[],
  targetCount: number
): number[] {
  const withLinks = indices.filter((idx) => {
    const c = collected[idx - 1];
    return !!c?.link?.trim();
  });
  return enforceSourceSectionCaps(withLinks, collected, targetCount);
}

function weeklySkateCadenceDays(): number {
  return Math.min(
    14,
    Math.max(1, parseInt(process.env.WEEKLY_SKATE_CADENCE_DAYS ?? '7', 10) || 7)
  );
}

function hasRecentSkateBeat(
  recentLog: AirLogEntry[],
  nowMs: number,
  windowDays: number
): boolean {
  const windowMs = windowDays * 24 * 60 * 60 * 1000;
  return recentLog.some((e) => {
    if (e.section !== 'SKATE') return false;
    const d = parseDateSafe(e.airedAt);
    return d ? nowMs - d.getTime() <= windowMs : false;
  });
}

/**
 * Weekly cadence guardrail: if skate is due and we have a valid skate candidate,
 * ensure one SKATE story is present in SOURCES.
 *
 * When the draft ON AIR already references **Wolves**, do **not** inject or swap in skate —
 * the VO locked to basketball would lose its [LOCAL] URL if we replaced that slot on a second pass.
 */
function enforceWeeklySkateCadence(
  indices: number[],
  collected: Collected[],
  targetCount: number,
  shouldRequireSkateBeat: boolean,
  onAirDraft?: string
): number[] {
  if (!shouldRequireSkateBeat) return indices;
  const air = onAirDraft?.trim() ?? '';
  if (air && onAirReferencesWolvesBeat(air)) {
    return indices;
  }
  if (indices.some((idx) => collected[idx - 1]?.section === 'SKATE')) return indices;

  const selected = new Set(indices);
  let skateIdx = -1;
  for (let i = 1; i <= collected.length; i++) {
    if (selected.has(i)) continue;
    const c = collected[i - 1];
    if (!c?.link?.trim()) continue;
    if (c.section !== 'SKATE') continue;
    skateIdx = i;
    break;
  }
  if (skateIdx < 0) return indices;

  const out = [...indices];
  const localPos = out.findIndex((idx) => collected[idx - 1]?.section === 'LOCAL');
  if (localPos >= 0) {
    out[localPos] = skateIdx;
    return enforceSourceSectionCaps(out, collected, targetCount);
  }

  let replaceAt = findLastCoreSlotPosition(out, collected);
  if (replaceAt < 0) {
    for (let pos = out.length - 1; pos >= 0; pos--) {
      const c = collected[out[pos] - 1];
      if (c?.section !== 'LOCAL') {
        replaceAt = pos;
        break;
      }
    }
  }
  if (replaceAt < 0) replaceAt = out.length - 1;
  if (replaceAt >= 0) out[replaceAt] = skateIdx;
  return enforceSourceSectionCaps(out, collected, targetCount);
}

/**
 * If ON AIR explicitly references Wolves/Timberwolves, ensure one LOCAL source
 * is present so section locks and blog rows stay aligned.
 */
function enforceWolvesSourceWhenMentioned(
  indices: number[],
  collected: Collected[],
  targetCount: number,
  onAir: string,
  preserveSkateForWeeklyCadence: boolean
): number[] {
  if (!onAirReferencesWolvesBeat(onAir)) return indices;
  if (indices.some((idx) => collected[idx - 1]?.section === 'LOCAL')) return indices;

  const selected = new Set(indices);
  let localIdx = -1;
  for (let i = 1; i <= collected.length; i++) {
    if (selected.has(i)) continue;
    const c = collected[i - 1];
    if (!c?.link?.trim()) continue;
    if (c.section !== 'LOCAL') continue;
    localIdx = i;
    break;
  }
  if (localIdx < 0) return indices;

  const out = [...indices];
  let replaceAt = out.findIndex((idx) => collected[idx - 1]?.section === 'SKATE');
  if (replaceAt < 0 && preserveSkateForWeeklyCadence) {
    replaceAt = findLastCoreSlotPosition(out, collected);
  }
  if (replaceAt < 0) replaceAt = out.length - 1;
  if (replaceAt >= 0) out[replaceAt] = localIdx;
  return enforceSourceSectionCaps(out, collected, targetCount);
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
  /** Skate sites often post a few times a week — 18h drops the whole lane most mornings. */
  SKATE: 72,
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

async function runNewsAgent() {
  /** Fewer items per feed = tighter scripts (override with FEED_ITEM_LIMIT). */
  const perFeed = Math.min(
    20,
    Math.max(1, parseInt(process.env.FEED_ITEM_LIMIT ?? '4', 10) || 4)
  );

  const cultureMode = cultureSectionMode();
  // Pick mode shows everything fresh, so always pull both culture lanes regardless of CULTURE_SECTION_MODE.
  const pickModeFetch = process.env.PICK_MODE?.trim() === '1';
  const fetchSkate = pickModeFetch || cultureMode !== 'LOCAL';
  const fetchLocal = pickModeFetch || cultureMode !== 'SKATE';

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
    // WordPress (may change; parser will warn if broken)
    'https://www.jenkemmag.com/feed/',
    // Quartersnacks /feed/ 301s to HTML — no usable RSS; replaced with working feeds:
    'https://www.freeskatemag.com/feed/',
    'https://www.skateboarding.com/feed',
    // The Berrics
    'https://theberrics.com/feed/',
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
  if (fetchSkate) await pull(skateFeeds, 'SKATE');
  if (fetchLocal) await pull(localFeeds, 'LOCAL');

  if (fetchLocal) {
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

  // PICK_MODE=1: the editor cherry-picks stories in a local web picker. Rules become
  // advisory badges (everything fresh is shown); Gemini just writes for the chosen set.
  const pickMode = process.env.PICK_MODE?.trim() === '1';

  // Cross-day anti-repeat memory + skate cadence (shared by normal + pick mode).
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
  const skateCadenceDays = weeklySkateCadenceDays();
  const skateBeatRecentlyAired = pickMode
    ? false
    : hasRecentSkateBeat(recentLog, now, skateCadenceDays);

  const recentlyAired = (c: Collected): boolean => {
    const fp = titleFingerprint(c.title);
    const pk = productKey(c.title);
    const repeats = recentLog.filter(
      (e) => e.fingerprint === fp || (pk && e.productKey === pk)
    );
    return repeats.some((e) => {
      const d = parseDateSafe(e.airedAt);
      return d ? now - d.getTime() < cooldownMs : false;
    });
  };

  if (pickMode) {
    console.log(
      `PICK_MODE=1 — showing every fresh candidate (Bitcoin-only / editorial-scope / cooldown drops are advisory only); ${collected.length} fresh candidate(s).`
    );
  } else {
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
    collected = collected.filter((c) => {
      if (!recentlyAired(c)) return true;
      return hasReturnTrigger(c.title);
    });
  }

  if (!collected.length) {
    throw new Error(
      'All candidate stories were filtered out by freshness, editorial scope, Bitcoin-only currency rule, undated items (set ALLOW_UNDATED_FEED_ITEMS=1 only if a feed omits dates), or repeat rules. Try MAX_STORY_AGE_HOURS_* , BITCOIN_ONLY_CURRENCY_RULE=0, or STORY_REPEAT_COOLDOWN_DAYS.'
    );
  }

  // Newest-first in the numbered list so the freshest headlines lead.
  collected.sort((a, b) => {
    const ta = parseDateSafe(a.date)?.getTime() ?? Number.NEGATIVE_INFINITY;
    const tb = parseDateSafe(b.date)?.getTime() ?? Number.NEGATIVE_INFINITY;
    return tb - ta;
  });

  // Pick mode: hand the fresh candidate list to the local web picker and let the editor cherry-pick.
  let pickedIndices: number[] = [];
  if (pickMode) {
    const { pickArticlesInteractive } = await import('./lib/article_picker');
    const candidates = collected.map((c, i) => {
      const d = parseDateSafe(c.date);
      const ageHours = d ? (now - d.getTime()) / 3_600_000 : null;
      const flags: string[] = [];
      if (!passesBitcoinOnlyCurrencyRule(c.title)) flags.push('non-bitcoin');
      if (!passesEditorialScopeRule(c)) flags.push('off-scope');
      if (recentlyAired(c) && !hasReturnTrigger(c.title)) flags.push('recently aired');
      if (!c.link) flags.push('no link');
      return {
        index: i + 1,
        section: c.section,
        feedTitle: c.feedTitle,
        title: c.title,
        link: c.link,
        date: c.date,
        ageHours,
        flags,
      };
    });
    pickedIndices = await pickArticlesInteractive(candidates, {
      dateLabel: getChicagoEpisodeNow().toLocaleDateString('en-US', {
        timeZone: 'America/Chicago',
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      }),
    });
    if (!pickedIndices.length) {
      throw new Error('No articles selected in the picker — nothing to generate.');
    }
    // Source links / blog rows need a real URL; drop any "no link" picks so the
    // story count stays consistent with what Gemini writes and what gets published.
    const droppedNoLink = pickedIndices.filter(
      (idx) => !collected[idx - 1]?.link?.trim()
    );
    if (droppedNoLink.length) {
      pickedIndices = pickedIndices.filter(
        (idx) => !!collected[idx - 1]?.link?.trim()
      );
      console.warn(
        `Picked stor${droppedNoLink.length === 1 ? 'y' : 'ies'} with no URL dropped (can't build source links): ${droppedNoLink.join(', ')}`
      );
    }
    if (!pickedIndices.length) {
      throw new Error(
        'All selected articles were missing URLs — nothing publishable to generate.'
      );
    }
    console.log(
      `Editor picked ${pickedIndices.length} stor${pickedIndices.length === 1 ? 'y' : 'ies'}: ${pickedIndices.join(', ')}`
    );
  }

  // Flexible count in pick mode; fixed lineup otherwise.
  const targetSourceStories = pickMode
    ? pickedIndices.length
    : TARGET_SOURCE_STORIES;

  // Prompt lists only the editor's picks (renumbered 1..N) in pick mode; the full pool otherwise.
  const promptStoryRows = pickMode
    ? pickedIndices.map((idx) => collected[idx - 1]!)
    : collected;
  const storyListText = promptStoryRows
    .map((c, i) => {
      const n = i + 1;
      const url = c.link || '(no URL in feed)';
      return `${n}. [${c.section}] ${c.title}\n   URL: ${url}`;
    })
    .join('\n\n');

  const hasSkate = collected.some((c) => c.section === 'SKATE');
  const shouldRequireSkateBeat =
    cultureMode !== 'LOCAL' && hasSkate && !skateBeatRecentlyAired;

  const cultureRule =
    cultureMode === 'SKATE'
      ? '- **Sports slot (forced):** Include **exactly one [SKATE]** beat (when any skate item exists). **Do not** include **[LOCAL]** Timberwolves on this run.'
      : cultureMode === 'LOCAL'
        ? '- **Sports slot (forced):** Include **exactly one [LOCAL]** Timberwolves beat (when any Wolves item exists). **Do not** include **[SKATE]** on this run.'
        : shouldRequireSkateBeat
          ? `- **Sports slot (weekly cadence):** Include **exactly one [SKATE]** beat this run (no skate aired in the last ${skateCadenceDays} days). Do **not** also pick **[LOCAL]** — one sports story total.`
          : '- **Sports slot (one only):** Include **at most one** sports story in **<<<SOURCES>>>**: either **one [LOCAL]** (Timberwolves) **or** **one [SKATE]** — **never both**. Prefer **[SKATE]** when it’s fresh and strong; otherwise a fresh **Wolves** pick; if neither deserves air, use **four core-only** picks (**[REPAIR]/[TECH]/[HARDWARE]** only).';

  const storyPickRule = `- **<<<SOURCES>>> length = slide count:** Pick **exactly ${TARGET_SOURCE_STORIES} story numbers** total (**never ${TARGET_SOURCE_STORIES + 1}+**).
- **Lineup shape:** Always **${TARGET_SOURCE_STORIES} picks**. Either (**A**) **three [REPAIR]/[TECH]/[HARDWARE]** + **one sports** pick (**exactly one [LOCAL]** *or* **exactly one [SKATE]** — **never both**), **or** (**B**) **four core-only** picks (all **[REPAIR]/[TECH]/[HARDWARE]** when Wolves/skate don’t earn air). Prefer repair-first when it’s strong.
- **Neighborhood business:** The Linden Hills close names **one local shop** (chosen by the system). That mention is **not** a numbered story — it comes **after** your four sourced beats in ON AIR only.
- **Freshest wins:** **NUMBERED STORIES** below are sorted **newest-first**. When several headlines are similarly strong, prefer the **newer** item.
- ${cultureRule}
- **Sports placement:** If your four picks include **[LOCAL]** or **[SKATE]**, that number must be **first or last** in **<<<SOURCES>>>** (usually **last**, immediately before the neighborhood close). **Never** put sports **between** two core beats.
- **Hardware:** Only when it clearly earns it — don’t force gadget filler.`;

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

  const segmentOrderBlock = `**SEGMENT ORDER — ${TARGET_SOURCE_STORIES} numbers in <<<SOURCES>>>**, then neighborhood close (not numbered):
1) **Three core beats** — **[REPAIR]**/**[TECH]**/**[HARDWARE]** only (repair-first when it’s strong; spread AI/software/hardware/Bitcoin-as-news across those three picks — thin bench, no redundancy).
2) **Optional fourth flavor:** Either (**a**) **one sports beat only** — **exactly one [LOCAL]** *or* **exactly one [SKATE]** (**never both**) placed **first or last** in your comma list (usually **last** before close), **or** (**b**) a **fourth core** pick instead — four headlines all **[REPAIR]/[TECH]/[HARDWARE]** when Wolves/skate don’t earn air.
3) **CLOSE** — Linden Hills color + **one spoken mention** of today’s neighborhood business (see block below), then fixed END lines.`;

  // No-AI-slop writing rules (adapted for spoken VO + social caption) — based on
  // github.com/realrossmanngroup/no_ai_slop_writing_rules. Keep both prompts in sync.
  const antiSlopRules = `- **No-AI-slop writing (ON AIR and social — sound like a person at the bench, not a model):**
  - **No contrast clichés:** never "it's not X, it's Y," "this isn't X, it's Y," or "the issue isn't X, it's Y." Just say what the thing is.
  - **No hollow profundity / inflated symbolism:** drop "a stark reminder," "a testament to," "watershed moment," "left its mark," "ushers in a new era," "game-changer," "the future of." Say the concrete fact instead (a number, vendor, part, date).
  - **No empty intensifiers / filler:** cut "significantly," "dramatically," "incredibly," "truly," "really," "very," "basically," "essentially," "literally," "absolutely." Replace with the actual figure or detail.
  - **No marketing verbs/adjectives:** avoid "delve," "leverage," "utilize," "unveil," "underscore," "streamline," plus "robust," "seamless," "cutting-edge," "groundbreaking," "revolutionary." Use plain words (use, show, reveal, strong, new).
  - **No rhetorical colon hooks:** never "here's the thing," "the bottom line," "the reality," "the kicker," "plot twist."
  - **End each beat on a real detail** (a number, vendor, part, price, or date) — not on a line saying something "matters" or is "huge."
  - **Vary sentence length:** mix short punches with longer lines; don't write every beat the same shape.
  - **Social caption:** no em dashes (use commas/periods), apply all of the above, plain sentence case.`;

  const pickSourcesLine = pickedIndices.map((_, i) => i + 1).join(',');
  const pickWordBounds = pickModeWordBounds(targetSourceStories);
  const pickPrompt = `
You are a **direct, plain-spoken** tech reporter at your repair bench in Linden Hills (Minneapolis) — calm morning desk, not hype.

The editor hand-picked today's stories. Cover **every one**, **one beat each**, in the **order given** — do not add, drop, merge, or reorder.

EDITOR-PICKED STORIES (numbered 1..${targetSourceStories}, in on-air / slide order):
${storyListText}

QUALITY RULES:
- **Cover all ${targetSourceStories}, one beat each, in order.** Each numbered story gets **its own paragraph** with at least one distinctive keyword from that headline. Never merge two picks into one paragraph (even if they share a brand like Apple).
- **<<<SOURCES>>>:** output exactly \`${pickSourcesLine}\` (every listed number, in order).
- **Cover the headline as written.** If a pick is a Timberwolves story, say Timberwolves / Wolves; if it's a skate story, say skate/skateboarding or the outlet (e.g. Thrasher). Do not invent products, prices, or dates.
- **Recency:** treat each as today's desk; don't frame as "yesterday/overnight." If a headline carries an old year, frame as "making the rounds again," not fresh news.
- **Length (non-negotiable):** one vertical take, calm read — ${targetSourceStories} sourced beats plus neighborhood close. Budget ~${pickWordBounds.min}–${pickWordBounds.max} spoken words between the fixed START and END lines (ALL CAPS reads slow — stay lean). If over budget, shorten each beat before dropping the **${localBizName}** mention.
- **No extra headlines:** cover **only** the ${targetSourceStories} picked stories. No bonus or side mentions.
- **One pick = one beat (hard):** each numbered story is a different URL / slide; give each its own paragraph.
- **Banned hype / podcast clichés (ON AIR and social — never say or echo):** "hold on to your hat(s)," "buckle up," "deep dive," "let's dive in," "fire hose," "grab your popcorn," "you won't believe," "crazy," "insane" (unless the headline literally uses it), "first up," "meanwhile," "next up," "finally," "wrapping up," "on the hardware front," "speaking of hardware," "that's the tech wrap," or any "fasten your seatbelts" padding. Sound like a colleague at the bench, not a trailer voice.
${antiSlopRules}
- **Local business (every episode):** after your ${targetSourceStories} beats, the ON AIR close **must** name **${localBizName}** once (see LINDEN HILLS block) — not filler.

You are writing for one **on-air column only** (teleprompter / VO).
${localColorBlock}

**COLUMN B — ON AIR (teleprompter / voiceover — spoken words only):**
- **ALL CAPS.** Each story is **1–3 short lines** max **inside its own paragraph** (one paragraph per picked story): headline essence + **why it matters** + one concrete detail only when it fits. No long paragraphs, **no multi-story mashups**.
- **Single continuous take** — flows straight through after the open; no "coming up / we've also got" runway; no "first story / next up / finally / meanwhile" padding.
- **Do not** put [B-ROLL] or shot notes in ON AIR.
- START exactly: LIVE FROM THE BENCH IN LINDEN HILLS, I'M KYLE. AND WE'VE GOT A LOT HITTING THE SHOP TODAY.
- **Enunciation (INLINE):** phonetic in parentheses on first mention only next to the word — short; stress in ALL CAPS. Examples: OPENAI (oh-PEN-eye). Real acronyms spelled: A I, G P U.
- **Close:** after your last news beat, before the two fixed END lines: one tight ALL CAPS line (two only if still under word budget) mixing Linden Hills color with **${localBizName}** spoken once by name (required — see LINDEN HILLS block). A light plug is okay; keep it specific to business type, no hard sell.
- END exactly (literal, final two sentences of ON AIR): BACK TO THE SOLDERING IRON. CATCH YOU TOMORROW.

---

**OUTPUT FORMAT (exactly three blocks, in this order — use these marker lines literally):**

<<<ON_AIR>>>
(ALL CAPS — one calm take, ~${pickWordBounds.min}–${pickWordBounds.max} words between START and END; spoken order matches the numbered list beat-for-beat, then neighborhood close with **${localBizName}** once before **BACK TO THE SOLDERING IRON**.)

<<<SOURCES>>>
(Exactly one line: \`${pickSourcesLine}\` — every picked number in order.)

<<<SOCIAL>>>
(**Body text only** — no "Tech News Daily with Kyle · date" line, no hashtags (the system adds one row). Max ~280 characters. Clean grammar, real sentences, **sentence case** (capitalize first word + proper nouns only), no ALL CAPS. Standard tech spellings fine (OpenAI, iPhone, GPU). 1–2 tight sentences echoing **specific topics** you actually covered — not generic filler.)
`;

  const normalPrompt = `
You are a **direct, plain-spoken** tech reporter at your repair bench in Linden Hills (Minneapolis) — calm morning desk, not hype. You cover **Apple** when a numbered headline warrants it — never stitch multiple Apple URLs into one VO beat.

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
- **Section/source lock (bidirectional):** **[LOCAL]** in **<<<SOURCES>>>** ↔ you **must** mention Timberwolves / **Wolves** on air for that beat. **[SKATE]** in **<<<SOURCES>>>** ↔ you **must** cover that skate story on air (say **skate/skateboarding** or the outlet, e.g. **Thrasher**). Do **not** list a Wolves URL if you did not speak Wolves; do **not** speak a skate beat without a **[SKATE]** number in **<<<SOURCES>>>**.
- **Length (non-negotiable):** One vertical take **~75–85 seconds** at a calm read — **four** sourced beats plus neighborhood close. **Budget ~125-175 spoken words** between the fixed START line and the fixed END lines (ALL CAPS reads slow — stay lean). **If you are over budget, shorten each beat** before you drop the **${localBizName}** mention.
- **No extra headlines:** In **ON AIR**, cover **only** the stories whose numbers you list in **<<<SOURCES>>>**. No bonus or side mentions outside those ${TARGET_SOURCE_STORIES} picks.
- **One pick = one beat (hard):** Each comma-separated number in **<<<SOURCES>>>** is a **different URL**. Give each pick **its own paragraph** with **at least one distinctive keyword from that headline** (product codename, regulator, app name, etc.). **Never** run three Apple items (or any brand) back-to-back inside **one** paragraph — that reads like one beat but corresponds to three slides / three links.
- **Vendor fidelity:** Name **Meta**, **TSMC**, etc. **only** when that exact sourced headline is about them (same numbered row). No drive-by chip-industry color unless one of your four picks is that story.
- **Paragraph breaks:** Put a **blank line between every SOURCES beat** and **before** the Linden Hills / **${localBizName}** close — teleprompter paragraphs map 1:1 to slides.
- **Tight but not thin:** On **main** beats only, add **one concrete detail** when the headline gives you something real (a number, vendor, mechanism) — **no** filler, **no** essay transitions (“building on that,” “wrapping up,” **“first up,” “meanwhile,” “on the hardware front,” “that's the tech wrap,”** “let’s unpack,” **“let’s dive in,”** **“deep dive,”** **“we’ll unpack”**). **Visuals:** screenshot stills only; never promise a full preview or live site scroll; say “on the screenshot” / “in the grab” if needed.
- **Banned hype / podcast clichés (ON AIR and social — never say or echo):** “hold on to your hat(s),” “buckle up,” “deep dive,” “let’s dive in,” “fire hose,” “grab your popcorn,” “you won’t believe,” “crazy,” “insane” (unless the headline literally uses it), **“first up,” “meanwhile,” “next up,” “finally,” “wrapping up,” “on the hardware front,” “speaking of hardware,” “that's the tech wrap,”** or **any** “fasten your seatbelts” style padding. Sound like a colleague at the bench, not a trailer voice.
${antiSlopRules}
- **Local business (every episode):** After your **four <<<SOURCES>>> beats**, the ON AIR close **must** name **${localBizName}** once (see **LINDEN HILLS** block) — **not** filler.

You are writing for one **on-air column only** (teleprompter / VO).

${segmentOrderBlock}
${localColorBlock}

**COLUMN B — ON AIR (teleprompter / voiceover — spoken words only):**
- **ALL CAPS.** Each **main** story (**REPAIR** + **TECH**/**HARDWARE**) is **1–3 short lines** max **inside its own paragraph** (one paragraph per **<<<SOURCES>>>** row): headline essence + **why it matters** + **one concrete detail** only when it fits without bloat (**skip** the detail if it forces wordiness). **SKATE** / **Wolves**: **≤2 short lines** each; often **one sentence** is enough. No long paragraphs, no recap of the whole web, **no multi-story mashups**.
- **Single continuous take** — write so it flows straight through after the open; **no** “coming up / we’ve also got” runway; no “first story / next up / finally / meanwhile / first up” padding; **no** “hold on to your hats,” **no** “deep dive,” **no** “buckle up” or similar.
- **Do not** put [B-ROLL] or shot notes in ON AIR.
- START exactly: LIVE FROM THE BENCH IN LINDEN HILLS, I'M KYLE. AND WE'VE GOT A LOT HITTING THE SHOP TODAY.
- **Enunciation (INLINE):** phonetic in parentheses **on first mention only** next to the word — short; stress in ALL CAPS. Examples: OPENAI (oh-PEN-eye). Real acronyms spelled: A I, G P U.
- **Close:** After your last **news** beat, **before** the two fixed END lines: **one** tight **ALL CAPS** line (two only if still under word budget) mixing **Linden Hills** color with **${localBizName}** spoken **once** by name (required — see LINDEN HILLS block). A **light plug** is okay, but keep it specific to business type and avoid hard sell / direct calls to action.
- END exactly (literal, final two sentences of ON AIR): BACK TO THE SOLDERING IRON. CATCH YOU TOMORROW.

---

**OUTPUT FORMAT (exactly three blocks, in this order — use these marker lines literally):**

<<<ON_AIR>>>
(ALL CAPS — one take **~75–85s**, **~125-175 words** between START and END; spoken order **matches <<<SOURCES>>>** beat-for-beat, then neighborhood close with **${localBizName}** once before **BACK TO THE SOLDERING IRON**.)

<<<SOURCES>>>
(Exactly **one line**: comma-separated **1-based story numbers** — **exactly ${TARGET_SOURCE_STORIES} numbers**. E.g. \`6,9,14,21\` = four core-only picks; \`6,9,14,3\` = three core + **one sports** pick (**check brackets**: **[LOCAL]** or **[SKATE]** exactly once among the four — never both). **Order = slide order** = email JPEG order = ON AIR beat order. Sports row (**[LOCAL]** or **[SKATE]**) must be **first or last** — usually **last** before the neighborhood close — never sandwiched between core beats.)

<<<SOCIAL>>>
(**Body text only** — do **not** repeat the “Tech News Daily with Kyle · date” line; do **not** include hashtags; the system adds one hashtag row automatically. Max **~280 characters**. Write **properly**: clean grammar, real sentences (no fragments), correct capitalization (no random lowercase “i”), and normal punctuation. **Write in sentence case** (normal Facebook / Instagram style): capitalize the first word and proper nouns only. **Do not** use ALL CAPS, title case for the whole paragraph, or fake emphasis — platforms flag shouty text as low quality. Standard tech spellings are fine (OpenAI, iPhone, GPU). No “link in bio,” no explaining screenshots. 1–2 tight sentences echoing **specific topics** you actually covered — product names, Wolves, skate, bench vibe — not generic filler.)
`;

  const prompt = pickMode ? pickPrompt : normalPrompt;

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
      const msg = data.error?.message ?? '';
      const retryableOverload =
        aiResponse.status === 429 ||
        aiResponse.status === 503 ||
        aiResponse.status === 502;
      if (retryableOverload && attempt < maxGeminiAttempts) {
        lastErr = msg;
        const waitSec =
          aiResponse.status === 429
            ? parseGeminiRetrySeconds(msg) ?? Math.min(15 * attempt, 90)
            : parseGeminiRetrySeconds(msg) ??
              Math.min(12 * attempt, 120);
        const label =
          aiResponse.status === 429
            ? '429 rate limit / quota'
            : `${aiResponse.status} overload / unavailable`;
        console.warn(
          `Gemini ${label}. Waiting ${Math.ceil(waitSec)}s — retry ${attempt + 1}/${maxGeminiAttempts}…`
        );
        await new Promise((r) => setTimeout(r, Math.ceil(waitSec * 1000)));
        continue;
      }
      if (!aiResponse.ok) {
        throw new Error(
          `Gemini API ${aiResponse.status}: ${msg || JSON.stringify(data)}`
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
        `Gemini: exhausted ${maxGeminiAttempts} attempts (429/503/502). Last error: ${lastErr || 'unknown'}`
      );
    }
    return raw;
  }

  const maxValidationRetries = Math.min(
    8,
    Math.max(1, parseInt(process.env.GEMINI_VALIDATION_RETRIES ?? '4', 10) || 4)
  );
  const onAirBoundsRetryHint = pickMode
    ? pickModeWordBounds(targetSourceStories)
    : onAirWordBounds();
  let rawOut = '';
  let fixedOnAir = '';
  let onAirForEmail = '';
  /** Parsed <<<VIDEO_PROMPT>>> when the model emits it (optional). */
  let geminiVideoPrompt = '';
  let indices: number[] = [];
  let finalSegments: FinalSegment[] = [];
  let modelSocial = '';
  let validationIssues: string[] = [];

  for (let pass = 1; pass <= maxValidationRetries + 1; pass++) {
    const requestText =
      pass === 1
        ? prompt
        : `${prompt}\n\nRETRY NOTE: Your last output violated hard rules.\n${validationIssues
            .map((i) => `- ${i}`)
            .join(
              '\n'
            )}\nRegenerate all three blocks now, following the exact markers.\n- **Word budget:** Between START and END lines only — aim for roughly ${onAirBoundsRetryHint.min}–${onAirBoundsRetryHint.max} spoken words so the total stays inside automation bounds.\n- If too long: shorten **every** beat before trimming the close.\n- If too short: one vivid detail per story beat (still ALL CAPS, calm bench tone).`;
    rawOut = await generateWithBackoff(requestText);
    const parsed = parseStudioOutput(rawOut, collected.length);
    fixedOnAir = parsed.onAir.trim();
    geminiVideoPrompt = parsed.videoPrompt.trim();
    modelSocial = parsed.social;
    onAirForEmail = ensureLocalBusinessInOnAir(fixedOnAir, localBizName);

    if (pickMode) {
      // Editor already chose the lineup — force it and skip composition enforcement.
      indices = pickedIndices;
      finalSegments = buildFinalSegments(indices, collected);
      const selectedStories = finalSegments.map((s) => s.row);
      validationIssues = validatePickModeOutput(
        onAirForEmail,
        localBizName,
        selectedStories,
        targetSourceStories
      );
    } else {
      const uniqParsed = toOrderedUniqueSourceIndices(
        parsed.indices,
        collected.length
      );
      indices = enforceSourceSectionCaps(
        uniqParsed,
        collected,
        TARGET_SOURCE_STORIES
      );
      indices = enforceWeeklySkateCadence(
        indices,
        collected,
        TARGET_SOURCE_STORIES,
        shouldRequireSkateBeat,
        fixedOnAir
      );
      indices = enforceSourcesHaveLinks(indices, collected, TARGET_SOURCE_STORIES);
      indices = enforceWolvesSourceWhenMentioned(
        indices,
        collected,
        TARGET_SOURCE_STORIES,
        fixedOnAir,
        shouldRequireSkateBeat
      );
      indices = enforceWeeklySkateCadence(
        indices,
        collected,
        TARGET_SOURCE_STORIES,
        shouldRequireSkateBeat,
        fixedOnAir
      );
      indices = enforceSourcesHaveLinks(indices, collected, TARGET_SOURCE_STORIES);
      const programmaticSourceFillIns = indices.filter(
        (i) => !uniqParsed.includes(i)
      );
      finalSegments = buildFinalSegments(indices, collected);
      const selectedStories = finalSegments.map((s) => s.row);
      validationIssues = validateStudioOutput(
        onAirForEmail,
        indices,
        localBizName,
        selectedStories,
        shouldRequireSkateBeat,
        cultureMode,
        fixedOnAir
      );
      const hasWolvesSelected = selectedStories.some((s) => s.section === 'LOCAL');
      const hasSkateSelected = selectedStories.some((s) => s.section === 'SKATE');
      if (onAirReferencesWolvesBeat(fixedOnAir) && !hasWolvesSelected) {
        validationIssues.push(
          'ON AIR mentions Wolves but final segment list has no LOCAL source row.'
        );
      }
      if (onAirReferencesSkateBeat(fixedOnAir) && !hasSkateSelected) {
        validationIssues.push(
          'ON AIR mentions skate but final segment list has no SKATE source row.'
        );
      }
      if (programmaticSourceFillIns.length) {
        const fillInMsg = `<<<SOURCES>>> required programmatic fill-in for story number(s) ${programmaticSourceFillIns.join(', ')} — emit exactly ${TARGET_SOURCE_STORIES} distinct valid indices with real URLs (at most one sports pick: [LOCAL] XOR [SKATE]; no duplicate numbers).`;
        if (pass <= maxValidationRetries) {
          validationIssues.push(fillInMsg);
        } else {
          console.warn(fillInMsg);
        }
      }
    }
    if (hasAdjacentDuplicateNewsParagraphs(fixedOnAir)) {
      validationIssues.push(
        `ON AIR has two consecutive duplicate story paragraphs — remove the repeated block; each of the ${targetSourceStories} story beats must cover a different pick.`
      );
    }
    if (!validationIssues.length) break;
    if (pass <= maxValidationRetries) {
      console.warn(
        `Gemini output failed validation (pass ${pass}/${maxValidationRetries + 1}); retrying:\n${validationIssues.join('\n')}`
      );
    }
  }

  if (!pickMode && validationIssues.length) {
    // Last-resort rescue: the most common cause of exhausting all retries is a
    // forced sports pick (weekly skate cadence / Wolves) that the model lists in
    // <<<SOURCES>>> but never *speaks* in ON AIR. autoRepairOnAirCultureMismatch
    // already injects a spoken "SKATEBOARDING BEAT —" / "TIMBERWOLVES BEAT —" line
    // for exactly this, but normally only runs after this throw. Apply it here and
    // re-validate so a flaky culture-beat alignment ships an episode instead of
    // hard-failing CI (no email at all).
    const rescued = autoRepairOnAirCultureMismatch(
      onAirForEmail,
      finalSegments,
      localBizName
    );
    const rescuedIssues = validateStudioOutput(
      rescued,
      indices,
      localBizName,
      finalSegments.map((s) => s.row),
      shouldRequireSkateBeat,
      cultureMode,
      rescued
    );
    if (!rescuedIssues.length) {
      console.warn(
        'Validation cleared via culture-beat auto-repair (injected spoken sports line) instead of failing — original issues:\n' +
          validationIssues.join('\n')
      );
      onAirForEmail = rescued;
      fixedOnAir = rescued;
      validationIssues = [];
    }
  }

  if (validationIssues.length) {
    throw new Error(
      'Validation failed after retries:\n' + validationIssues.join('\n')
    );
  }

  onAirForEmail = autoRepairOnAirCultureMismatch(
    onAirForEmail,
    finalSegments,
    localBizName
  );
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
    !pickMode && process.env.USE_ON_AIR_SOURCE_REORDER?.trim() === '1'
      ? reorderIndicesToMatchOnAir(indices, collected, fixedOnAir)
      : indices;
  if (
    !pickMode &&
    process.env.USE_ON_AIR_SOURCE_REORDER?.trim() === '1' &&
    orderedIndices.join(',') !== indices.join(',')
  ) {
    console.warn(
      `SOURCE ORDER: USE_ON_AIR_SOURCE_REORDER changed order from [${indices.join(', ')}] to [${orderedIndices.join(', ')}].`
    );
  }

  finalSegments = buildFinalSegments(orderedIndices, collected);
  const used = finalSegments.map((s) => s.row);

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

  if (!finalSegments.length) {
    console.warn(
      'No <<<SOURCES>>> line parsed — email will omit source links (check model output).'
    );
  } else {
    console.log(
      'Sources used for segment:',
      finalSegments.map((s) => s.storyIndex).join(', ')
    );
  }

  const localBizWebsiteResolved = normalizeWebsiteUrl(
    process.env.LOCAL_BIZ_WEBSITE?.trim() || pickedBiz.website?.trim() || ''
  );
  const hasLocalSpotlightLink =
    !!localBizWebsiteResolved && /^https?:\/\//i.test(localBizWebsiteResolved);

  /** Plain text: [SECTION] Title then URL on next line (matches FCP / slide workflow). */
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

  if (!localBizWebsiteResolved) {
    console.warn(
      'LOCAL SPOTLIGHT: No business website URL — set LOCAL_BIZ_WEBSITE or sync `website` from https://www.lindenhills.org/directory via npm run directory:sync.'
    );
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

  const skipResend = process.env.SKIP_RESEND?.trim() === '1';
  if (!skipResend) {
    if (!resendKey) {
      throw new Error('Set RESEND_API_KEY');
    }
    if (!toRaw) {
      throw new Error('Set RESEND_TO to your inbox (comma-separated ok).');
    }
  }

  const to = toRaw?.split(',').map((a) => a.trim()).filter(Boolean) ?? [];
  const resend = resendKey ? new Resend(resendKey) : null;

  const tickerLine = await getTickerData();

  const linksHeader =
    used.length > 0
      ? 'SOURCE LINKS (for this segment)'
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
  ]
    .filter((block) => block.length > 0)
    .join('\n');

  const emailHtml =
    `<div style="font-family:system-ui,sans-serif;max-width:760px;color:#111">` +
    tickerHtml +
    `<p style="font-size:12px;font-weight:700;letter-spacing:0.04em;color:#444;margin:0 0 0.5em">${escapeHtml(onAirHeader)}</p>` +
    `<pre style="white-space:pre-wrap;word-break:break-word;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;line-height:1.5;margin:0 0 1.5em;padding:12px;background:#fff;border-radius:8px;border:1px solid #ddd;user-select:all;-webkit-user-select:all">${escapeHtml(onAirForEmail.trim())}</pre>` +
    `<p style="font-size:12px;font-weight:700;letter-spacing:0.04em;color:#444;margin:0 0 0.5em">${escapeHtml(socialHeader)}</p>` +
    socialCaptionHtml +
    `<p style="font-size:12px;font-weight:700;letter-spacing:0.04em;color:#444;margin:0 0 0.5em">${escapeHtml(ytVerifyHeader)}</p>` +
    `<pre style="white-space:pre-wrap;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;line-height:1.5;margin:0 0 1.25em;padding:12px;background:#fefce8;border-radius:8px;border:1px solid #eab308;user-select:all;-webkit-user-select:all">${escapeHtml(ytVerifyLine)}</pre>` +
    `<p style="font-size:12px;font-weight:700;color:#444;margin:0 0 0.5em">${escapeHtml(linksHeader)}</p>` +
    `<div style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;line-height:1.45">${linksHtml}</div>` +
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

  if (skipResend) {
    console.log('SKIP_RESEND=1 — email skipped; continuing to web publish.');
  } else {
    for (const from of fromCandidates) {
      for (let attempt = 1; attempt <= resendMaxAttempts; attempt++) {
        const res = await resend!.emails.send({
          from,
          to,
          subject: `📺 Your News Script for ${getChicagoEpisodeNow().toLocaleDateString('en-US', { timeZone: 'America/Chicago' })}`,
          text: emailText,
          html: emailHtml,
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
  }

  const webDir = process.env.TECHNEWS_WEB_DIR?.trim();
  const instakyleNewsDir = process.env.TECHNEWS_INSTAKYLE_NEWS_DIR?.trim();
  const techNewsVideoUrl = process.env.TECHNEWS_VIDEO_URL?.trim() || null;

  if ((webDir || instakyleNewsDir) && used.length) {
    let localSpotlightForWeb: {
      websiteUrl: string;
      businessName: string;
    } | null = null;
    if (
      localBizWebsiteResolved &&
      /^https?:\/\//i.test(localBizWebsiteResolved)
    ) {
      localSpotlightForWeb = {
        websiteUrl: localBizWebsiteResolved,
        businessName: localBizName,
      };
    }

    const { writeTechNewsWebBundle } = await import('./web_publish');
    const bizForSeo: LocalBusiness = { ...pickedBiz, name: localBizName };
    const seoKeywords = buildSeoKeywords(bizForSeo, used);
    const webStories = finalSegments.map(({ storyIndex, row: c }) => ({
      storyIndex,
      section: mapSectionForBlog(c.section),
      title: c.title,
      link: c.link,
      publishedAt: c.date,
    }));
    await writeTechNewsWebBundle({
      ...(webDir ? { outDir: webDir } : {}),
      ...(instakyleNewsDir ? { instakyleNewsDir } : {}),
      tickerLine,
      socialCaption,
      videoPrompt: geminiVideoPrompt,
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

  if (finalSegments.length) {
    const newEntries: AirLogEntry[] = finalSegments
      .map((segment) => segment.row)
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

  console.log(
    skipResend
      ? 'Mission accomplished (web publish only).'
      : `Mission accomplished. Resend id: ${sendData?.id}`
  );
  if (linksText) {
    console.log('\n--- Segment links ---\n' + linksText);
  }
}

runNewsAgent().catch((err) => {
  console.error(err);
  process.exit(1);
});
