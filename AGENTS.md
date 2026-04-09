# TechNewsAgent — agent / maintainer guide

Single Node script (`tech_news_agent.ts`) pulls RSS (+ NBA.com Timberwolves embedded JSON), calls Gemini for studio output, optionally attaches Playwright JPEGs, emails via Resend.

## Editorial scope

- **Tech:** Software, AI/ML, hardware & gadgets, gaming (news + industry), developer ecosystem, security when it’s tech news. Sources are listed in `tech_news_agent.ts` (`techFeeds` / `hardwareFeeds`).
- **Repair:** Tech repair/right-to-repair/serviceability/teardown beats. Tagged as **Tech Repair** on the blog and prioritized first in the on-air rundown when fresh (`repairFeeds`).
- **Sports:** Timberwolves — Canis Hoopus RSS + `nba_wolves_news.ts` (NBA.com index). Tagged **[LOCAL]**.
- **Skate:** Thrasher, Jenkem, Quartersnacks, Village Psychic, The Berrics (best-effort). Tagged **[SKATE]**.
- **Close:** Linden Hills neighborhood color + **required** one spoken mention of the chosen local business name (from `LOCAL_BIZ_NAME` or `local_businesses.ts` rotation), organic not a hard sell; Gemini prompt treats this as **non-negotiable** in ON AIR before the fixed sign-off.
- **Digital assets:** **Bitcoin-only** on-air and in headlines (`passesBitcoinOnlyCurrencyRule`). No altcoins, stablecoins, NFT/DeFi/Web3 industry beats. Set `BITCOIN_ONLY_CURRENCY_RULE=0` to disable filtering.

## Freshness

Default max age (overridable per section):

| Section   | Default hours | Env override                    |
|----------|---------------|----------------------------------|
| TECH     | 12            | `MAX_STORY_AGE_HOURS_TECH`       |
| REPAIR   | 24            | `MAX_STORY_AGE_HOURS_REPAIR`     |
| HARDWARE | 24            | `MAX_STORY_AGE_HOURS_HARDWARE`   |
| SKATE    | 24            | `MAX_STORY_AGE_HOURS_SKATE`      |
| LOCAL    | 24            | `MAX_STORY_AGE_HOURS_LOCAL`      |

Items **without a parseable `pubDate` / Atom date** are **dropped** unless `ALLOW_UNDATED_FEED_ITEMS=1` (escape hatch for broken feeds).

## Email layout (precision)

Order: **Ticker** → **ON AIR** (ALL CAPS) → **SOCIAL** caption → **YOUTUBE** (one-line `TND-YYYY-MM-DD` token — paste into the Short’s **description** so **Publish Tech News to Instakyle** can verify + sync the upload) → **SOURCE LINKS** → screenshot note + attachments.

Markers in model output: `<<<ON_AIR>>>`, `<<<SOURCES>>>` (one line of comma-separated 1-based story numbers = same numbers as the **numbered list** in the prompt — **which** stories are in the segment), then `<<<SOCIAL>>>` (short Threads-style body; the script prepends the title line and one hashtag line).

**SOURCE LINKS / blog row order (default):** those indices are **re-sorted to match `<<<ON_AIR>>>`** by earliest mention of each story’s link hostname and title tokens (normalized), so the list tracks **spoken order**, not necessarily the comma order in `<<<SOURCES>>>`. Set **`USE_SOURCES_LINE_ORDER=1`** (repo variable or env) to keep the model’s `<<<SOURCES>>>` line order verbatim instead.

If the email looks truncated or missing a column, check Gemini `maxOutputTokens` and API errors; markers must be exact.

## Screenshots (`screenshot_sources.ts`)

- Default **`SCREENSHOT_MODE=viewport`**: one **full mobile frame** per URL (~**393×852** CSS px with default `SCREENSHOT_MOBILE` — same shape as a normal phone screenshot: chrome + headline + first scroll fold). Consistent size for slides.
- **`SCREENSHOT_MODE=content`**: crop to article/main from the headline down, max height `SCREENSHOT_MAX_CONTENT_HEIGHT` (default **2400** CSS px); optional `SCREENSHOT_HEADLINE_IMAGE_ONLY=1` for tight h1+hero union.
- Disable screenshots: `SCREENSHOT_SOURCES=0`.

