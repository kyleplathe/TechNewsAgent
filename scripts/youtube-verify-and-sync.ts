/**
 * Confirms a YouTube video description contains `episodeVerificationToken` from the
 * day’s post JSON, then writes `videoUrl` + `youtubeVideoId` and updates `manifest.json`.
 *
 *   YOUTUBE_API_KEY=... npx tsx scripts/youtube-verify-and-sync.ts --youtube-url "https://..."
 *     --news-dir /path/to/public/news
 *     [--slug YYYY-MM-DD]   # default: Chicago today
 */
import 'dotenv/config';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  chicagoDateSlug,
  extractYoutubeVideoId,
  type NewsManifest,
  type TechNewsPostPayload,
} from '../web_publish';

type VideosListResponse = {
  items?: Array<{ snippet?: { description?: string } }>;
};

function parseArgs(argv: string[]): {
  youtubeUrl: string;
  newsDir: string;
  slug: string | null;
} {
  let youtubeUrl = '';
  let newsDir = '';
  let slug: string | null = null;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--youtube-url' && argv[i + 1]) {
      youtubeUrl = argv[++i];
    } else if (a === '--news-dir' && argv[i + 1]) {
      newsDir = argv[++i];
    } else if (a === '--slug' && argv[i + 1]) {
      slug = argv[++i];
    }
  }
  return { youtubeUrl, newsDir, slug };
}

async function fetchDescription(
  videoId: string,
  apiKey: string
): Promise<string> {
  const u = new URL('https://www.googleapis.com/youtube/v3/videos');
  u.searchParams.set('part', 'snippet');
  u.searchParams.set('id', videoId);
  u.searchParams.set('key', apiKey);
  const res = await fetch(u);
  const data = (await res.json()) as VideosListResponse;
  if (!res.ok) {
    throw new Error(`YouTube API ${res.status}: ${JSON.stringify(data)}`);
  }
  const desc = data.items?.[0]?.snippet?.description;
  if (desc == null) {
    throw new Error(
      `No video found for id ${videoId} (check URL / API key / quota).`
    );
  }
  return desc;
}

async function main() {
  const { youtubeUrl, newsDir, slug: slugArg } = parseArgs(process.argv);
  if (!youtubeUrl || !newsDir) {
    throw new Error(
      'Usage: tsx scripts/youtube-verify-and-sync.ts --youtube-url <url> --news-dir <public/news> [--slug YYYY-MM-DD]'
    );
  }
  const apiKey = process.env.YOUTUBE_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('Set YOUTUBE_API_KEY (YouTube Data API v3, videos.list).');
  }

  const slug = slugArg?.trim() || chicagoDateSlug();
  const videoId = extractYoutubeVideoId(youtubeUrl);
  if (!videoId) {
    throw new Error(`Could not parse YouTube video id from: ${youtubeUrl}`);
  }

  const postPath = join(newsDir, 'posts', `${slug}.json`);
  const raw = await readFile(postPath, 'utf8');
  const post = JSON.parse(raw) as TechNewsPostPayload;
  if (post.schemaVersion !== 1 || !Array.isArray(post.stories)) {
    throw new Error(`Invalid post JSON: ${postPath}`);
  }

  const token =
    typeof post.episodeVerificationToken === 'string'
      ? post.episodeVerificationToken.trim()
      : '';
  if (!token) {
    throw new Error(
      `${postPath} has no episodeVerificationToken — publish a fresh episode from the agent first.`
    );
  }

  const description = await fetchDescription(videoId, apiKey);
  if (!description.includes(token)) {
    const hint = description.slice(0, 280).replace(/\s+/g, ' ');
    throw new Error(
      `Description must include exactly "${token}". Snippet: ${hint}…`
    );
  }

  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const next: TechNewsPostPayload = {
    ...post,
    videoUrl,
    youtubeVideoId: videoId,
  };

  await writeFile(postPath, JSON.stringify(next, null, 2), 'utf8');

  const manifestPath = join(newsDir, 'manifest.json');
  let manifest: NewsManifest = { schemaVersion: 1, items: [] };
  try {
    const mraw = await readFile(manifestPath, 'utf8');
    const parsed = JSON.parse(mraw) as NewsManifest;
    if (parsed.schemaVersion === 1 && Array.isArray(parsed.items)) {
      manifest = parsed;
    }
  } catch {
    /* new manifest */
  }
  manifest.items = manifest.items.map((it) =>
    it.slug === slug ? { ...it, videoUrl } : it
  );
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  console.log(`OK — ${postPath} and manifest updated (${videoUrl}).`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
