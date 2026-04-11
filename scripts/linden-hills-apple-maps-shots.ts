/**
 * Screenshots Apple Maps web search results for Linden Hills / 43rd & Upton businesses.
 * Apple Maps web blocks Chromium — WebKit (Safari engine) is required.
 * Run: npx tsx scripts/linden-hills-apple-maps-shots.ts
 * Output: docs/linden-hills-43rd-upton/maps/*.png
 */
import { webkit } from 'playwright';
import * as fs from 'node:fs';
import * as path from 'node:path';

const OUT_DIR = path.join(
  process.cwd(),
  'docs',
  'linden-hills-43rd-upton',
  'maps'
);

/** Alphabetical by business name. Query strings tuned for Apple Maps place resolution near 43rd & Upton. */
const BUSINESSES: Array<{ slug: string; mapsQuery: string }> = [
  /** If no storefront at this node, map may show nearest Breadsmith or another bakery — verify in README. */
  { slug: 'breadsmith', mapsQuery: 'Breadsmith Minneapolis MN' },
  { slug: 'coffee-and-tea-limited', mapsQuery: 'Coffee and Tea Limited 2730 W 43rd St Minneapolis MN' },
  { slug: 'cmt-janitorial-services', mapsQuery: 'CMT Janitorial Services Minneapolis MN' },
  { slug: 'france-44-cheese-meat', mapsQuery: 'France 44 4351 France Ave S Minneapolis MN' },
  {
    slug: 'heart-of-tibet-sky-door',
    mapsQuery: 'Heart of Tibet Sky Door 4303 Upton Ave S Minneapolis MN',
  },
  { slug: 'jones-coffee', mapsQuery: 'Jones Coffee 2814 W 43rd St Minneapolis MN' },
  { slug: 'larues', mapsQuery: "Larue's 4301 Upton Ave S Minneapolis MN" },
  {
    slug: 'learning-services-llc',
    mapsQuery: 'Learning Designs 2822 W 43rd St Minneapolis MN',
  },
  { slug: 'linden43', mapsQuery: 'Linden43 2810 W 43rd St Minneapolis MN' },
  {
    slug: 'linden-hills-law-office',
    mapsQuery: 'Linden Hills Law Office 4250 Upton Ave S Minneapolis MN',
  },
  {
    slug: 'magnolia-aesthetics-wellness',
    mapsQuery: 'Magnolia Aesthetics Wellness 2826 W 43rd St Minneapolis MN',
  },
  { slug: 'martina', mapsQuery: 'Martina 4312 Upton Ave S Minneapolis MN' },
  { slug: 'new-gild-jewelers', mapsQuery: 'New Gild Jewelers 4300 Upton Ave S Minneapolis MN' },
  { slug: 'picnic-linden-hills', mapsQuery: 'Picnic Linden Hills 4307 Upton Ave S Minneapolis MN' },
  {
    slug: 'pinwheels-and-play-toys',
    mapsQuery: 'Pinwheels and Play Toys 4313 Upton Ave S Minneapolis MN',
  },
  { slug: 'rosalia', mapsQuery: 'Rosalia 2811 W 43rd St Minneapolis MN' },
  { slug: 'sebesta-apothecary', mapsQuery: 'Sebesta Apothecary Minneapolis MN Linden Hills' },
  {
    slug: 'settergrens-linden-hills',
    mapsQuery: "Settergren's Linden Hills 2813 W 43rd St Minneapolis MN",
  },
  { slug: 'sunu-wellness-center', mapsQuery: 'SuNu Wellness 2822 W 43rd St Minneapolis MN' },
  {
    slug: 'the-harriet-brasserie',
    mapsQuery: 'Harriet Brasserie 2724 W 43rd St Minneapolis MN',
  },
  { slug: 'tilia', mapsQuery: 'Tilia 2726 W 43rd St Minneapolis MN' },
  { slug: 'wedge-linden-hills', mapsQuery: 'Wedge Co-op Linden Hills 3815 Sunnyside Ave Minneapolis MN' },
  { slug: 'wild-rumpus', mapsQuery: 'Wild Rumpus Books 2720 W 43rd St Minneapolis MN' },
];

async function main(): Promise<void> {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const headed = process.env.MAPS_SCREENSHOT_HEADED === '1';
  const browser = await webkit.launch({ headless: !headed });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    locale: 'en-US',
    timezoneId: 'America/Chicago',
    geolocation: { latitude: 44.924, longitude: -93.308 },
    permissions: ['geolocation'],
  });
  const page = await context.newPage();
  page.setDefaultTimeout(90_000);

  for (const b of BUSINESSES) {
    const url = `https://maps.apple.com/search?query=${encodeURIComponent(b.mapsQuery)}`;
    const outPath = path.join(OUT_DIR, `${b.slug}.png`);
    try {
      // Avoid `networkidle` — Apple Maps keeps long-lived connections and can hang.
      await page.goto(url, { waitUntil: 'load' });
      await page.waitForTimeout(9000);
      await page.screenshot({ path: outPath, fullPage: false });
      console.log('OK', b.slug, '→', outPath);
    } catch (e) {
      console.warn('FAIL', b.slug, e);
    }
  }

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
