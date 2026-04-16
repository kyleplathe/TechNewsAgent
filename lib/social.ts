const THREADS_CAP = 500;

export const SOCIAL_READ_MORE_NEWS =
  'Read all the latest Tech News articles at instakyle.tech/news';

/** First line of Threads / Reels description (fixed branding + date). */
export function formatSocialHeadline(): string {
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

/** Keeps total length within Threads-style limits (~500 chars). */
export function finalizeSocialCaption(
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

export function stripHashtagLines(input: string): string {
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
 * Normalize model-provided social body text into clean "sentence case" prose.
 *
 * Goals:
 * - Avoid ALL CAPS / shouty output (downranked on Meta).
 * - Fix common spacing/capitalization drift (e.g. "i", missing spaces after periods).
 * - Restore common tech brand spellings (OpenAI, iPhone, GPU, etc.).
 */
export function normalizeSocialBodySentenceCase(body: string): string {
  const t = body.trim();
  if (!t) return '';

  let s = t;

  // If the model leaked ON AIR or otherwise shouted, downshift first.
  if (isMostlyUppercaseLatin(s)) s = s.toLowerCase();

  // Flatten to 1–2 readable sentences.
  s = s.replace(/\r\n/g, '\n');
  s = s.replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n');
  s = s.replace(/\n{2,}/g, '\n');
  s = s.replace(/\s+/g, ' ').trim();

  // Basic punctuation spacing.
  s = s.replace(/\s+([,.;:!?])/g, '$1');
  s = s.replace(/([,.;:!?])([A-Za-z])/g, '$1 $2');

  // Fix stray lowercase "i" pronoun forms.
  s = s.replace(/\bi(['’](?:m|ve|d|ll|re|s))\b/g, (_, suf: string) => `I${suf}`);
  s = s.replace(/\bi\b/g, 'I');

  // Capitalize first letter and sentence starts.
  s = s.replace(/^[^A-Za-z]*([a-z])/, (_, c: string) => c.toUpperCase());
  s = s.replace(
    /([.!?])\s+([a-z])/g,
    (_, end: string, c: string) => `${end} ${c.toUpperCase()}`
  );

  // Ensure it ends cleanly (avoid dangling fragments).
  if (/[A-Za-z0-9)]$/.test(s) && !/[.!?]$/.test(s)) s += '.';

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
  for (const [re, rep] of fixes) s = s.replace(re, rep);

  return s.trim();
}

