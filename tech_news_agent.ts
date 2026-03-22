import 'dotenv/config';
import { parseFeedUrl } from './feed';
import { Resend } from 'resend';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

type Collected = {
  section: 'TECH' | 'LOCAL' | 'HARDWARE';
  feedTitle: string;
  title: string;
  link: string;
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
  /** Hardware — Apple, Mac, PC, chips (dedicated slot in the script). */
  const hardwareFeeds = [
    'https://www.apple.com/newsroom/rss-feed.rss',
    'https://9to5mac.com/feed/',
    'https://www.tomshardware.com/feeds.xml',
  ];
  /** Local = Wolves only (no neighborhood paper — avoids non-tech city/gossip). */
  const localFeeds = ['https://www.canishoopus.com/rss/current.xml'];

  const collected: Collected[] = [];

  async function pull(
    urls: string[],
    section: 'TECH' | 'LOCAL' | 'HARDWARE'
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
  await pull(localFeeds, 'LOCAL');

  if (!collected.length) {
    throw new Error('No stories parsed from any feed — check URLs or network.');
  }

  const storyListText = collected
    .map((c, i) => {
      const n = i + 1;
      const url = c.link || '(no URL in feed)';
      return `${n}. [${c.section}] ${c.title}\n   URL: ${url}`;
    })
    .join('\n\n');

  const hasHardware = collected.some((c) => c.section === 'HARDWARE');

  const storyPickRule = hasHardware
    ? `- Pick **3–5** total beats across **[TECH]** and **[HARDWARE]** — **exactly one** must be your **hardware highlight** from **[HARDWARE]** numbered items; the rest from **[TECH]**. Skip weaker stories — depth beats a laundry list.`
    : `- Pick only the **3–5 strongest stories** to actually talk about. Skip the rest — depth beats a laundry list.`;

  const segmentOrderBlock = hasHardware
    ? `**SEGMENT ORDER (same in both columns — do not reorder):**
1) **TECH** first — general tech from **[TECH]** only (software, AI, industry, etc.).
2) **THEN EXACTLY ONE HARDWARE HIGHLIGHT** — pick **one** story from **[HARDWARE]** numbered items (phones, Macs, PCs, GPUs, wearables, accessories). Apple is a natural fit; other brands are welcome. **Older or “still relevant” headlines are fine** — not everything has to be from today.
3) **THEN WOLVES** (Timberwolves — from **[LOCAL]** RSS only).
4) **THEN LINDEN HILLS** neighborhood color (coffee, shops, Lake Harriet — spoken vibe, not city paper gossip).`
    : `**SEGMENT ORDER (same in both columns — do not reorder):**
1) **TECH** first (all tech beats).
2) **THEN WOLVES** (Timberwolves — from **[LOCAL]** RSS only).
3) **THEN LINDEN HILLS** neighborhood color (coffee, shops, Lake Harriet — spoken vibe, not city paper gossip).`;

  const beatOrderPhrase = hasHardware
    ? 'tech → hardware → Wolves → Linden Hills'
    : 'tech → Wolves → Linden Hills';

  const parityStories = hasHardware
    ? 'Decide your **3–5 covered stories** once (including **exactly one** from **[HARDWARE]**). **Every** story you speak in ON_AIR must have a **matching** VIDEO_PROMPT beat'
    : 'Decide your **3–5 covered stories** once. **Every** story you speak in ON_AIR must have a **matching** VIDEO_PROMPT beat';

  const sourcesHardwareNote = hasHardware
    ? `\n- The <<<SOURCES>>> line **must include at least one** index that points to a **[HARDWARE]** story (your single hardware highlight).`
    : '';

  const prompt = `
You are a punchy, high-energy tech news anchor filming from your repair shop in Linden Hills (Minneapolis). You’re **big on Apple** when it fits, but you’re a **general tech nerd** — phones, silicon, laptops, the whole bench.

NUMBERED STORIES FOR TODAY (each has a URL for your reference only — you cannot browse the web):
${storyListText}

QUALITY RULES:
${storyPickRule}
- If a headline includes a year like "(2024)", that is usually the article’s original date, not “breaking today.” Say “making the rounds” or “people are digging into…” unless it’s clearly new.
- Do not invent products, prices, or dates. Stay close to the headlines.
- **No celebrity gossip, city politics, or general government news** unless the headline is clearly **tech-related** (e.g. regulation of chips, AI, broadband).
- The only **local RSS** input is **Wolves / NBA** — use it for the basketball beat. **Linden Hills** — the shops, blocks, and neighborhood feel (near Lake Harriet, the usual haunts) — is **your on-camera color**, not something to pull from a city news feed.
- Keep it tight for **about 60 seconds** read aloud.

You are writing for a **small professional studio**: one column is the **video / post prompt** (for Final Cut), the other is **on-air copy** (teleprompter / VO only).

${segmentOrderBlock}

**LOCKSTEP PARITY (VIDEO_PROMPT and ON_AIR must match 1:1):**
- ${parityStories} (same company, product, headline topic, order). **No** B-roll, GFX, or domains in VIDEO_PROMPT for a story you do **not** say on air; **no** on-air beats that VIDEO_PROMPT does not cover.
- Use the **same beat order** in both columns (${beatOrderPhrase}). If you use sub-labels in VIDEO_PROMPT (e.g. TECH 1 / TECH 2), ON_AIR must follow that same sequence.
- VIDEO_PROMPT is the **edit map for this exact VO** — not a wish list. Do not add extra topics, products, or games in either column that the other column omits.

---

**COLUMN A — VIDEO PROMPT (for editor / Final Cut / screenshots):**
- Write like a **shot list + post brief**: numbered or short lines. Use clear labels: **CAM**, **B-ROLL**, **GFX**, **LOWER THIRD**, **FULL SCREEN**, **CUT**, **HOLD**, **SOT** if needed.
- Mirror ON_AIR **line-for-beat**: each spoken paragraph or block in ON_AIR should have a corresponding VIDEO_PROMPT line or mini-block **in the same order**.
- Reference URLs or domains where useful for grab/screenshot (e.g. “B-roll: homepage opencode.ai”) **only** for stories you also say on air.
- This block is **not** read on camera — it’s for **you / the edit**.

---

**COLUMN B — ON AIR (teleprompter / voiceover — spoken words only):**
- **ALL CAPS.** Short lines. **Do not put [B-ROLL] or shot notes here** — those belong in VIDEO PROMPT only.
- START exactly: LIVE FROM THE BENCH IN LINDEN HILLS, I'M KYLE. WE'VE GOT A LOT HITTING THE SHOP TODAY.
- **Enunciation:** After tricky names, one syllable guide in parens with stress in ALL CAPS: (oh-PEN-code), (MAM-buh). Spelled letters only for real acronyms (A I, G P U).
- END exactly: BACK TO THE SOLDERING IRON. CATCH YOU TOMORROW.

---

**OUTPUT FORMAT (exactly three blocks, in this order — use these marker lines literally):**

<<<VIDEO_PROMPT>>>
(Professional shot list / post brief — same stories and order as ON_AIR below. CAM, B-ROLL, GFX, LOWER THIRD, etc. Segment order: ${beatOrderPhrase}.)

<<<ON_AIR>>>
(ALL CAPS spoken script only — same stories and order as VIDEO_PROMPT above; no bracketed shot notes.)

<<<SOURCES>>>
(Exactly **one line** after this marker: comma-separated 1-based story numbers from the list above, e.g. 2,5,7 — no other text on that line.)${sourcesHardwareNote}
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

  const used = indices
    .map((i) => collected[i - 1])
    .filter(Boolean)
    .filter((c) => c.link);

  if (!videoPrompt.trim()) {
    console.warn(
      'No <<<VIDEO_PROMPT>>> block parsed — check model output for studio format.'
    );
  }
  if (!indices.length) {
    console.warn(
      'No <<<SOURCES>>> line parsed — email will omit screenshot links (check model output).'
    );
  } else {
    console.log('Sources used for segment (screenshots):', indices.join(', '));
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

  const videoHeader = 'VIDEO PROMPT (edit / Final Cut / post)';
  const onAirHeader = 'ON AIR (teleprompter / VO)';

  const emailText = [
    videoHeader,
    videoPrompt.trim() || '(none — check model output)',
    '',
    onAirHeader,
    finalScript.trim(),
    '',
    linksHeader,
    '',
    linksText || '(none)',
  ].join('\n');

  const emailHtml =
    `<div style="font-family:system-ui,sans-serif;max-width:760px;color:#111">` +
    `<p style="font-size:12px;font-weight:700;letter-spacing:0.04em;color:#444;margin:0 0 0.5em">${escapeHtml(videoHeader)}</p>` +
    `<pre style="white-space:pre-wrap;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;line-height:1.45;margin:0 0 1.5em;padding:12px;background:#f6f7f8;border-radius:8px;border:1px solid #e8e8e8">${escapeHtml(videoPrompt.trim() || '(none)')}</pre>` +
    `<p style="font-size:12px;font-weight:700;letter-spacing:0.04em;color:#444;margin:0 0 0.5em">${escapeHtml(onAirHeader)}</p>` +
    `<pre style="white-space:pre-wrap;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;line-height:1.5;margin:0 0 1.5em;padding:12px;background:#fff;border-radius:8px;border:1px solid #ddd">${escapeHtml(finalScript.trim())}</pre>` +
    `<p style="font-size:12px;font-weight:700;color:#444;margin:0 0 0.5em">${escapeHtml(linksHeader)}</p>` +
    `<div style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;line-height:1.45">${linksHtml}</div>` +
    `</div>`;

  const { data: sendData, error: sendErr } = await resend.emails.send({
    from,
    to,
    subject: `📺 Your News Script for ${new Date().toLocaleDateString('en-US', { timeZone: 'America/Chicago' })}`,
    text: emailText,
    html: emailHtml,
  });

  if (sendErr) {
    throw new Error(`Resend: ${sendErr.message} (${sendErr.name})`);
  }

  console.log('Mission accomplished. Resend id:', sendData?.id);
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
