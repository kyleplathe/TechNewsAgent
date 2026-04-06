# TechNewsAgent — agent / maintainer guide

Single Node script (`tech_news_agent.ts`) pulls RSS (+ NBA.com Timberwolves embedded JSON), calls Gemini for studio output, optionally attaches Playwright JPEGs, emails via Resend.

## Editorial scope

- **Tech:** Software, AI/ML, hardware & gadgets, gaming (news + industry), developer ecosystem, security when it’s tech news, repair/maker (e.g. Hackaday). Sources are listed in `tech_news_agent.ts` (`techFeeds` / `hardwareFeeds`).
- **Sports:** Timberwolves — Canis Hoopus RSS + `nba_wolves_news.ts` (NBA.com index). Tagged **[LOCAL]**.
- **Skate:** Thrasher, Jenkem, Quartersnacks, Village Psychic, The Berrics (best-effort). Tagged **[SKATE]**.
- **Close:** Linden Hills neighborhood color + optional local business mention (organic, not a hard sell). See `local_businesses.ts` / `LOCAL_BIZ_*` env.
- **Digital assets:** **Bitcoin-only** on-air and in headlines (`passesBitcoinOnlyCurrencyRule`). No altcoins, stablecoins, NFT/DeFi/Web3 industry beats. Set `BITCOIN_ONLY_CURRENCY_RULE=0` to disable filtering.

## Freshness

Default max age (overridable per section):

| Section   | Default hours | Env override                    |
|----------|---------------|----------------------------------|
| TECH     | 12            | `MAX_STORY_AGE_HOURS_TECH`       |
| HARDWARE | 24            | `MAX_STORY_AGE_HOURS_HARDWARE`   |
| SKATE    | 24            | `MAX_STORY_AGE_HOURS_SKATE`      |
| LOCAL    | 24            | `MAX_STORY_AGE_HOURS_LOCAL`      |

Items **without a parseable `pubDate` / Atom date** are **dropped** unless `ALLOW_UNDATED_FEED_ITEMS=1` (escape hatch for broken feeds).

## Email layout (precision)

Order: **Ticker** → **VIDEO PROMPT** (Markdown) → **ON AIR** (ALL CAPS) → **SOCIAL** caption → **SOURCE LINKS** → screenshot note + attachments.

Markers in model output: `<<<VIDEO_PROMPT>>>`, `<<<ON_AIR>>>`, `<<<SOURCES>>>` (one line of comma-separated 1-based story numbers = same numbers as the **numbered list** in the prompt = **slide / JPEG order**), then `<<<SOCIAL>>>` (short Threads-style body; the script prepends the title line and hashtags).

If the email looks truncated or missing a column, check Gemini `maxOutputTokens` and API errors; markers must be exact.

## Screenshots (`screenshot_sources.ts`)

- Default **`SCREENSHOT_MODE=viewport`**: one **full mobile frame** per URL (~**393×852** CSS px with default `SCREENSHOT_MOBILE` — same shape as a normal phone screenshot: chrome + headline + first scroll fold). Consistent size for slides.
- **`SCREENSHOT_MODE=content`**: crop to article/main from the headline down, max height `SCREENSHOT_MAX_CONTENT_HEIGHT` (default **2400** CSS px); optional `SCREENSHOT_HEADLINE_IMAGE_ONLY=1` for tight h1+hero union.
- Disable screenshots: `SCREENSHOT_SOURCES=0`.

## Voiceover length (~90s desk)

Target **one take ~85–100s** (~**90s**). Best practice for a **daily reporter**: **one beat → one point → one proof** (headline + why it matters + a single concrete detail — number, name, mechanism — when the story gives it). Skip beats that need a paragraph; skip essay transitions. Close stays short (neighborhood + sign-off).

## CI schedule

`.github/workflows/daily_news.yml` — cron is **UTC** (`0 10 * * *` ≈ **5:00 AM America/Chicago** during **CDT**; ≈ **4:00 AM** during **CST** — switch to `0 11 * * *` in winter if you want 5:00 AM local all year).

With **`INSTAKYLE_PUSH_TOKEN`** set, the workflow checks out **Instakyle-clean** (to seed **`manifest.json`** when needed), runs the agent, then always uploads a **`news-site-bundle`** artifact (retention 5 days). Episode JSON includes **`sourceWorkflowRunId`** / **`sourceWorkflowRunUrl`** so you can match **instakyle.tech/news** to the exact Actions run (and the email from that run).

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
| `TECHNEWS_SITE_ORIGIN` | Optional | e.g. `https://instakyle.tech` — absolute `imageUrl` in post JSON. |
| `TECHNEWS_VIDEO_URL` | Optional secret | That day’s video link on the post page. |

## Secrets / env

Resend, Gemini, `RESEND_TO`, optional `FEED_ITEM_LIMIT`, `SCREENSHOT_*`, `GEMINI_MODEL`, etc. Never commit `.env`.

## TechNews web bundle (optional)

Set **`TECHNEWS_WEB_DIR`** to an absolute or relative path; after a **successful Resend send** the agent writes **`latest.json`**, **`images/*.jpg`** (when screenshots exist), and **`technews.html`** (static shell; disable with `TECHNEWS_WEB_HTML=0`). Talking-point text per story is parsed from the **VIDEO PROMPT** `##` sections (aligned with `<<<SOURCES>>>` order). Optional **`TECHNEWS_PUBLIC_BASE_URL`** (no trailing slash) adds absolute `imageUrl` fields for hosting images on a CDN. Deploy the folder to any static host (S3/Cloudflare R2 website, Netlify, Vercel static, etc.) or sync from CI; the page loads `latest.json` via `fetch` (needs HTTP(S), not `file://`).

### Instakyle site (`/news`)

Set **`TECHNEWS_INSTAKYLE_NEWS_DIR`** to the **Instakyle** repo path **`public/news`** (e.g. clone sibling + absolute path). After email succeeds, each run writes **`manifest.json`** (episode list), **`posts/YYYY-MM-DD.json`** (Chicago date slug), and **`posts/images/YYYY-MM-DD/*.jpg`**. The React app serves **`/news`** (index) and **`/news/:slug`** (episode). Optional **`TECHNEWS_VIDEO_URL`** = that day’s YouTube/Instagram/etc. link (shown as “Watch the video”). Optional **`TECHNEWS_SITE_ORIGIN`** (no trailing slash, e.g. `https://instakyle.tech`) fills **`imageUrl`** in post JSON as `{origin}/news/posts/images/...`. You can set **`TECHNEWS_WEB_DIR`** and **`TECHNEWS_INSTAKYLE_NEWS_DIR`** together or only one of them.
