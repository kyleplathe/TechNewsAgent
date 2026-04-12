import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export type WebPublishStoryInput = {
  storyIndex: number;
  section: string;
  title: string;
  link: string;
  /** RSS / Atom `pubDate` — used when `TECHNEWS_BLOG_STORY_ORDER=newest` (default). */
  publishedAt?: string;
  /** JPEG filename (e.g. 01-slug.jpg) when a screenshot exists for this story */
  imageFilename?: string;
  imageBuffer?: Buffer;
  /**
   * Seconds from the start of the YouTube video for this story (slideshow sync on Instakyle).
   * Overrides `WEB_VIDEO_START_SECS` and prior post JSON for this `storyIndex`.
   */
  videoStartSec?: number | null;
};

function workflowRunMeta(): {
  sourceWorkflowRunId: string | null;
  sourceWorkflowRunUrl: string | null;
} {
  const id = process.env.GITHUB_RUN_ID?.trim() || null;
  const server = (process.env.GITHUB_SERVER_URL ?? 'https://github.com').replace(
    /\/+$/,
    ''
  );
  const repo = process.env.GITHUB_REPOSITORY?.trim();
  if (!id || !repo) {
    return { sourceWorkflowRunId: id, sourceWorkflowRunUrl: null };
  }
  return {
    sourceWorkflowRunId: id,
    sourceWorkflowRunUrl: `${server}/${repo}/actions/runs/${id}`,
  };
}

export type TechNewsWebPayload = {
  schemaVersion: 1;
  publishedAt: string;
  displayDate: string;
  /** Optional link to the day’s video (YouTube, Instagram, etc.) */
  videoUrl?: string | null;
  /** 11-char id after YouTube verify sync — used for embed */
  youtubeVideoId?: string | null;
  /** Must appear in YouTube description for automated sync */
  episodeVerificationToken?: string | null;
  /** Set in GitHub Actions — ties the episode JSON to the workflow run that built it */
  sourceWorkflowRunId?: string | null;
  sourceWorkflowRunUrl?: string | null;
  localBusiness?: {
    name: string;
    category: string;
    description: string;
    website?: string | null;
  } | null;
  /**
   * Neighborhood / episode SEO — surfaced in post JSON for site meta (e.g. Open Graph keywords).
   */
  seoKeywords?: string[];
  /**
   * Linden Hills local business row: screenshot + link (consumer UI label: **Local Spotlight**).
   */
  localSpotlight?: {
    label: 'Local Spotlight';
    businessName: string;
    websiteUrl: string;
    /** Relative under news root, e.g. `posts/images/YYYY-MM-DD/local-spotlight.jpg` */
    image: string | null;
    imageUrl: string | null;
  } | null;
  tickerLine: string;
  socialCaption: string;
  /** Plain-text editor column (no Markdown). */
  videoPrompt: string;
  onAirPlain: string;
  stories: Array<{
    storyIndex: number;
    section: string;
    title: string;
    link: string;
    /** Headline line after a STORY delimiter (or legacy `## ` heading) */
    studioHeadline: string;
    /** SCREENSHOT / NOTE lines under that story */
    studioNotes: string;
    /** Relative to bundle root (generic) or under `/news/` (Instakyle post) */
    image: string | null;
    /** Absolute URL when a public base was configured */
    imageUrl: string | null;
    /**
     * Seconds from the start of the embedded YouTube video for this story.
     * When **every** story has this set, Instakyle syncs the source slideshow to playback.
     */
    videoStartSec?: number | null;
  }>;
};

export type TechNewsPostPayload = TechNewsWebPayload & {
  /** `YYYY-MM-DD` in America/Chicago — URL slug */
  slug: string;
};

export type NewsManifest = {
  schemaVersion: 1;
  /** Main heading for `/news` index pages that read this manifest (e.g. Instakyle). */
  indexTitle?: string;
  /** Subheading under the index title; empty string means show none. */
  indexSubtitle?: string;
  items: Array<{
    slug: string;
    displayDate: string;
    title: string;
    publishedAt: string;
    videoUrl?: string | null;
  }>;
};

function looksLikePlainStoryFormat(s: string): boolean {
  return s.split('\n').some((l) => l.trim() === 'STORY');
}

