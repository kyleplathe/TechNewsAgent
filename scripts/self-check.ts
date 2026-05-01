import {
  finalizeSocialCaption,
  formatSocialHeadline,
  normalizeSocialBodySentenceCase,
  stripHashtagLines,
} from '../lib/social';
import { parseStudioOutput } from '../lib/studio_parse';

function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(`Self-check failed: ${message}`);
}

function runParseStudioOutputChecks() {
  const raw = `
<<<ON_AIR>>>
LIVE FROM THE BENCH IN LINDEN HILLS, I'M KYLE. AND WE'VE GOT A LOT HITTING THE SHOP TODAY.

REPAIR BEAT HERE.

BACK TO THE SOLDERING IRON. CATCH YOU TOMORROW.

<<<SOURCES>>>
2, 5, 7, 9

<<<SOCIAL>>>
i'm seeing a repair beat + an openai update, and the wolves got a quick mention too
#TechNews #AI
`;

  const parsed = parseStudioOutput(raw, 20);
  assert(typeof parsed.onAir === 'string' && parsed.onAir.length > 0, 'onAir parsed');
  assert(Array.isArray(parsed.indices), 'indices is array');
  assert(parsed.indices.length > 0, 'indices parsed');
  assert(parsed.indices.every((n) => Number.isInteger(n) && n >= 1 && n <= 20), 'indices in range');
  assert(typeof parsed.social === 'string', 'social parsed');

  const multilineSourcesRaw = `
<<<ON_AIR>>>
WOLVES UP TOP, SKATE AT THE END.

<<<SOURCES>>>
2, 5
7
9 11

<<<SOCIAL>>>
quick post body
`;
  const multilineParsed = parseStudioOutput(multilineSourcesRaw, 20);
  assert(
    multilineParsed.indices.join(',') === '2,5,7,9',
    'multi-line SOURCES indices parsed in order (cap 4)'
  );
}

function runSocialChecks() {
  const headline = formatSocialHeadline();
  assert(headline.includes('Tech News Daily with Kyle'), 'headline format');

  const modelSocial = "i'm watching openai roll out new stuff.  also: GPU news!!!\n\n#AI #TechNews";
  const body = normalizeSocialBodySentenceCase(stripHashtagLines(modelSocial));
  assert(!/\bi\b/.test(body), 'no stray lowercase i');
  assert(/[.!?]$/.test(body), 'body ends with punctuation');

  const caption = finalizeSocialCaption(headline, body, '#TechNews #AI');
  assert(caption.length <= 500, 'caption within Threads cap');
  assert(caption.includes(headline), 'caption includes headline');
  assert(caption.includes('instakyle.tech/news'), 'caption includes read-more CTA');
}

function main() {
  runParseStudioOutputChecks();
  runSocialChecks();
  console.log('Self-check OK');
}

main();

