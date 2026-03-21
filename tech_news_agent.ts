import 'dotenv/config';
import { chromium } from 'playwright';
import { Resend } from 'resend';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function runNewsAgent() {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  // 1. GATHER GLOBAL TECH NEWS (title + HN submission age — front page is "today" even if title says "(2024)")
  await page.goto('https://news.ycombinator.com/');
  const stories = await page.evaluate(() => {
    const out: {
      title: string;
      age: string;
      articleUrl: string;
      hnItemUrl: string;
    }[] = [];
    for (const row of Array.from(document.querySelectorAll('tr.athing'))) {
      const a = row.querySelector('.titleline > a');
      const title = a?.textContent?.trim();
      if (!title) continue;
      const rawHref = a?.getAttribute('href') ?? '';
      let articleUrl = '';
      try {
        articleUrl = new URL(rawHref, location.origin).href;
      } catch {
        articleUrl = rawHref;
      }
      const id = row.getAttribute('id') ?? '';
      const hnItemUrl = id
        ? new URL(`item?id=${id}`, location.origin).href
        : '';
      const sub = row.nextElementSibling;
      const age = sub?.querySelector('.age')?.textContent?.trim() ?? '';
      out.push({ title, age, articleUrl, hnItemUrl });
    }
    return out.slice(0, 12);
  });

  const topStories = stories.slice(0, 8);

  const globalNews = topStories.map((s) => {
    const fresh = s.age ? ` — on HN front page ${s.age}` : '';
    return `${s.title}${fresh}`;
  });

  const linksForPrompt = topStories
    .map(
      (s, i) =>
        `${i + 1}. ${s.title}\n   Article: ${s.articleUrl}\n   HN discussion: ${s.hnItemUrl}`
    )
    .join('\n');

  // 2. GATHER LOCAL CONTEXT (Simulated logic or targeted search)
  // Since we know it's March 2026, we'll bake in the logic for local events
  const localContext = `
    - Timberwolves: Playing the Rockets at the Target Center on March 25th.
    - Local Tech: MN Entrepreneur Kick-off is happening March 24th.
    - Neighborhood: Minnehaha Parkway remains under construction near Nicollet.
  `;

  await browser.close();

  // 3. GENERATE SCRIPT (Google Gemini — Google AI Studio free tier; key: https://aistudio.google.com/apikey )
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) {
    throw new Error('Set GEMINI_API_KEY (Google AI Studio → Get API key)');
  }

  const prompt = `
    You are a high-energy tech news anchor for a daily vlog.

    Accuracy (read carefully):
    - Each "Global" line is a live Hacker News front-page story. The "on HN front page X ago" part is how recently readers upvoted it — that is your freshness signal.
    - A year in a headline like "(2024)" or "(2022)" usually marks the original article or artifact, NOT the date of the tech news event. Do NOT say "just announced in 2024" unless the headline clearly refers to a 2024 launch. Prefer "making the rounds today" or "people are talking about…".
    - Do not invent product names, prices, or dates that are not reasonably implied by the headlines.
    - If a headline is clearly not tech, you may skip it briefly or tie it lightly — do not fabricate technical details.

    Context:
    Global (Hacker News, with submission recency):
    ${globalNews.map((line) => `• ${line}`).join('\n')}

    Source URLs (for host to open for B-roll / screenshots / post captions — you cannot browse them; do not invent page contents):
    ${linksForPrompt}

    Local (Minneapolis): ${localContext}

    Write a 60-second TV script. 
    - Tone: Professional but gritty (electronics repair shop vibe).
    - Opening: "Live from the bench in Linden Hills, I'm Kyle. Here’s what’s hitting the shop today."
    - Middle: Segue from global tech to local news (Wolves or local tech scene).
    - Style: Use teleprompter formatting (short lines, ALL CAPS for emphasis).
  `;

  // Default: gemini-2.5-flash-lite (stable, cost-efficient). Avoid gemini-2.0-* — deprecated
  // and often shows free_tier limit:0 on AI Studio keys.
  const model = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash-lite';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(geminiKey)}`;

  const body = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { maxOutputTokens: 1000 },
  });

  type GeminiResponse = {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
    error?: { message?: string; code?: number };
    promptFeedback?: { blockReason?: string };
  };

  const parseRetrySeconds = (msg: string): number | null => {
    const m = msg.match(/retry in ([\d.]+)\s*s/i);
    return m ? parseFloat(m[1]) : null;
  };

  const maxAttempts = 5;
  let finalScript = '';
  let lastStatus = 0;
  let lastBody: GeminiResponse = {};

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const aiResponse = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });

    const data = (await aiResponse.json()) as GeminiResponse;
    lastStatus = aiResponse.status;
    lastBody = data;

    if (aiResponse.status === 429 && attempt < maxAttempts) {
      const msg = data.error?.message ?? '';
      const waitSec =
        parseRetrySeconds(msg) ??
        Math.min(2 ** attempt, 60);
      await new Promise((r) => setTimeout(r, Math.ceil(waitSec * 1000)));
      continue;
    }

    if (!aiResponse.ok) {
      const msg = data.error?.message ?? JSON.stringify(data);
      throw new Error(`Gemini API ${aiResponse.status}: ${msg}`);
    }

    const parts = data.candidates?.[0]?.content?.parts;
    finalScript = parts?.map((p) => p.text).filter(Boolean).join('') ?? '';
    if (finalScript) break;

    const blocked =
      data.promptFeedback?.blockReason ??
      (data.candidates?.[0] as { finishReason?: string } | undefined)?.finishReason;
    throw new Error(
      `Gemini returned no text${blocked ? ` (${blocked})` : ''}: ${JSON.stringify(data)}`
    );
  }

  if (!finalScript) {
    throw new Error(
      `Gemini API ${lastStatus}: ${JSON.stringify(lastBody)}`
    );
  }

  // 4. SEND TO YOUR INBOX VIA RESEND
  const resendKey = process.env.RESEND_API_KEY;
  const toRaw = process.env.RESEND_TO?.trim();
  const from =
    process.env.RESEND_FROM?.trim() || 'News Agent <agent@instakyle.tech>';

  if (!resendKey) {
    throw new Error('Set RESEND_API_KEY (Resend dashboard → API Keys)');
  }
  if (!toRaw) {
    throw new Error(
      'Set RESEND_TO to your inbox address (comma-separated for multiple). Was still using a placeholder.'
    );
  }

  const to = toRaw.split(',').map((a) => a.trim()).filter(Boolean);
  const resend = new Resend(resendKey);

  const linksText = topStories
    .map(
      (s, i) =>
        `${i + 1}. ${s.title}\n   Article: ${s.articleUrl}\n   HN: ${s.hnItemUrl}`
    )
    .join('\n\n');

  const linksHtml = `<ul style="padding-left:1.2em;line-height:1.5">${topStories
    .map(
      (s) =>
        `<li style="margin-bottom:0.75em"><strong>${escapeHtml(s.title)}</strong><br>` +
        `<a href="${escapeHtml(s.articleUrl)}">Open article</a> · ` +
        `<a href="${escapeHtml(s.hnItemUrl)}">HN thread</a></li>`
    )
    .join('')}</ul>`;

  const emailText = `${finalScript}\n\n---\nSOURCE LINKS (posting / screenshots)\n\n${linksText}`;

  const emailHtml =
    `<div style="font-family:system-ui,sans-serif;max-width:640px">` +
    `<pre style="white-space:pre-wrap;font-size:14px;line-height:1.45">${escapeHtml(finalScript)}</pre>` +
    `<hr style="border:none;border-top:1px solid #ddd;margin:1.5em 0" />` +
    `<p style="font-size:13px;color:#555;margin:0 0 0.5em">Source links</p>` +
    linksHtml +
    `</div>`;

  const { data, error } = await resend.emails.send({
    from,
    to,
    subject: `Daily News Script - ${new Date().toLocaleDateString('en-US', { timeZone: 'America/Chicago' })}`,
    text: emailText,
    html: emailHtml,
  });

  if (error) {
    throw new Error(`Resend: ${error.message} (${error.name})`);
  }

  console.log('Email sent. Resend id:', data?.id);
  console.log('\n--- Links (copy for posts / screenshots) ---\n');
  console.log(linksText);
}

runNewsAgent();