function parseStoryDelimiterSections(
  text: string
): Array<{ headline: string; body: string }> {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const sections: Array<{ headline: string; body: string }> = [];
  let i = 0;
  while (i < lines.length) {
    const trimmed = lines[i].trim();
    if (trimmed === 'CLOSE') break;
    if (trimmed === 'STORY') {
      i++;
      while (i < lines.length && lines[i].trim() === '') i++;
      if (i >= lines.length) break;
      const headline = lines[i].trim();
      i++;
      if (/^close\b/i.test(headline)) continue;
      const bodyLines: string[] = [];
      while (i < lines.length) {
        const t = lines[i].trim();
        if (t === 'STORY' || t === 'CLOSE') break;
        bodyLines.push(lines[i]);
        i++;
      }
      sections.push({ headline, body: bodyLines.join('\n').trim() });
      continue;
    }
    i++;
  }
  return sections;
}

/** Legacy Gemini output: `## Headline` sections. */
function parseMarkdownHashSections(
  videoPrompt: string
): Array<{ headline: string; body: string }> {
  const lines = videoPrompt.replace(/\r\n/g, '\n').split('\n');
  const sections: Array<{ headline: string; body: string }> = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith('## ')) {
      const headline = line.slice(3).trim();
      i++;
      const bodyLines: string[] = [];
      while (i < lines.length && !lines[i].startsWith('## ')) {
        bodyLines.push(lines[i]);
        i++;
      }
      if (/^close\b/i.test(headline)) continue;
      sections.push({ headline, body: bodyLines.join('\n').trim() });
    } else {
      i++;
    }
  }
  return sections;
}

/**
 * Story blocks from VIDEO PROMPT: **STORY** / **CLOSE** plain format preferred;
 * falls back to legacy Markdown `##` sections if no STORY lines or plain parses empty.
 */
export function parseVideoPromptStorySections(
  videoPrompt: string
): Array<{ headline: string; body: string }> {
  const normalized = videoPrompt.replace(/\r\n/g, '\n');
  if (looksLikePlainStoryFormat(normalized)) {
    const plain = parseStoryDelimiterSections(normalized);
    if (plain.length > 0) return plain;
  }
  return parseMarkdownHashSections(normalized);
}

function joinUrl(base: string, rel: string): string {
  const b = base.replace(/\/+$/, '');
  const r = rel.replace(/^\/+/, '');
  return `${b}/${r}`;
}

/** Default **newest-first** by `publishedAt`; set `TECHNEWS_BLOG_STORY_ORDER=script` for `<<<SOURCES>>>` order. */
function blogStoryOrderMode(): 'newest' | 'script' {
  const v = process.env.TECHNEWS_BLOG_STORY_ORDER?.trim().toLowerCase();
  if (v === 'script' || v === 'sources' || v === 'on_air') return 'script';
  return 'newest';
}

function sortStoriesForBlogOrder(
  stories: WebPublishStoryInput[],
  mode: 'newest' | 'script'
): WebPublishStoryInput[] {
  if (mode === 'script' || stories.length <= 1) return [...stories];
  return [...stories].sort((a, b) => {
    const ta = a.publishedAt ? Date.parse(a.publishedAt) : NaN;
    const tb = b.publishedAt ? Date.parse(b.publishedAt) : NaN;
    const taN = Number.isFinite(ta) ? ta : Number.NEGATIVE_INFINITY;
    const tbN = Number.isFinite(tb) ? tb : Number.NEGATIVE_INFINITY;
    return tbN - taN;
  });
}

/**
 * `WEB_VIDEO_START_SECS` — comma-separated non-negative numbers, one per story **in order**
 * (same order as `stories` passed to `writeTechNewsWebBundle`). Example: `0,42,88,135`.
 */
function parseWebVideoStartSecsEnv(storyCount: number): number[] | null {
  const raw = process.env.WEB_VIDEO_START_SECS?.trim();
  if (!raw || storyCount <= 0) return null;
  const parts = raw.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
  if (parts.length !== storyCount) {
    console.warn(
      `WEB: WEB_VIDEO_START_SECS has ${parts.length} value(s) but ${storyCount} stories — ignoring env`
    );
    return null;
  }
  const out: number[] = [];
  for (const p of parts) {
    const v = Number(p);
    if (!Number.isFinite(v) || v < 0) {
      console.warn(
        `WEB: WEB_VIDEO_START_SECS invalid segment "${p}" — ignoring entire env`
      );
      return null;
    }
    out.push(Math.floor(v));
  }
  return out;
}

