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

  // 3. GENERATE SCRIPT WITH CLAUDE
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

  const aiResponse = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY!,
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }]
    })
  });

  const data = (await aiResponse.json()) as {
    content?: Array<{ type: string; text?: string }>;
    error?: { message?: string; type?: string };
  };

  if (!aiResponse.ok) {
    const msg = data.error?.message ?? JSON.stringify(data);
    throw new Error(`Anthropic API ${aiResponse.status}: ${msg}`);
  }

  const textBlock = data.content?.find((b) => b.type === 'text' && b.text);
  const finalScript = textBlock?.text;
  if (!finalScript) {
    throw new Error(`Anthropic returned no text: ${JSON.stringify(data)}`);
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
