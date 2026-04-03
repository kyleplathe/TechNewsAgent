import { chromium, type Browser, type Locator, type Page } from 'playwright';

export type SourceShotInput = {
  storyIndex: number;
  section: string;
  title: string;
  link: string;
};

export type SourceShotOk = {
  storyIndex: number;
  filename: string;
  content: Buffer;
  link: string;
};

function safeFilenamePart(s: string, max = 48): string {
  const t = s
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-|-$/g, '')
    .slice(0, max);
  return t || 'story';
}

function isHttpUrl(link: string): boolean {
  try {
    const u = new URL(link);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function settleMs(): number {
  return Math.min(
    5000,
    Math.max(0, parseInt(process.env.SCREENSHOT_SETTLE_MS ?? '1500', 10) || 1500)
  );
}

function navTimeoutMs(): number {
  return Math.min(
    60_000,
    Math.max(8000, parseInt(process.env.SCREENSHOT_NAV_TIMEOUT_MS ?? '28000', 10) || 28_000)
  );
}

function mobileMode(): boolean {
  const v = process.env.SCREENSHOT_MOBILE?.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

function viewport(): { width: number; height: number } {
  // Default to portrait 9:16 so grabs can be used as vertical GFX.
  // Override any time with SCREENSHOT_WIDTH / SCREENSHOT_HEIGHT.
  const defaultW = mobileMode() ? 720 : 720;
  const defaultH = mobileMode() ? 1280 : 1280;
  const width = Math.min(
    2560,
    Math.max(320, parseInt(process.env.SCREENSHOT_WIDTH ?? String(defaultW), 10) || defaultW)
  );
  const height = Math.min(
    2160,
    Math.max(480, parseInt(process.env.SCREENSHOT_HEIGHT ?? String(defaultH), 10) || defaultH)
  );
  return { width, height };
}

function fullPage(): boolean {
  const v = process.env.SCREENSHOT_FULL_PAGE?.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

/** viewport = old behavior; content = crop to article/main (less empty margin); fullpage = whole scrollable document. */
function screenshotMode(): 'viewport' | 'content' | 'fullpage' {
  const m = (process.env.SCREENSHOT_MODE ?? 'content').trim().toLowerCase();
  if (m === 'viewport') return 'viewport';
  if (m === 'fullpage' || m === 'full_page') return 'fullpage';
  return 'content';
}

function maxContentHeightPx(): number {
  /** Tall enough for headline + hero in one still; mask/scale in FCP for PiP placement. */
  return Math.min(
    8000,
    Math.max(400, parseInt(process.env.SCREENSHOT_MAX_CONTENT_HEIGHT ?? '2400', 10) || 2400)
  );
}

/**
 * Optional center-crop max width. **Default: no cap** — captures full article column width so
 * long headlines aren’t clipped; reframe with a mask in the FCP compound clip.
 * Set `SCREENSHOT_MAX_CONTENT_WIDTH=720` (or similar) if you want narrower JPEGs again.
 */
function parseOptionalMaxContentWidth(envKey: string): number | null {
  const raw = process.env[envKey]?.trim();
  if (raw === undefined || raw === '') return null;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(4000, Math.max(280, n));
}

function maxContentWidthForHost(hostname: string): number | null {
  const h = hostname.toLowerCase();
  const isGh =
    h === 'github.com' ||
    h === 'gist.github.com' ||
    h.endsWith('.github.com') ||
    h === 'github.blog';
  if (isGh) {
    return (
      parseOptionalMaxContentWidth('SCREENSHOT_MAX_CONTENT_WIDTH_GITHUB') ??
      parseOptionalMaxContentWidth('SCREENSHOT_MAX_CONTENT_WIDTH')
    );
  }
  return parseOptionalMaxContentWidth('SCREENSHOT_MAX_CONTENT_WIDTH');
}

function applyMaxWidthToClip(
  clip: { x: number; y: number; width: number; height: number },
  maxW: number | null
): { x: number; y: number; width: number; height: number } {
  if (maxW == null || clip.width <= maxW) return clip;
  const shave = clip.width - maxW;
  return {
    x: clip.x + shave / 2,
    y: clip.y,
    width: maxW,
    height: clip.height,
  };
}

function jpegQuality(): number {
  return Math.min(
    95,
    Math.max(50, parseInt(process.env.SCREENSHOT_JPEG_QUALITY ?? '82', 10) || 82)
  );
}

function deviceScaleFactor(): number {
  return Math.min(
    3,
    Math.max(1, parseInt(process.env.SCREENSHOT_DEVICE_SCALE_FACTOR ?? '1', 10) || 1)
  );
}

/** Prefer specific article bodies over full-width `main` (often mostly whitespace on news sites). */
const DEFAULT_CONTENT_SELECTORS = [
  'article',
  '[role="article"]',
  'main article',
  'main [data-testid="article-body"]',
  '[data-testid="article-body"]',
  '.article-body',
  '.post-content',
  '.entry-content',
  '.story-body',
  '.article__content',
  'main',
  '[role="main"]',
];

/**
 * Future / Tom's-style layouts: giant empty ad band between nav and story — inner
 * selectors beat `main` when they exist.
 */
const TOMS_HARDWARE_EXTRA_SELECTORS = [
  '.article-content',
  '.article-v2__content',
  '.article__body',
  '.article__container',
];

/** SB Nation / Vox — hero images are often lazy-loaded below the fold. */
const CANIS_HOOPUS_EXTRA_SELECTORS = [
  '.c-entry-content',
  '.l-col__main',
  '.l-wrapper',
];

/** GitHub — prefer article body over a tight inner column when possible. */
const GITHUB_EXTRA_SELECTORS = [
  '[data-testid="issue-viewer-container"]',
  'article.markdown-body',
  '.markdown-body',
  'main .application-main main',
  'main',
];

function contentSelectorListForHost(hostname: string): string[] {
  const custom = process.env.SCREENSHOT_CONTENT_SELECTOR?.trim();
  const host = hostname.toLowerCase();
  let prepend: string[] = [];
  if (host === 'tomshardware.com' || host.endsWith('.tomshardware.com')) {
    prepend = [...TOMS_HARDWARE_EXTRA_SELECTORS];
  } else if (
    host === 'canishoopus.com' ||
    host.endsWith('.canishoopus.com')
  ) {
    prepend = [...CANIS_HOOPUS_EXTRA_SELECTORS];
  } else if (
    host === 'github.com' ||
    host === 'gist.github.com' ||
    host.endsWith('.github.com') ||
    host === 'github.blog'
  ) {
    prepend = [...GITHUB_EXTRA_SELECTORS];
  }

  const base = custom
    ? [custom, ...DEFAULT_CONTENT_SELECTORS.filter((s) => s !== custom)]
    : [...DEFAULT_CONTENT_SELECTORS];

  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of [...prepend, ...base]) {
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function trimHeadlineGapEnabled(): boolean {
  const v = process.env.SCREENSHOT_TRIM_HEADLINE_GAP?.trim().toLowerCase();
  return v !== '0' && v !== 'false' && v !== 'no';
}

/**
 * Many news pages stack nav + trending + empty ad slots above the real headline inside the
 * same `main`/`article` box. Cropping from the first `h1` drops that dead space so the hero
 * image fits better in 9:16 PiP.
 */
async function clipForContentRegion(
  loc: Locator,
  box: { x: number; y: number; width: number; height: number },
  maxH: number
): Promise<{ x: number; y: number; width: number; height: number }> {
  const base = {
    x: Math.max(0, box.x),
    y: Math.max(0, box.y),
    width: box.width,
    height: Math.min(box.height, maxH),
  };

  if (!trimHeadlineGapEnabled()) return base;

  const gapThreshold = Math.max(
    24,
    parseInt(process.env.SCREENSHOT_TRIM_GAP_ABOVE_H1_PX ?? '56', 10) || 56
  );
  const headPad = Math.max(
    0,
    parseInt(process.env.SCREENSHOT_HEADLINE_PAD_PX ?? '10', 10) || 10
  );

  const h1 = loc.locator('h1').first();
  try {
    if ((await h1.count()) === 0) return base;
    await h1.scrollIntoViewIfNeeded().catch(() => {});
    if (!(await h1.isVisible().catch(() => false))) return base;
    const h1Box = await h1.boundingBox();
    if (!h1Box) return base;

    const gapTop = h1Box.y - box.y;
    if (gapTop < gapThreshold) return base;

    const y = Math.max(0, h1Box.y - headPad);
    const bottom = box.y + box.height;
    const height = Math.min(maxH, bottom - y);
    if (height < 160) return base;

    return {
      x: Math.max(0, box.x),
      y,
      width: box.width,
      height,
    };
  } catch {
    return base;
  }
}

function primeLazyMediaEnabled(): boolean {
  const v = process.env.SCREENSHOT_PRIME_LAZY_MEDIA?.trim().toLowerCase();
  return v !== '0' && v !== 'false' && v !== 'no';
}

/**
 * Scrolls through the page and nudges lazy `img` / `data-src` so SB Nation and similar sites
 * actually paint hero images before we clip (fixes empty gray boxes on Canis Hoopus).
 */
async function primeLazyMedia(page: Page): Promise<void> {
  if (!primeLazyMediaEnabled()) return;

  await page
    .evaluate(() => {
      for (const img of document.querySelectorAll('img')) {
        const el = img as HTMLImageElement;
        if (el.loading === 'lazy') el.loading = 'eager';
        const ds = el.getAttribute('data-src');
        if (ds && (!el.getAttribute('src') || el.src.startsWith('data:'))) {
          el.src = ds;
        }
        const dss = el.getAttribute('data-srcset');
        if (dss && !el.getAttribute('srcset')) {
          el.srcset = dss;
        }
      }
    })
    .catch(() => {});

  const steps = Math.min(
    24,
    Math.max(2, parseInt(process.env.SCREENSHOT_SCROLL_STEPS ?? '8', 10) || 8)
  );
  const pause = Math.min(
    500,
    Math.max(40, parseInt(process.env.SCREENSHOT_SCROLL_PAUSE_MS ?? '100', 10) || 100)
  );
  const post = Math.min(
    2500,
    Math.max(0, parseInt(process.env.SCREENSHOT_POST_SCROLL_SETTLE_MS ?? '450', 10) || 450)
  );

  for (let i = 0; i <= steps; i++) {
    const frac = steps === 0 ? 0 : i / steps;
    await page
      .evaluate((f) => {
        const root = document.scrollingElement ?? document.documentElement;
        const h = Math.max(0, root.scrollHeight - root.clientHeight);
        root.scrollTop = Math.floor(h * f);
      }, frac)
      .catch(() => {});
    await new Promise((r) => setTimeout(r, pause));
  }

  await page
    .evaluate(() => {
      const root = document.scrollingElement ?? document.documentElement;
      root.scrollTop = 0;
    })
    .catch(() => {});

  if (post > 0) await new Promise((r) => setTimeout(r, post));
}

/**
 * Prefer a tight crop on the story column (headline + lede) instead of the full viewport or
 * an endless full-page scroll — both common sources of “huge white space” in vertical edits.
 */
async function captureScreenshot(page: Page): Promise<Buffer> {
  const jq = jpegQuality();
  if (fullPage()) {
    return Buffer.from(
      await page.screenshot({
        type: 'jpeg',
        quality: jq,
        fullPage: true,
      })
    );
  }

  const mode = screenshotMode();
  if (mode === 'viewport') {
    return Buffer.from(
      await page.screenshot({ type: 'jpeg', quality: jq, fullPage: false })
    );
  }
  if (mode === 'fullpage') {
    return Buffer.from(
      await page.screenshot({ type: 'jpeg', quality: jq, fullPage: true })
    );
  }

  const maxH = maxContentHeightPx();
  /** Skip tiny chrome boxes (nav chips, etc.). */
  const minContentWidth = Math.min(
    320,
    Math.max(160, parseInt(process.env.SCREENSHOT_MIN_CONTENT_WIDTH ?? '200', 10) || 200)
  );

  let host = '';
  try {
    host = new URL(page.url()).hostname;
  } catch {
    host = '';
  }

  for (const sel of contentSelectorListForHost(host)) {
    const loc = page.locator(sel).first();
    try {
      if ((await loc.count()) === 0) continue;
      await loc.scrollIntoViewIfNeeded().catch(() => {});
      const vis = await loc.isVisible().catch(() => false);
      if (!vis) continue;
      const box = await loc.boundingBox();
      if (!box || box.width < minContentWidth || box.height < 80) continue;

      let clip = await clipForContentRegion(loc, box, maxH);
      clip = applyMaxWidthToClip(clip, maxContentWidthForHost(host));
      // fullPage so `clip` can reach content above/below the initial viewport.
      return Buffer.from(
        await page.screenshot({
          type: 'jpeg',
          quality: jq,
          fullPage: true,
          clip,
        })
      );
    } catch {
      continue;
    }
  }

  return Buffer.from(
    await page.screenshot({ type: 'jpeg', quality: jq, fullPage: false })
  );
}

/**
 * Above-the-fold (or full-page) JPEG grabs for edit B-roll. Skips non-http(s) links.
 * Uses one browser context; one page per URL so failures do not taint the next load.
 */
export async function screenshotSources(
  items: SourceShotInput[]
): Promise<{
  ok: SourceShotOk[];
  failures: Array<{ storyIndex: number; link: string; error: string }>;
}> {
  const ok: SourceShotOk[] = [];
  const failures: Array<{ storyIndex: number; link: string; error: string }> = [];

  const filtered = items.filter((it) => isHttpUrl(it.link));
  for (const it of items) {
    if (!isHttpUrl(it.link)) {
      failures.push({
        storyIndex: it.storyIndex,
        link: it.link,
        error: 'skipped (not http/https)',
      });
    }
  }

  if (!filtered.length) {
    return { ok, failures };
  }

  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({
      headless: true,
      ...(process.env.CI === 'true'
        ? { args: ['--no-sandbox', '--disable-setuid-sandbox'] }
        : {}),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('Playwright: could not launch Chromium — no screenshots:', msg);
    for (const it of filtered) {
      failures.push({ storyIndex: it.storyIndex, link: it.link, error: msg });
    }
    return { ok, failures };
  }

  const { width, height } = viewport();
  const timeout = navTimeoutMs();
  const delay = settleMs();

  const dpr = deviceScaleFactor();
  const context = await browser.newContext(
    mobileMode()
      ? {
          viewport: { width, height },
          isMobile: true,
          hasTouch: true,
          deviceScaleFactor: dpr,
          userAgent:
            'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        }
      : {
          viewport: { width, height },
          deviceScaleFactor: dpr,
          userAgent:
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        }
  );

  try {
    for (const it of filtered) {
      const slug = safeFilenamePart(`${it.section}-${it.title}`);
      const filename = `${String(it.storyIndex).padStart(2, '0')}-${slug}.jpg`;
      const page = await context.newPage();
      try {
        await page.goto(it.link, {
          waitUntil: 'domcontentloaded',
          timeout,
        });
        if (delay > 0) {
          await new Promise((r) => setTimeout(r, delay));
        }
        await primeLazyMedia(page);
        const buf = await captureScreenshot(page);
        ok.push({
          storyIndex: it.storyIndex,
          filename,
          content: buf,
          link: it.link,
        });
        console.log(`  Screenshot OK #${it.storyIndex} → ${filename}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`  Screenshot failed #${it.storyIndex} (${it.link}):`, msg);
        failures.push({ storyIndex: it.storyIndex, link: it.link, error: msg });
      } finally {
        await page.close();
      }
    }
  } finally {
    await context.close();
    await browser.close();
  }

  return { ok, failures };
}