type PrevStoryRow = { storyIndex: number; videoStartSec?: number | null };

function resolveStoryVideoStartSec(
  index: number,
  b: { storyIndex: number },
  input: WebPublishStoryInput,
  envSecs: number[] | null,
  prevStories: PrevStoryRow[] | undefined
): number | undefined {
  if (typeof input.videoStartSec === 'number' && input.videoStartSec >= 0) {
    return Math.floor(input.videoStartSec);
  }
  if (input.videoStartSec === null) {
    return undefined;
  }
  if (envSecs) {
    return envSecs[index]!;
  }
  const prev = prevStories?.find((p) => p.storyIndex === b.storyIndex);
  if (typeof prev?.videoStartSec === 'number' && prev.videoStartSec >= 0) {
    return Math.floor(prev.videoStartSec);
  }
  return undefined;
}

/** A `Date` somewhere on Chicago calendar day `slug` (for formatting). */
function chicagoNoonOnSlugDay(slug: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(slug)) {
    throw new Error(`chicagoNoonOnSlugDay: invalid slug "${slug}"`);
  }
  const [ys, ms, ds] = slug.split('-');
  const y = Number(ys);
  const mo = Number(ms);
  const da = Number(ds);
  const dayFmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const target = `${y}-${String(mo).padStart(2, '0')}-${String(da).padStart(2, '0')}`;
  const start = Date.UTC(y, mo - 1, da, 0, 0, 0);
  for (let h = 0; h < 48; h++) {
    const dt = new Date(start + h * 3600000);
    if (dayFmt.format(dt) === target) {
      return dt;
    }
  }
  return new Date(start + 12 * 3600000);
}

/**
 * “Now” for episode dating: real clock, or anchor for `TECHNEWS_CHICAGO_DATE` backfill.
 */
export function getChicagoEpisodeNow(): Date {
  const fromEnv = process.env.TECHNEWS_CHICAGO_DATE?.trim();
  if (fromEnv && /^\d{4}-\d{2}-\d{2}$/.test(fromEnv)) {
    return chicagoNoonOnSlugDay(fromEnv);
  }
  return new Date();
}

/**
 * YYYY-MM-DD in America/Chicago (episode day).
 * Set **`TECHNEWS_CHICAGO_DATE=YYYY-MM-DD`** to backfill that calendar day’s slug / token
 * (workflow_dispatch or local); otherwise uses `d` (default: current instant).
 */
