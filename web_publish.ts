import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export type WebPublishStoryInput = {
  storyIndex: number;
  section: string;
  title: string;
  link: string;
  /** JPEG filename (e.g. 01-slug.jpg) when a screenshot exists for this story */
  imageFilename?: string;
  imageBuffer?: Buffer;
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
  }>;
};

export type TechNewsPostPayload = TechNewsWebPayload & {
  /** `YYYY-MM-DD` in America/Chicago — URL slug */
  slug: string;
};

export type NewsManifest = {
  schemaVersion: 1;
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

/** YYYY-MM-DD in America/Chicago (episode day). */
export function chicagoDateSlug(d = new Date()): string {
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

export type WriteWebBundleOptions = {
  /**
   * Generic bundle: `latest.json`, `images/`, optional `technews.html`.
   * Omit if you only publish to Instakyle `public/news`.
   */
  outDir?: string;
  /**
   * Instakyle (or any static site): `manifest.json`, `posts/{slug}.json`,
   * `posts/images/{slug}/*.jpg` under this directory (= repo `public/news`).
   */
  instakyleNewsDir?: string;
  tickerLine: string;
  socialCaption: string;
  videoPrompt: string;
  onAirPlain: string;
  stories: WebPublishStoryInput[];
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

  const sections = parseVideoPromptStorySections(videoPrompt);
  if (sections.length !== stories.length && stories.length > 0) {
    console.warn(
      `WEB: VIDEO PROMPT has ${sections.length} story blocks but ${stories.length} sourced stories — studio headlines may not line up; falling back to feed titles where needed.`
    );
  }

  const tz = 'America/Chicago';
  const displayDate = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: tz,
  });

  const slug = chicagoDateSlug();
  const episodeVerificationToken = buildEpisodeVerificationToken(slug);
  const shortTitleDate = new Date().toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: tz,
  });
  const listTitle = `Tech News Daily — ${shortTitleDate}`;

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
  for (let i = 0; i < stories.length; i++) {
    const s = stories[i];
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

  const genericBase = publicBaseUrl?.trim().replace(/\/+$/, '') || '';
  const origin = siteOrigin?.trim().replace(/\/+$/, '') || '';

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

    for (const b of built) {
      let relImage: string | null = null;
      if (b.imageFilename && b.imageBuffer?.length) {
        relImage = `images/${b.imageFilename}`;
        await writeFile(join(genericRoot, relImage), b.imageBuffer);
      }
      const imageUrl =
        relImage && genericBase ? joinUrl(genericBase, relImage) : null;
      payloadStories.push({
        storyIndex: b.storyIndex,
        section: b.section,
        title: b.title,
        link: b.link,
        studioHeadline: b.studioHeadline,
        studioNotes: b.studioNotes,
        image: relImage,
        imageUrl,
      });
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
    await mkdir(imgDir, { recursive: true });

    const postStories: TechNewsWebPayload['stories'] = [];
    for (const b of built) {
      let rel: string | null = null;
      if (b.imageFilename && b.imageBuffer?.length) {
        rel = `posts/images/${slug}/${b.imageFilename}`;
        await writeFile(join(instakyleRoot, rel), b.imageBuffer);
      }
      const imageUrl =
        rel && origin ? joinUrl(origin, joinUrl('news', rel)) : null;
      postStories.push({
        storyIndex: b.storyIndex,
        section: b.section,
        title: b.title,
        link: b.link,
        studioHeadline: b.studioHeadline,
        studioNotes: b.studioNotes,
        image: rel,
        imageUrl,
      });
    }

    const postPath = join(postsDir, `${slug}.json`);
    let prevPost: Partial<TechNewsPostPayload> | null = null;
    try {
      prevPost = JSON.parse(await readFile(postPath, 'utf8')) as Partial<TechNewsPostPayload>;
    } catch {
      /* no prior post */
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
