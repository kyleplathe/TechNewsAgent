/**
 * Quick Resend check — does not call Gemini or Playwright.
 * Usage: set RESEND_API_KEY, RESEND_TO, optional RESEND_FROM in .env, then:
 *   npm run test:email
 */
import 'dotenv/config';
import { Resend } from 'resend';

const resendKey = process.env.RESEND_API_KEY;
const toRaw = process.env.RESEND_TO?.trim();
const from =
  process.env.RESEND_FROM?.trim() || 'News Agent <agent@instakyle.tech>';

if (!resendKey) {
  throw new Error('Missing RESEND_API_KEY');
}
if (!toRaw) {
  throw new Error('Missing RESEND_TO (your real inbox, comma-separated ok)');
}

const to = toRaw.split(',').map((a) => a.trim()).filter(Boolean);
const resend = new Resend(resendKey);

const { data, error } = await resend.emails.send({
  from,
  to,
  subject: 'TechNewsAgent — Resend test',
  text: 'If this landed in your inbox, email delivery is configured correctly.',
});

if (error) {
  throw new Error(`Resend: ${error.message} (${error.name})`);
}

console.log('OK — email queued. Resend id:', data?.id);