export function chicagoDateSlug(d = new Date()): string {
  const fromEnv = process.env.TECHNEWS_CHICAGO_DATE?.trim();
  if (fromEnv && /^\d{4}-\d{2}-\d{2}$/.test(fromEnv)) {
    return fromEnv;
  }
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/**
 * Paste into the YouTube Short / video description; **Verify YouTube and sync episode**
 * checks `snippet.description` contains this exact string. Date-only so the same line stays valid
 * if the daily agent re-runs (GitHub run id is not embedded).
 */
export function buildEpisodeVerificationToken(slug: string): string {
  return `TND-${slug}`;
}

/** 11-char id from watch / shorts / embed URL or raw id. */
export function extractYoutubeVideoId(input: string): string | null {
  const u = input.trim();
  if (!u) return null;
  if (/^[\w-]{11}$/.test(u)) return u;
  try {
    const url = new URL(u);
    const host = url.hostname.replace(/^www\./i, '');
    if (host === 'youtu.be') {
      const id = url.pathname.split('/').filter(Boolean)[0] ?? '';
      return /^[\w-]{11}$/.test(id) ? id : null;
    }
    if (host.endsWith('youtube.com')) {
      const v = url.searchParams.get('v');
      if (v && /^[\w-]{11}$/.test(v)) return v;
      const m = url.pathname.match(/\/(?:shorts|embed)\/([\w-]{11})/);
      if (m?.[1]) return m[1];
    }
  } catch {
    return null;
  }
  return null;
}

async function readManifest(path: string): Promise<NewsManifest> {
  try {
    const raw = await readFile(path, 'utf8');
    const j = JSON.parse(raw) as NewsManifest;
    if (j?.schemaVersion === 1 && Array.isArray(j.items)) return j;
  } catch {
    /* missing or invalid */
  }
  return { schemaVersion: 1, items: [] };
}

/**
 * Email can still attach Playwright JPEGs; Instakyle `posts/{slug}.json` omits
 * `image` / `imageUrl` and does not write `posts/images/{slug}/*` unless enabled.
 */
function instakyleScreenshotsEnabled(): boolean {
  const v = process.env.TECHNEWS_INSTAKYLE_SCREENSHOTS?.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

export type WriteWebBundleOptions = {
  /**
   * Generic bundle: `latest.json`, `images/`, optional `technews.html`.
   * Omit if you only publish to Instakyle `public/news`.
   */
  outDir?: string;
  /**
   * Instakyle (or any static site): `manifest.json`, `posts/{slug}.json`,
   * and optionally `posts/images/{slug}/*.jpg` when `TECHNEWS_INSTAKYLE_SCREENSHOTS=1`.
   */
  instakyleNewsDir?: string;
  tickerLine: string;
  socialCaption: string;
  videoPrompt: string;
  onAirPlain: string;
  stories: WebPublishStoryInput[];
  localBusiness?: {
    name: string;
    category: string;
    description: string;
    website?: string | null;
  } | null;
  seoKeywords?: string[];
  localSpotlight?: {
    websiteUrl: string;
    businessName: string;
    imageFilename?: string;
    imageBuffer?: Buffer;
  } | null;
  /** Optional link embedded in JSON + manifest (e.g. YouTube). */
  videoUrl?: string | null;
  /**
   * Prefix for `imageUrl` in **generic** `latest.json` (where that bundle is hosted).
   */
  publicBaseUrl?: string;
  /**
   * Site origin for **Instakyle** post JSON, e.g. `https://instakyle.tech` →
   * `imageUrl` = `{origin}/news/posts/images/...`
   */
  siteOrigin?: string;
  /** Copy `web/technews.html` into generic `outDir` when true (default true). */
  includeHtmlShell?: boolean;
  htmlTemplatePath?: string;
};

export async function writeTechNewsWebBundle(
  opts: WriteWebBundleOptions
): Promise<void> {
  const {
    outDir,
    instakyleNewsDir,
    tickerLine,
    socialCaption,
    videoPrompt,
    onAirPlain,
    stories,
    localBusiness = null,
    seoKeywords,
    localSpotlight: localSpotlightInput = null,
    videoUrl = null,
    publicBaseUrl,
    siteOrigin,
    includeHtmlShell = true,
    htmlTemplatePath,
  } = opts;

  const genericRoot = outDir?.trim();
  const instakyleRoot = instakyleNewsDir?.trim();
  if (!genericRoot && !instakyleRoot) {
    throw new Error('writeTechNewsWebBundle: set outDir and/or instakyleNewsDir');
  }

  const blogOrder = blogStoryOrderMode();
  const storiesOrdered = sortStoriesForBlogOrder(stories, blogOrder);
  if (blogOrder === 'newest' && stories.length > 1) {
    console.log(
      `WEB: blog story order = newest-first (set TECHNEWS_BLOG_STORY_ORDER=script for <<<SOURCES>>> order)`
    );
  }

  const sections = parseVideoPromptStorySections(videoPrompt);
  if (sections.length !== storiesOrdered.length && storiesOrdered.length > 0) {
    console.warn(
      `WEB: VIDEO PROMPT has ${sections.length} story blocks but ${storiesOrdered.length} sourced stories — studio headlines may not line up; falling back to feed titles where needed.`
    );
  }

  const tz = 'America/Chicago';
  const episodeNow = getChicagoEpisodeNow();
  const displayDate = episodeNow.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: tz,
  });

  const slug = chicagoDateSlug(episodeNow);
  const episodeVerificationToken = buildEpisodeVerificationToken(slug);
  const shortTitleDate = episodeNow.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: tz,
  });
  const listTitle = `Tech News Daily with Kyle — ${shortTitleDate}`;

  type BuiltRow = {
    storyIndex: number;
    section: string;
    title: string;
    link: string;
    studioHeadline: string;
    studioNotes: string;
    imageFilename?: string;
    imageBuffer?: Buffer;
  };

  const built: BuiltRow[] = [];
  for (let i = 0; i < storiesOrdered.length; i++) {
    const s = storiesOrdered[i]!;
    const sec = sections[i];
    built.push({
      storyIndex: s.storyIndex,
      section: s.section,
      title: s.title,
      link: s.link,
      studioHeadline: sec?.headline?.trim() || s.title,
      studioNotes: sec?.body?.trim() || '',
      imageFilename: s.imageFilename,
      imageBuffer: s.imageBuffer,
    });
  }

  const envVideoStarts = parseWebVideoStartSecsEnv(built.length);

  const genericBase = publicBaseUrl?.trim().replace(/\/+$/, '') || '';
  const origin = siteOrigin?.trim().replace(/\/+$/, '') || '';

  let localSpotlightGeneric: TechNewsWebPayload['localSpotlight'] = null;
  let localSpotlightInstakyle: TechNewsWebPayload['localSpotlight'] = null;
  if (localSpotlightInput?.websiteUrl?.trim() && localSpotlightInput.businessName?.trim()) {
    const spotlightUrl = localSpotlightInput.websiteUrl.trim();
    const spotlightName = localSpotlightInput.businessName.trim();
    const fn =
      localSpotlightInput.imageFilename?.trim() || 'local-spotlight.jpg';
    const baseRow = {
      label: 'Local Spotlight' as const,
      businessName: spotlightName,
      websiteUrl: spotlightUrl,
      image: null as string | null,
      imageUrl: null as string | null,
    };
    if (localSpotlightInput.imageBuffer?.length) {
      if (genericRoot) {
        const relG = `images/${fn}`;
        await mkdir(join(genericRoot, 'images'), { recursive: true });
        await writeFile(join(genericRoot, relG), localSpotlightInput.imageBuffer);
        localSpotlightGeneric = {
          ...baseRow,
          image: relG,
          imageUrl: genericBase ? joinUrl(genericBase, relG) : null,
        };
      }
      if (instakyleRoot) {
        const relI = `posts/images/${slug}/${fn}`;
        await mkdir(join(instakyleRoot, dirname(relI)), { recursive: true });
        await writeFile(join(instakyleRoot, relI), localSpotlightInput.imageBuffer);
        const abs = origin ? joinUrl(origin, joinUrl('news', relI)) : null;
        localSpotlightInstakyle = {
          ...baseRow,
          image: relI,
          imageUrl: abs,
        };
      }
    } else {
      if (genericRoot) localSpotlightGeneric = { ...baseRow };
      if (instakyleRoot) localSpotlightInstakyle = { ...baseRow };
    }
  }

  if (genericRoot) {
    const imagesDir = join(genericRoot, 'images');
    await mkdir(imagesDir, { recursive: true });
    let prevLatest: Partial<TechNewsWebPayload> | null = null;
    try {
      prevLatest = JSON.parse(
        await readFile(join(genericRoot, 'latest.json'), 'utf8')
      ) as Partial<TechNewsWebPayload>;
    } catch {
      /* no prior bundle */
    }
    const mergedGenVideo =
      (videoUrl && videoUrl.trim()) || prevLatest?.videoUrl || null;
    const mergedGenYoutubeId =
      prevLatest?.youtubeVideoId != null ? prevLatest.youtubeVideoId : null;

    const payloadStories: TechNewsWebPayload['stories'] = [];

    for (let i = 0; i < built.length; i++) {
      const b = built[i]!;
      const input = storiesOrdered[i]!;
      let relImage: string | null = null;
      if (b.imageFilename && b.imageBuffer?.length) {
        relImage = `images/${b.imageFilename}`;
        await writeFile(join(genericRoot, relImage), b.imageBuffer);
      }
      const imageUrl =
        relImage && genericBase ? joinUrl(genericBase, relImage) : null;
      const videoStartSec = resolveStoryVideoStartSec(
        i,
        b,
        input,
        envVideoStarts,
        prevLatest?.stories
      );
      const row: TechNewsWebPayload['stories'][number] = {
        storyIndex: b.storyIndex,
        section: b.section,
        title: b.title,
        link: b.link,
        studioHeadline: b.studioHeadline,
        studioNotes: b.studioNotes,
        image: relImage,
        imageUrl,
      };
      if (videoStartSec !== undefined) {
        row.videoStartSec = videoStartSec;
      }
      payloadStories.push(row);
    }

    const runMeta = workflowRunMeta();
    const payload: TechNewsWebPayload = {
      schemaVersion: 1,
      publishedAt: new Date().toISOString(),
      displayDate,
      videoUrl: mergedGenVideo,
      youtubeVideoId: mergedGenYoutubeId,
      episodeVerificationToken,
      ...runMeta,
      localBusiness,
      ...(seoKeywords?.length ? { seoKeywords } : {}),
      ...(localSpotlightGeneric ? { localSpotlight: localSpotlightGeneric } : {}),
      tickerLine,
      socialCaption,
      videoPrompt,
      onAirPlain,
      stories: payloadStories,
    };

    await writeFile(
      join(genericRoot, 'latest.json'),
      JSON.stringify(payload, null, 2),
      'utf8'
    );

    if (includeHtmlShell) {
      const defaultTemplate = join(__dirname, 'web', 'technews.html');
      const src = htmlTemplatePath ?? defaultTemplate;
      try {
        const html = await readFile(src, 'utf8');
        await writeFile(join(genericRoot, 'technews.html'), html, 'utf8');
      } catch (e) {
        console.warn(
          'WEB: could not copy technews.html template:',
          e instanceof Error ? e.message : e
        );
      }
    }

    console.log(
      `WEB: generic bundle → ${genericRoot} (latest.json + images + technews.html)`
    );
  }

  if (instakyleRoot) {
    const postsDir = join(instakyleRoot, 'posts');
    const imgDir = join(postsDir, 'images', slug);
    const instakyleShots = instakyleScreenshotsEnabled();
    if (instakyleShots) {
      await mkdir(imgDir, { recursive: true });
    }

    const postPath = join(postsDir, `${slug}.json`);
    let prevPost: Partial<TechNewsPostPayload> | null = null;
    try {
      prevPost = JSON.parse(await readFile(postPath, 'utf8')) as Partial<TechNewsPostPayload>;
    } catch {
      /* no prior post */
    }

    const postStories: TechNewsWebPayload['stories'] = [];
    for (let i = 0; i < built.length; i++) {
      const b = built[i]!;
      const input = storiesOrdered[i]!;
      let rel: string | null = null;
      if (
        instakyleShots &&
        b.imageFilename &&
        b.imageBuffer?.length
      ) {
        rel = `posts/images/${slug}/${b.imageFilename}`;
        await writeFile(join(instakyleRoot, rel), b.imageBuffer);
      }
      const imageUrl =
        rel && origin ? joinUrl(origin, joinUrl('news', rel)) : null;
      const videoStartSec = resolveStoryVideoStartSec(
        i,
        b,
        input,
        envVideoStarts,
        prevPost?.stories
      );
      const row: TechNewsWebPayload['stories'][number] = {
        storyIndex: b.storyIndex,
        section: b.section,
        title: b.title,
        link: b.link,
        studioHeadline: b.studioHeadline,
        studioNotes: b.studioNotes,
        image: rel,
        imageUrl,
      };
      if (videoStartSec !== undefined) {
        row.videoStartSec = videoStartSec;
      }
      postStories.push(row);
    }
    const mergedPostVideo =
      (videoUrl && videoUrl.trim()) || prevPost?.videoUrl || null;
    const mergedPostYoutubeId =
      prevPost?.youtubeVideoId != null ? prevPost.youtubeVideoId : null;

    const runMeta = workflowRunMeta();
    const postPayload: TechNewsPostPayload = {
      schemaVersion: 1,
      slug,
      publishedAt: new Date().toISOString(),
      displayDate,
      videoUrl: mergedPostVideo,
      youtubeVideoId: mergedPostYoutubeId,
      episodeVerificationToken,
      ...runMeta,
      localBusiness,
      ...(seoKeywords?.length ? { seoKeywords } : {}),
      ...(localSpotlightInstakyle ? { localSpotlight: localSpotlightInstakyle } : {}),
      tickerLine,
      socialCaption,
      videoPrompt,
      onAirPlain,
      stories: postStories,
    };

    await writeFile(postPath, JSON.stringify(postPayload, null, 2), 'utf8');

    const manifestPath = join(instakyleRoot, 'manifest.json');
    const manifest = await readManifest(manifestPath);
    const entry = {
      slug,
      displayDate,
      title: listTitle,
      publishedAt: postPayload.publishedAt,
      videoUrl: mergedPostVideo,
    };
    manifest.indexTitle = 'Tech News Daily with Kyle';
    manifest.indexSubtitle = '';
    manifest.items = [
      entry,
      ...manifest.items.filter((it) => it.slug !== slug),
    ];
    await writeFile(
      manifestPath,
      JSON.stringify(manifest, null, 2),
      'utf8'
    );

    console.log(
      `WEB: Instakyle /news archive → ${instakyleRoot} (posts/${slug}.json + manifest)`
    );
  }
}
