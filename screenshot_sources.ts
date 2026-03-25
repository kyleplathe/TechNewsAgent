import { chromium, type Browser } from 'playwright';

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
  const defaultW = mobileMode() ? 390 : 1280;
  const defaultH = mobileMode() ? 844 : 720;
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
  const fp = fullPage();

  const context = await browser.newContext(
    mobileMode()
      ? {
          viewport: { width, height },
          isMobile: true,
          hasTouch: true,
          deviceScaleFactor: 3,
          userAgent:
            'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        }
      : {
          viewport: { width, height },
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
        const buf = await page.screenshot({
          type: 'jpeg',
          quality: 85,
          fullPage: fp,
        });
        ok.push({
          storyIndex: it.storyIndex,
          filename,
          content: Buffer.from(buf),
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
