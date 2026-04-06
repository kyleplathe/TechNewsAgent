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
  /** Set in GitHub Actions — ties the episode JSON to the workflow run that built it */
  sourceWorkflowRunId?: string | null;
  sourceWorkflowRunUrl?: string | null;
  tickerLine: string;
  socialCaption: string;
  videoPromptMarkdown: string;
  onAirPlain: string;
  stories: Array<{
    storyIndex: number;
    section: string;
    title: string;
    link: string;
    /** `##` heading from VIDEO PROMPT when parseable */
    studioHeadline: string;
    /** Bullets under that heading (SCREENSHOT / NOTE, etc.) */
    studioNotesMarkdown: string;
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

/**
 * Pull non-Close `##` sections from the model's VIDEO PROMPT (Markdown).
 * Order should match on-air story order when the model follows instructions.
 */
export function parseVideoPromptStorySections(
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
  videoPromptMarkdown: string;
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
    videoPromptMarkdown,
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

  const sections = parseVideoPromptStorySections(videoPromptMarkdown);
  if (sections.length !== stories.length && stories.length > 0) {
    console.warn(
      `WEB: VIDEO PROMPT has ${sections.length} non-Close ## sections but ${stories.length} sourced stories — studio headlines may not line up; falling back to feed titles where needed.`
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
    studioNotesMarkdown: string;
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
      studioNotesMarkdown: sec?.body?.trim() || '',
      imageFilename: s.imageFilename,
      imageBuffer: s.imageBuffer,
    });
  }

  const genericBase = publicBaseUrl?.trim().replace(/\/+$/, '') || '';
  const origin = siteOrigin?.trim().replace(/\/+$/, '') || '';

  if (genericRoot) {
    const imagesDir = join(genericRoot, 'images');
    await mkdir(imagesDir, { recursive: true });
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
        studioNotesMarkdown: b.studioNotesMarkdown,
        image: relImage,
        imageUrl,
      });
    }

    const runMeta = workflowRunMeta();
    const payload: TechNewsWebPayload = {
      schemaVersion: 1,
      publishedAt: new Date().toISOString(),
      displayDate,
      videoUrl: videoUrl || null,
      ...runMeta,
      tickerLine,
      socialCaption,
      videoPromptMarkdown,
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
        studioNotesMarkdown: b.studioNotesMarkdown,
        image: rel,
        imageUrl,
      });
    }

    const runMeta = workflowRunMeta();
    const postPayload: TechNewsPostPayload = {
      schemaVersion: 1,
      slug,
      publishedAt: new Date().toISOString(),
      displayDate,
      videoUrl: videoUrl || null,
      ...runMeta,
      tickerLine,
      socialCaption,
      videoPromptMarkdown,
      onAirPlain,
      stories: postStories,
    };

    await writeFile(
      join(postsDir, `${slug}.json`),
      JSON.stringify(postPayload, null, 2),
      'utf8'
    );

    const manifestPath = join(instakyleRoot, 'manifest.json');
    const manifest = await readManifest(manifestPath);
    const entry = {
      slug,
      displayDate,
      title: listTitle,
      publishedAt: postPayload.publishedAt,
      videoUrl: videoUrl || null,
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
