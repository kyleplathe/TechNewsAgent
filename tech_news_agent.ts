import 'dotenv/config';
import Parser from 'rss-parser';
import { Resend } from 'resend';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const parser = new Parser();

type Collected = {
  section: 'TECH' | 'LOCAL';
  feedTitle: string;
  title: string;
  link: string;
};

async function runNewsAgent() {
  const techFeeds = [
    'https://news.ycombinator.com/rss',
    'https://feeds.arstechnica.com/arstechnica/index',
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
        const feed = await parser.parseURL(url);
        const title = feed.title ?? url;
        for (const item of feed.items.slice(0, 3)) {
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

  const bySection = (s: 'TECH' | 'LOCAL') =>
    collected.filter((c) => c.section === s);

  let newsContent = '';
  for (const s of ['TECH', 'LOCAL'] as const) {
    const rows = bySection(s);
    if (!rows.length) continue;
    newsContent += `${s}:\n`;
    for (const r of rows) {
      newsContent += `  • [${r.feedTitle}] ${r.title}\n`;
    }
    newsContent += '\n';
  }

  if (!newsContent.trim()) {
    throw new Error('No stories parsed from any feed — check URLs or network.');
  }

  const prompt = `
    You are a punchy, high-energy tech news anchor filming from your repair shop in Linden Hills.
    
    DATA FOR TODAY:
    ${newsContent}

    TASK: Write a 60-second TV script.
    - START: "Live from the bench in Linden Hills, I'm Kyle. We've got a lot hitting the shop today."
    - MIDDLE: Mix the high-level tech news with local MN updates. 
    - NBA SEGMENT: Always include a 'Wolves check-in' (The team is currently 43-27, 4th in the West).
    - LOCAL VIBE: Mention something about Southwest Mpls (Lake Harriet, coffee shops, or local events).
    - STYLE: Use [TELEPROMPTER STYLE]: short lines, ALL CAPS for emphasis, and phonetic spelling for tough names.
    - END: "Back to the soldering iron. Catch you tomorrow."
  `;

  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) {
    throw new Error('Set GEMINI_API_KEY (Google AI Studio → Get API key)');
  }

  const model = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash-lite';
  const genUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(geminiKey)}`;

  const body = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { maxOutputTokens: 1000 },
  });

  type GeminiResponse = {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    error?: { message?: string };
  };

  console.log('Generating script with Gemini...');

  const aiResponse = await fetch(genUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });

  const data = (await aiResponse.json()) as GeminiResponse;
  if (!aiResponse.ok) {
    throw new Error(
      `Gemini API ${aiResponse.status}: ${data.error?.message ?? JSON.stringify(data)}`
    );
  }

  const parts = data.candidates?.[0]?.content?.parts;
  const finalScript =
    parts?.map((p) => p.text).filter(Boolean).join('') ?? '';
  if (!finalScript) {
    throw new Error(`Gemini returned no text: ${JSON.stringify(data)}`);
  }

  const linksText = collected
    .filter((c) => c.link)
    .map((c, i) => `${i + 1}. ${c.title}\n   ${c.link}`)
    .join('\n\n');

  const linksHtml = `<ul style="padding-left:1.2em;line-height:1.5">${collected
    .filter((c) => c.link)
    .map(
      (c) =>
        `<li style="margin-bottom:0.6em"><span style="color:#666">[${escapeHtml(c.section)}]</span> ` +
        `<strong>${escapeHtml(c.title)}</strong><br><a href="${escapeHtml(c.link)}">${escapeHtml(c.link)}</a></li>`
    )
    .join('')}</ul>`;

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

  const emailText = `${finalScript}\n\n---\nSOURCE LINKS\n\n${linksText || '(no links in feed items)'}`;

  const emailHtml =
    `<div style="font-family:system-ui,sans-serif;max-width:640px">` +
    `<pre style="white-space:pre-wrap;font-size:14px;line-height:1.45">${escapeHtml(finalScript)}</pre>` +
    `<hr style="border:none;border-top:1px solid #ddd;margin:1.5em 0" />` +
    `<p style="font-size:13px;color:#555">Source links (RSS)</p>` +
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
    console.log('\n--- Links ---\n' + linksText);
  }
}

runNewsAgent().catch((err) => {
  console.error(err);
  process.exit(1);
});