## Voiceover length (~90s desk)

Target **one take ~85–100s** (~**90s**). Best practice for a **daily reporter**: **one beat → one point → one proof** (headline + why it matters + a single concrete detail — number, name, mechanism — when the story gives it). Skip beats that need a paragraph; skip essay transitions. Close stays short (neighborhood + sign-off). Gemini prompt steers **away** from hype / podcast clichés (“hold on to your hats,” “deep dive,” “buckle up,” etc.) — calm bench voice, not trailer energy.

## CI schedule

`.github/workflows/daily_news.yml` — cron is **UTC** (`0 10 * * *` ≈ **5:00 AM America/Chicago** during **CDT**; ≈ **4:00 AM** during **CST** — switch to `0 11 * * *` in winter if you want 5:00 AM local all year). The workflow sets **`actions: write`** on the `GITHUB_TOKEN` (in addition to `contents: read`) so **`upload-artifact` succeeds**; a `permissions` block with only `contents: read` leaves `actions` at `none` and artifact upload will fail. **Do not use `secrets` inside step `if:`** (GitHub rejects the workflow); gate steps with a small shell step that sets `GITHUB_OUTPUT` from `env: INSTAKYLE_PUSH_TOKEN: ${{ secrets.INSTAKYLE_PUSH_TOKEN }}`.

With **`INSTAKYLE_PUSH_TOKEN`** set, the workflow checks out **Instakyle-clean** (to seed **`manifest.json`** when needed), runs the agent, then always uploads a **`news-site-bundle`** artifact (retention 5 days). Episode JSON includes **`sourceWorkflowRunId`** / **`sourceWorkflowRunUrl`** so you can match **instakyle.tech/news** to the exact Actions run (and the email from that run).

**Backfill several days (e.g. April 1–7)**  
Run **Daily Tech News Agent** from **Actions → Run workflow** seven times (or once per missing day). Set optional input **`chicago_date`** to each **`YYYY-MM-DD`** in Chicago. Each run regenerates that day’s feeds/Gemini output and writes **`posts/{slug}.json`** (full agent cost per day). If a slug **already exists** on Instakyle and you mean to replace it, set **`NEWS_SITE_FORCE_REPUBLISH=true`** for that run. Locally: `TECHNEWS_CHICAGO_DATE=2026-04-01 npx tsx tech_news_agent.ts` (still need Resend + web dirs as usual).  

**One live post per Chicago day (auto push)**  
If **`public/news/posts/YYYY-MM-DD.json`** already exists on the Instakyle default branch, the **auto** push step **skips** (no second post for the same calendar day). Set repository variable **`NEWS_SITE_FORCE_REPUBLISH=true`** on a rerun to replace that day’s files.

**`NEWS_SITE_PUBLISH_MODE` (repo variable)**  
- **`auto`** (default): after email, push Instakyle `public/news` when not blocked by the rule above.  
- **`manual`**: after email, **no push** — only the artifact. Copy **`manifest.json`** from the live site into staging first so the merged manifest keeps older episodes. Run workflow **Publish Tech News to Instakyle** when you’re ready (e.g. after filming). Use optional input **`source_run_id`** if “latest success” isn’t the run that matches your show; set **`force_replace_today`** to overwrite an episode already live.

**Secrets / vars for site publish**

| Name | Required | Purpose |
|------|----------|---------|
| `INSTAKYLE_PUSH_TOKEN` | For site + artifact | PAT on **Instakyle-clean** (contents read/write). Omit for **email-only** CI. |
| `NEWS_SITE_PUBLISH_MODE` | Optional | `auto` or `manual` (see above). |
| `NEWS_SITE_FORCE_REPUBLISH` | Optional | `true` to allow replacing today’s post on auto push. |
| `TECHNEWS_SITE_ORIGIN` | Optional | e.g. `https://instakyle.tech` — absolute `imageUrl` in post JSON when blog screenshots are on. |
| `TECHNEWS_INSTAKYLE_SCREENSHOTS` | Optional | `1` to write `posts/images/…` on Instakyle; default **off** (email JPEGs unchanged). |
| `TECHNEWS_VIDEO_URL` | Optional secret | That day’s video link on the post page. |
| `YOUTUBE_API_KEY` | For optional YouTube verify/sync in **Publish Tech News to Instakyle** | Google Cloud: enable **YouTube Data API v3**, restrict key to that API. Repo **Actions secret**; used to read `videos.list` and `search.list`. |
| `YOUTUBE_CHANNEL_ID` | Optional but recommended | Repo variable (e.g. `UC...`) to constrain auto-discovery to your channel when `youtube_url` is blank. |

