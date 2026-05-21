/**
 * Sync `website` fields in local_businesses.ts from https://www.lindenhills.org/directory
 * (source of truth for active storefront / org links).
 *
 * Run: npx tsx scripts/sync-linden-hills-directory-urls.ts
 * Dry run: DRY_RUN=1 npx tsx scripts/sync-linden-hills-directory-urls.ts
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const DIRECTORY_URL = 'https://www.lindenhills.org/directory';
const TARGET = path.join(process.cwd(), 'local_businesses.ts');

function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/\u2019/g, "'")
    .trim();
}

function normalizeName(s: string): string {
  return decodeHtml(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Strip common tracking params; keep path/query the council lists. */
function canonicalDirectoryUrl(raw: string): string {
  const decoded = decodeHtml(raw);
  try {
    const url = new URL(decoded);
    for (const key of [
      'srsltid',
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_content',
      'fbclid',
      'gclid',
    ]) {
      url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return decoded;
  }
}

function escapeTsString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function fetchDirectoryLinks(): Promise<Map<string, string>> {
  const res = await fetch(DIRECTORY_URL, {
    headers: {
      'User-Agent':
        'TechNewsAgent/1.0 (+https://github.com; directory URL sync)',
    },
  });
  if (!res.ok) {
    throw new Error(`Directory fetch failed: ${res.status} ${res.statusText}`);
  }
  const html = await res.text();
  const linkPattern = /<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([^<]+)<\/a>/gi;
  const out = new Map<string, string>();
  let m: RegExpExecArray | null;
  while ((m = linkPattern.exec(html)) !== null) {
    const href = canonicalDirectoryUrl(m[1]);
    const text = decodeHtml(m[2]);
    if (
      href.includes('lindenhills.org') ||
      href.includes('squarespace') ||
      href.includes('facebook.com/2008') ||
      href.includes('instagram.com/linden') ||
      href.includes('facebook.com/lindenhillscouncil')
    ) {
      continue;
    }
    out.set(normalizeName(text), href);
  }
  return out;
}

function readWebsiteFromBlock(block: string): string | null {
  const single = block.match(/\n\s*website: '([^']+)',/);
  if (single) return single[1];
  const multi = block.match(/\n\s*website:\s*\n\s*'([^']+)',/);
  if (multi) return multi[1];
  return null;
}

function syncFile(src: string, dirLinks: Map<string, string>): {
  next: string;
  added: string[];
  updated: string[];
  unmatched: string[];
} {
  const blockRe = /(\{\s*\n\s*name: '([^']+)',[\s\S]*?\n\s*\},)/g;
  const added: string[] = [];
  const updated: string[] = [];
  const unmatched: string[] = [];

  const next = src.replace(blockRe, (block, _full, name: string) => {
    const dirUrl = dirLinks.get(normalizeName(name));
    const cur = readWebsiteFromBlock(block);

    if (!dirUrl) {
      if (!cur) unmatched.push(name);
      return block;
    }

    const escaped = escapeTsString(dirUrl);

    if (!cur) {
      added.push(name);
      return block.replace(
        /(\n\s*description: '[^']*',\n)/,
        `$1    website: '${escaped}',\n`
      );
    }

    if (canonicalDirectoryUrl(cur) === dirUrl) {
      return block;
    }

    updated.push(name);
    if (block.includes("\n    website:\n")) {
      return block.replace(
        /\n\s*website:\s*\n\s*'[^']+',/,
        `\n    website: '${escaped}',`
      );
    }
    return block.replace(
      /\n\s*website: '[^']+',/,
      `\n    website: '${escaped}',`
    );
  });

  return { next, added, updated, unmatched };
}

async function main(): Promise<void> {
  const dryRun = process.env.DRY_RUN === '1';
  const dirLinks = await fetchDirectoryLinks();
  const src = fs.readFileSync(TARGET, 'utf8');
  const { next, added, updated, unmatched } = syncFile(src, dirLinks);

  console.log(`Directory links parsed: ${dirLinks.size}`);
  console.log(`Added website: ${added.length}`);
  console.log(`Updated website: ${updated.length}`);
  if (unmatched.length) {
    console.log(`No directory link (unchanged): ${unmatched.join(', ')}`);
  }
  if (added.length) {
    console.log('\nAdded:');
    for (const name of added) console.log(`  ${name}`);
  }
  if (updated.length) {
    console.log('\nUpdated:');
    for (const name of updated) console.log(`  ${name}`);
  }

  if (dryRun) {
    console.log('\nDRY_RUN=1 — local_businesses.ts not written.');
    return;
  }

  if (next !== src) {
    fs.writeFileSync(TARGET, next);
    console.log(`\nWrote ${TARGET}`);
  } else {
    console.log('\nNo changes needed.');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
