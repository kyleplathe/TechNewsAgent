import { chromium } from 'playwright';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

async function runNewsAgent() {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  // 1. GATHER GLOBAL TECH NEWS
  await page.goto('https://news.ycombinator.com/');
  const globalNews = await page.evaluate(() => 
    Array.from(document.querySelectorAll('.titleline > a')).slice(0, 8).map(el => el.textContent)
  );

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
    Context:
    Global News: ${globalNews.join(', ')}
    Local (Minneapolis): ${localContext}

    Write a 60-second TV script. 
    - Tone: Professional but gritty (electronics repair shop vibe).
    - Opening: "Live from the bench in Linden Hills, I'm Kyle. Here’s what’s hitting the shop today."
    - Middle: Segue from global tech to local news (Wolves or local tech scene).
    - Style: Use teleprompter formatting (short lines, ALL CAPS for emphasis).
  `;

  const model = process.env.GEMINI_MODEL ?? 'gemini-2.0-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(geminiKey)}`;

  const aiResponse = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 1000 },
    }),
  });

  const data = (await aiResponse.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
    error?: { message?: string; code?: number };
    promptFeedback?: { blockReason?: string };
  };

  if (!aiResponse.ok) {
    const msg = data.error?.message ?? JSON.stringify(data);
    throw new Error(`Gemini API ${aiResponse.status}: ${msg}`);
  }

  const parts = data.candidates?.[0]?.content?.parts;
  const finalScript = parts?.map((p) => p.text).filter(Boolean).join('') ?? '';
  if (!finalScript) {
    const blocked =
      data.promptFeedback?.blockReason ??
      (data.candidates?.[0] as { finishReason?: string } | undefined)?.finishReason;
    throw new Error(
      `Gemini returned no text${blocked ? ` (${blocked})` : ''}: ${JSON.stringify(data)}`
    );
  }

  // 4. SEND TO YOUR INBOX VIA RESEND
  await resend.emails.send({
    from: 'News Agent <agent@instakyle.tech>',
    to: ['your-email@example.com'], // Replace with your actual email
    subject: `Daily News Script - ${new Date().toLocaleDateString()}`,
    text: finalScript,
  });

  console.log("Script sent to your inbox!");
}

runNewsAgent();