**YouTube embed + verified link**

- Post JSON from `web_publish` includes **`episodeVerificationToken`** (`TND-{Chicago slug}`) and, after sync, **`youtubeVideoId`** + **`videoUrl`**. Re-running the daily agent the same day **preserves** synced `youtubeVideoId` / `videoUrl` when `TECHNEWS_VIDEO_URL` is unset.
- **`web/technews.html`** shows a responsive embed when `youtubeVideoId` or a parseable `videoUrl` is present.
- Workflow **Publish Tech News to Instakyle** now handles **YouTube sync only** (post JSON is already published by Daily email flow). **Actions → Run workflow** after filming. Provide optional `slug` or it uses the newest `manifest.json` item. If `youtube_url` is blank, it auto-searches YouTube by the `TND-YYYY-MM-DD` token (optionally constrained by **`YOUTUBE_CHANNEL_ID`**) and syncs when found; if not found after retries, the workflow fails so you can rerun once indexing catches up.

Local (explicit URL): `YOUTUBE_API_KEY=... npm run youtube:sync -- --youtube-url "…" --news-dir /path/to/public/news`
Local (auto-discover by token): `YOUTUBE_API_KEY=... npm run youtube:sync -- --news-dir /path/to/public/news --allow-missing`

## Secrets / env

Resend, Gemini, `RESEND_TO`, optional `FEED_ITEM_LIMIT`, `SCREENSHOT_*`, `GEMINI_MODEL`, optional `USE_SOURCES_LINE_ORDER` (see **SOURCE LINKS / blog row order** above), etc. Never commit `.env`.

## TechNews web bundle (optional)

Set **`TECHNEWS_WEB_DIR`** to an absolute or relative path; after a **successful Resend send** the agent writes **`latest.json`**, **`images/*.jpg`** (when screenshots exist), and **`technews.html`** (static shell; disable with `TECHNEWS_WEB_HTML=0`). Talking-point text per story is parsed from the **VIDEO PROMPT** **STORY** blocks (legacy **`##`** Markdown still supported). Optional **`TECHNEWS_PUBLIC_BASE_URL`** (no trailing slash) adds absolute `imageUrl` fields for hosting images on a CDN. Deploy the folder to any static host (S3/Cloudflare R2 website, Netlify, Vercel static, etc.) or sync from CI; the page loads `latest.json` via `fetch` (needs HTTP(S), not `file://`).

### Instakyle site (`/news`)

Set **`TECHNEWS_INSTAKYLE_NEWS_DIR`** to the **Instakyle** repo path **`public/news`** (e.g. clone sibling + absolute path). After email succeeds, each run writes **`manifest.json`** (episode list) and **`posts/YYYY-MM-DD.json`** (Chicago date slug). **Instakyle posts do not include source screenshots by default** (JPEGs still attach to the email when **`SCREENSHOT_SOURCES`** is on). To write **`posts/images/YYYY-MM-DD/*.jpg`** and **`image` / `imageUrl`** on the blog again, set **`TECHNEWS_INSTAKYLE_SCREENSHOTS=1`**. The React app serves **`/news`** (index) and **`/news/:slug`** (episode). Optional **`TECHNEWS_VIDEO_URL`** = that day’s YouTube/Instagram/etc. link (shown as “Watch the video”). Optional **`TECHNEWS_SITE_ORIGIN`** (no trailing slash, e.g. `https://instakyle.tech`) fills **`imageUrl`** in post JSON when blog screenshots are enabled. You can set **`TECHNEWS_WEB_DIR`** and **`TECHNEWS_INSTAKYLE_NEWS_DIR`** together or only one of them.

**Instakyle episode layout:** the Short (or watch link) and a **numbered source list** (headline + domain + favicon) share a split column on wide viewports. Optional **`videoStartSec`** per story is still written by **`WEB_VIDEO_START_SECS`** / merge for possible future use; it is not required for the current site UI.
