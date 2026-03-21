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
  section: 'TECH' | 'LOCAL';
  feedTitle: string;
  title: string;
  link: string;
};

/** Split model output into teleprompter script + 1-based story indices for links. */
function parseScriptAndSources(
  raw: string,
  maxIndex: number
): { script: string; indices: number[] } {
  const marker = '<<<SOURCES>>>';
  const pos = raw.indexOf(marker);
  if (pos === -1) {
    return { script: raw.trim(), indices: [] };
  }
  const script = raw.slice(0, pos).trim();
  const after = raw.slice(pos + marker.length).trim();
  const numLine = after.split(/\n/)[0] ?? '';
  const indices = numLine
    .split(/[,;\s]+/)
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n >= 1 && n <= maxIndex);
  const seen = new Set<number>();
  const unique = indices.filter((n) =>
    seen.has(n) ? false : (seen.add(n), true)
  );
  return { script, indices: unique };
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
  /** Local = Wolves only (no neighborhood paper — avoids non-tech city/gossip). */
  const localFeeds = ['https://www.canishoopus.com/rss/current.xml'];

  const collected: Collected[] = [];

  async function pull(
    urls: string[],
    section: 'TECH' | 'LOCAL'
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

  console.log('Fetching global and local feeds...');
  await pull(techFeeds, 'TECH');
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

  const prompt = `
You are a punchy, high-energy tech news anchor filming from your repair shop in Linden Hills (Minneapolis).

NUMBERED STORIES FOR TODAY (each has a URL for your reference only — you cannot browse the web):
${storyListText}

QUALITY RULES:
- Pick only the **3–5 strongest stories** to actually talk about. Skip the rest — depth beats a laundry list.
- If a headline includes a year like "(2024)", that is usually the article’s original date, not “breaking today.” Say “making the rounds” or “people are digging into…” unless it’s clearly new.
- Do not invent products, prices, or dates. Stay close to the headlines.
- **No celebrity gossip, city politics, or general government news** unless the headline is clearly **tech-related** (e.g. regulation of chips, AI, broadband).
- The only **local RSS** input is **Wolves / NBA** — use it for the basketball beat. **Linden Hills** — the shops, blocks, and neighborhood feel (near Lake Harriet, the usual haunts) — is **your on-camera color**, not something to pull from a city news feed.
- Mix **tech** with **one Wolves** beat; keep it tight for **about 60 seconds** read aloud.

SCRIPT RULES (Final Cut / teleprompter — match this energy):
- **The entire on-camera script must be in ALL CAPS**, one thought per paragraph block, short lines. That includes text inside **[SQUARE BRACKETS]** for video cues.
- START exactly with: LIVE FROM THE BENCH IN LINDEN HILLS, I'M KYLE. WE'VE GOT A LOT HITTING THE SHOP TODAY.
- Use a clear tech handoff like **FIRST UP IN TECH,** or **AND SPEAKING OF AI,** between beats when it fits.
- Include a **Wolves check-in** (43–27, 4th in the West — update if you know better) and a **Linden Hills** neighborhood beat (coffee, shops, blocks — real, not generic city news).
- **Hard words / brands:** Use **spaced-letter spelling** plus a hyphen guide in parens when helpful, e.g. O P E N C O D E (O-PEN-CODE) or M A M B A (M-A-M-B-A).
- **Video direction:** On their own lines, in caps, e.g. [B-ROLL: OPencode.ai website], [LOWER THIRD: MAMBA-3 AI], [CAM: CLOSE UP ON A WORKBENCH], [CUT TO: SHOT OF LAKE HARRIET]. Keep them short.

- END with: BACK TO THE SOLDERING IRON. CATCH YOU TOMORROW.

OUTPUT FORMAT (critical):
1) Write ONLY the on-camera script first (no preamble, no bullet list of sources in the body).
2) Then on its own line put exactly: <<<SOURCES>>>
3) Then ONE line of comma-separated numbers — the **1-based story numbers** from the list above that you **actually mentioned or clearly relied on** in the script (for B-roll/screenshots). Example: 2,5,7
- Only include numbers from the list. If you only discussed stories 1 and 4, output: 1,4
`;

  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) {
    throw new Error('Set GEMINI_API_KEY (Google AI Studio → Get API key)');
  }

  const model = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash-lite';
  const genUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(geminiKey)}`;

  const body = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { maxOutputTokens: 1500 },
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

  const aiResponse = await fetch(genUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
    signal: AbortSignal.timeout(geminiTimeoutMs),
  });

  const data = (await aiResponse.json()) as GeminiResponse;
  if (!aiResponse.ok) {
    throw new Error(
      `Gemini API ${aiResponse.status}: ${data.error?.message ?? JSON.stringify(data)}`
    );
  }

  const parts = data.candidates?.[0]?.content?.parts;
  const rawOut =
    parts?.map((p) => p.text).filter(Boolean).join('') ?? '';
  if (!rawOut) {
    throw new Error(`Gemini returned no text: ${JSON.stringify(data)}`);
  }

  const { script: finalScript, indices } = parseScriptAndSources(
    rawOut,
    collected.length
  );

  const used = indices
    .map((i) => collected[i - 1])
    .filter(Boolean)
    .filter((c) => c.link);

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

  const emailText = `${finalScript}\n\n${linksHeader}\n\n${linksText || '(none)'}`;

  const emailHtml =
    `<div style="font-family:ui-monospace,Menlo,Consolas,monospace;max-width:720px;color:#111">` +
    `<pre style="white-space:pre-wrap;font-size:13px;line-height:1.5;margin:0 0 1.25em">${escapeHtml(finalScript)}</pre>` +
    `<p style="font-family:system-ui,sans-serif;font-size:13px;font-weight:600;margin:0 0 0.75em;color:#333">${escapeHtml(linksHeader)}</p>` +
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
  if (linksText) {
    console.log('\n--- Segment links ---\n' + linksText);
  }
}

runNewsAgent().catch((err) => {
  console.error(err);
  process.exit(1);
});
