/**
 * Confirms a YouTube video description contains `episodeVerificationToken` from the
 * day’s post JSON, then writes `videoUrl` + `youtubeVideoId` and updates `manifest.json`.
 *
 *   YOUTUBE_API_KEY=... npx tsx scripts/youtube-verify-and-sync.ts --news-dir /path/to/public/news
 *     [--youtube-url "https://..."]   # optional; if omitted, auto-discovers by token
 *     [--slug YYYY-MM-DD]              # default: Chicago today
 *     [--channel-id UC...]             # optional filter for auto-discovery
 *     [--allow-missing]                # return success when auto-discovery finds nothing
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
type SearchListResponse = {
  items?: Array<{ id?: { videoId?: string } }>;
};

function parseArgs(argv: string[]): {
  youtubeUrl: string | null;
  newsDir: string;
  slug: string | null;
  channelId: string | null;
  allowMissing: boolean;
} {
  let youtubeUrl: string | null = null;
  let newsDir = '';
  let slug: string | null = null;
  let channelId: string | null = null;
  let allowMissing = false;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--youtube-url' && argv[i + 1]) {
      youtubeUrl = argv[++i];
    } else if (a === '--news-dir' && argv[i + 1]) {
      newsDir = argv[++i];
    } else if (a === '--slug' && argv[i + 1]) {
      slug = argv[++i];
    } else if (a === '--channel-id' && argv[i + 1]) {
      channelId = argv[++i];
    } else if (a === '--allow-missing') {
      allowMissing = true;
    }
  }
  return { youtubeUrl, newsDir, slug, channelId, allowMissing };
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

async function discoverVideoIdByToken(
  token: string,
  apiKey: string,
  channelId: string | null
): Promise<string | null> {
  const u = new URL('https://www.googleapis.com/youtube/v3/search');
  u.searchParams.set('part', 'snippet');
  u.searchParams.set('type', 'video');
  u.searchParams.set('order', 'date');
  u.searchParams.set('maxResults', '8');
  u.searchParams.set('q', token);
  u.searchParams.set('key', apiKey);
  if (channelId) u.searchParams.set('channelId', channelId);

  const res = await fetch(u);
  const data = (await res.json()) as SearchListResponse;
  if (!res.ok) {
    throw new Error(`YouTube search API ${res.status}: ${JSON.stringify(data)}`);
  }
  const ids = (data.items ?? [])
    .map((it) => it.id?.videoId?.trim() || '')
    .filter((id) => /^[\w-]{11}$/.test(id));
  for (const id of ids) {
    const desc = await fetchDescription(id, apiKey);
    if (desc.includes(token)) return id;
  }
  return null;
}

async function discoverVideoIdByTokenWithRetry(
  token: string,
  apiKey: string,
  channelId: string | null
): Promise<string | null> {
  const attempts = Math.min(
    20,
    Math.max(
      1,
      parseInt(process.env.YOUTUBE_DISCOVERY_ATTEMPTS ?? '8', 10) || 8
    )
  );
  const sleepMs = Math.min(
    120_000,
    Math.max(
      5_000,
      parseInt(process.env.YOUTUBE_DISCOVERY_SLEEP_MS ?? '30000', 10) || 30_000
    )
  );
  for (let i = 1; i <= attempts; i++) {
    const id = await discoverVideoIdByToken(token, apiKey, channelId);
    if (id) return id;
    if (i < attempts) {
      console.log(
        `YouTube token search miss (${i}/${attempts}) for "${token}" — waiting ${Math.round(
          sleepMs / 1000
        )}s before retry...`
      );
      await new Promise((r) => setTimeout(r, sleepMs));
    }
  }
  return null;
}

async function main() {
  const { youtubeUrl, newsDir, slug: slugArg, channelId, allowMissing } =
    parseArgs(process.argv);
  if (!newsDir) {
    throw new Error(
      'Usage: tsx scripts/youtube-verify-and-sync.ts --news-dir <public/news> [--youtube-url <url>] [--slug YYYY-MM-DD] [--channel-id UC...] [--allow-missing]'
    );
  }
  const apiKey = process.env.YOUTUBE_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('Set YOUTUBE_API_KEY (YouTube Data API v3, videos.list).');
  }

  const slug = slugArg?.trim() || chicagoDateSlug();

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

  let videoId: string | null = null;
  if (youtubeUrl?.trim()) {
    videoId = extractYoutubeVideoId(youtubeUrl);
    if (!videoId) {
      throw new Error(`Could not parse YouTube video id from: ${youtubeUrl}`);
    }
  } else {
    videoId = await discoverVideoIdByTokenWithRetry(token, apiKey, channelId);
    if (!videoId) {
      if (allowMissing) {
        console.log(
          `No YouTube video found yet containing token "${token}"${channelId ? ` on channel ${channelId}` : ''}; skipping sync.`
        );
        return;
      }
      throw new Error(
        `No YouTube video found containing token "${token}"${channelId ? ` on channel ${channelId}` : ''}.`
      );
    }
    console.log(`Auto-discovered YouTube video id ${videoId} for token ${token}.`);
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
