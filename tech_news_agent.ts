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
  const localFeeds = [
    'https://www.southwestjournal.com/feed/',
    'https://www.canishoopus.com/rss/current.xml',
  ];

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
- Mix **tech** with **one local / Wolves** beat; keep it tight for **about 60 seconds** read aloud.

SCRIPT RULES:
- START with: "Live from the bench in Linden Hills, I'm Kyle. We've got a lot hitting the shop today."
- Include a short **Wolves check-in** (team is 43–27, 4th in the West — adjust if you know it changed).
- Include a **Southwest Minneapolis** nod (Lake Harriet, coffee, neighborhood vibe).
- STYLE: teleprompter-friendly — short lines, ALL CAPS for emphasis, phonetic spellings for tricky names.
- END with: "Back to the soldering iron. Catch you tomorrow."

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
    generationConfig: { maxOutputTokens: 1200 },
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

  const linksText = used
    .map((c, i) => `${i + 1}. [${c.section}] ${c.title}\n   ${c.link}`)
    .join('\n\n');

  const linksHtml =
    used.length > 0
      ? `<ul style="padding-left:1.2em;line-height:1.5">${used
          .map(
            (c) =>
              `<li style="margin-bottom:0.6em"><span style="color:#666">[${escapeHtml(c.section)}]</span> ` +
              `<strong>${escapeHtml(c.title)}</strong><br><a href="${escapeHtml(c.link)}">${escapeHtml(c.link)}</a></li>`
          )
          .join('')}</ul>`
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

  const emailText = `${finalScript}\n\n---\n${linksHeader}\n\n${linksText || '(none)'}`;

  const emailHtml =
    `<div style="font-family:system-ui,sans-serif;max-width:640px">` +
    `<pre style="white-space:pre-wrap;font-size:14px;line-height:1.45">${escapeHtml(finalScript)}</pre>` +
    `<hr style="border:none;border-top:1px solid #ddd;margin:1.5em 0" />` +
    `<p style="font-size:13px;color:#555">${escapeHtml(linksHeader)}</p>` +
    linksHtml +
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
