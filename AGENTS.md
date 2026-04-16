# TechNewsAgent — agent / maintainer guide

Single Node script (`tech_news_agent.ts`) pulls RSS (+ NBA.com Timberwolves embedded JSON), calls Gemini for studio output, optionally attaches Playwright JPEGs, emails via Resend.

## Editorial scope

- **Tech:** Software, AI/ML, hardware & gadgets, gaming (news + industry), developer ecosystem, security when it’s tech news. Sources are listed in `tech_news_agent.ts` (`techFeeds` / `hardwareFeeds`).
- **Repair:** Tech repair/right-to-repair/serviceability/teardown beats. Tagged as **Tech Repair** on the blog and prioritized first in the on-air rundown when fresh (`repairFeeds`).
- **Sports:** Timberwolves — Canis Hoopus RSS + `nba_wolves_news.ts` (NBA.com index). Tagged **[LOCAL]** in prompts; blog JSON uses section label **Timberwolves**.
- **Skate:** Thrasher, Jenkem, Quartersnacks, Village Psychic, The Berrics (best-effort). Tagged **[SKATE]**.
- **Close:** Linden Hills neighborhood color + **required** one spoken mention of the chosen local business name (from `LOCAL_BIZ_NAME` or `local_businesses.ts` rotation), organic not a hard sell; Gemini prompt treats this as **non-negotiable** in ON AIR before the fixed sign-off.
- **Digital assets:** **Bitcoin-only** on-air and in headlines (`passesBitcoinOnlyCurrencyRule`). No altcoins, stablecoins, NFT/DeFi/Web3 industry beats. Set `BITCOIN_ONLY_CURRENCY_RULE=0` to disable filtering.

## Freshness

Default max age (overridable per section):

| Section   | Default hours | Env override                    |
|----------|---------------|----------------------------------|
| TECH     | 18            | `MAX_STORY_AGE_HOURS_TECH`       |
| REPAIR   | 18            | `MAX_STORY_AGE_HOURS_REPAIR`     |
| HARDWARE | 18            | `MAX_STORY_AGE_HOURS_HARDWARE`   |
| SKATE    | 18            | `MAX_STORY_AGE_HOURS_SKATE`      |
| LOCAL    | 18            | `MAX_STORY_AGE_HOURS_LOCAL`      |

Items **without a parseable `pubDate` / Atom date** are **dropped** unless `ALLOW_UNDATED_FEED_ITEMS=1` (escape hatch for broken feeds).

## Email layout (precision)

Order: **Ticker** → **ON AIR** (ALL CAPS) → **SOCIAL** caption → **YOUTUBE** (one-line `TND-YYYY-MM-DD` token — paste into the Short’s **description** so **Publish Tech News to Instakyle** can verify + sync the upload) → **SOURCE LINKS** → screenshot note + attachments.

Markers in model output: `<<<ON_AIR>>>`, `<<<SOURCES>>>` (one line of comma-separated 1-based story numbers = same numbers as the **numbered list** in the prompt — **which** stories are in the segment), then `<<<SOCIAL>>>` (short Threads-style body; the script prepends the title line and one hashtag line).

**SOURCE LINKS / email JPEG order (default):** indices follow the model’s **`<<<SOURCES>>>`** line (same order as slide / VO beats). Set **`USE_ON_AIR_SOURCE_REORDER=1`** to re-sort by hostname/title hits in **`<<<ON_AIR>>>`** (legacy heuristic).

**Blog / Instakyle story rows (default):** **`TECHNEWS_BLOG_STORY_ORDER=script`** — stories follow email / `<<<SOURCES>>>` order (keeps `VIDEO PROMPT` story blocks aligned 1:1). Set **`TECHNEWS_BLOG_STORY_ORDER=newest`** for newest-first by feed date.

Post JSON includes **`seoKeywords`** (neighborhood + business + story tokens) and optional **`localSpotlight`** (**Local Spotlight** — business URL + screenshot) when `LOCAL_BIZ_WEBSITE` or the rotation entry has a **`website`** URL.

The **daily email** also includes a **Local spotlight** block (name + URL + **`99-local-spotlight.jpg`** after story grabs — use it last in the slide deck) and **injects** the business name into **ON AIR** if Gemini omitted it. Each rotation entry in **`local_businesses.ts`** should have a **`website`** (see `docs/linden-hills-43rd-upton/README.md`); **`LOCAL_BIZ_WEBSITE`** (repo var / `.env`) overrides when set. If the first capture fails, the agent retries once with **desktop** layout (`SCREENSHOT_MOBILE=0`).

If the email looks truncated or missing a column, check Gemini `maxOutputTokens` and API errors; markers must be exact.

## Screenshots (`screenshot_sources.ts`)

- Default **`SCREENSHOT_MODE=viewport`**: one **full mobile frame** per URL (~**393×852** CSS px with default `SCREENSHOT_MOBILE` — same shape as a normal phone screenshot: chrome + headline + first scroll fold). Consistent size for slides.
- **`SCREENSHOT_MODE=content`**: crop to article/main from the headline down, max height `SCREENSHOT_MAX_CONTENT_HEIGHT` (default **2400** CSS px); optional `SCREENSHOT_HEADLINE_IMAGE_ONLY=1` for tight h1+hero union.
- Disable screenshots: `SCREENSHOT_SOURCES=0`.

## Voiceover length (~90s desk)

Target **one take ~90s** (**~85–95s** window; prompt budgets **~175–215 spoken words** between fixed START/END). **3 stories in `<<<SOURCES>>>` typical, 4 maximum.** Story list in the prompt is **newest-first** so the model favors fresh headlines. Best practice: **one beat → one point → one proof** on main stories; optional skate/Wolves kept to **one sentence** when both appear. Close stays short (neighborhood + sign-off). Gemini prompt steers **away** from hype / podcast clichés — calm bench voice, not trailer energy.

## CI schedule

`.github/workflows/daily_news.yml` — cron is **UTC** (`0 10 * * *` ≈ **5:00 AM America/Chicago** during **CDT**; ≈ **4:00 AM** during **CST** — switch to `0 11 * * *` in winter if you want 5:00 AM local all year). The workflow sets **`actions: write`** on the `GITHUB_TOKEN` (in addition to `contents: read`) so **`upload-artifact` succeeds**; a `permissions` block with only `contents: read` leaves `actions` at `none` and artifact upload will fail. **Do not use `secrets` inside step `if:`** (GitHub rejects the workflow); gate steps with a small shell step that sets `GITHUB_OUTPUT` from `env: INSTAKYLE_PUSH_TOKEN: ${{ secrets.INSTAKYLE_PUSH_TOKEN }}`.

With **`INSTAKYLE_PUSH_TOKEN`** set, the workflow checks out **Instakyle-clean** (to seed **`manifest.json`** when needed), runs the agent, then always uploads a **`news-site-bundle`** artifact (retention 5 days). Episode JSON includes **`sourceWorkflowRunId`** / **`sourceWorkflowRunUrl`** so you can match **instakyle.tech/news** to the exact Actions run (and the email from that run).

**Backfill several days (e.g. April 1–7)**  
Run **Daily Tech News Agent** from **Actions → Run workflow** seven times (or once per missing day). Set optional input **`chicago_date`** to each **`YYYY-MM-DD`** in Chicago. Each run regenerates that day’s feeds/Gemini output and writes **`posts/{slug}.json`** (full agent cost per day). If a slug **already exists** on Instakyle and you mean to replace it, set **`NEWS_SITE_FORCE_REPUBLISH=true`** for that run. Locally: `TECHNEWS_CHICAGO_DATE=2026-04-01 npx tsx tech_news_agent.ts` (still need Resend + web dirs as usual).  

**One live post per Chicago day (auto push)**  
If **`public/news/posts/YYYY-MM-DD.json`** already exists on the Instakyle default branch, the **auto** push step **skips** (no second post for the same calendar day). Set repository variable **`NEWS_SITE_FORCE_REPUBLISH=true`** on a rerun to replace that day’s files.

**`NEWS_SITE_PUBLISH_MODE` (repo variable)**  
- **`auto`** (default): after email, push Instakyle `public/news` when not blocked by the rule above.  
- **`manual`**: after email, **no push** — only the artifact. Copy **`manifest.json`** from the live site into staging first so the merged manifest keeps older episodes. Run workflow **Publish Tech News to Instakyle** when you’re ready (e.g. after filming); it needs **no inputs** (newest episode from **`manifest.json`** + YouTube auto-discovery).

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
| `YOUTUBE_CHANNEL_ID` | Optional but recommended | Repo variable (e.g. `UC...`) to constrain YouTube search to your channel during auto-discovery. |

**YouTube embed + verified link**

- Post JSON from `web_publish` includes **`episodeVerificationToken`** (`TND-{Chicago slug}`) and, after sync, **`youtubeVideoId`** + **`videoUrl`**. Re-running the daily agent the same day **preserves** synced `youtubeVideoId` / `videoUrl` when `TECHNEWS_VIDEO_URL` is unset.
- **`web/technews.html`** shows a responsive embed when `youtubeVideoId` or a parseable `videoUrl` is present.
- Workflow **Publish Tech News to Instakyle** handles **YouTube sync only** (post JSON is already published by the daily flow). **Actions → Run workflow** after filming (**no form fields**): it uses the **newest** `manifest.json` slug, auto-searches YouTube by the `TND-YYYY-MM-DD` token (optionally constrained by **`YOUTUBE_CHANNEL_ID`**), verifies the token in the video description, then pushes. If not found after retries, the workflow fails so you can rerun once indexing catches up. For a **specific** slug or explicit URL, use the local `npm run youtube:sync` command below.

Local (explicit URL): `YOUTUBE_API_KEY=... npm run youtube:sync -- --youtube-url "…" --news-dir /path/to/public/news`
Local (auto-discover by token): `YOUTUBE_API_KEY=... npm run youtube:sync -- --news-dir /path/to/public/news --allow-missing`

## Secrets / env

Resend, Gemini, `RESEND_TO`, optional `FEED_ITEM_LIMIT`, `SCREENSHOT_*`, `GEMINI_MODEL`, optional `USE_ON_AIR_SOURCE_REORDER`, `TECHNEWS_BLOG_STORY_ORDER`, `LOCAL_BIZ_WEBSITE`, etc. Never commit `.env`.

### Culture slot override (Skate vs Timberwolves)

By default, the show prefers a **SKATE** beat when a fresh skate story exists, with **Timberwolves** as fallback.

**Hard rule:** a single episode may include **at most one** Timberwolves story in `<<<SOURCES>>>` (prevents double-Wolves posts on the blog).

To force one lane for a run (and prevent “swap-back” by the model), set:

- `CULTURE_SECTION_MODE=SKATE` — fetch **skate** feeds only (no Wolves candidates).
- `CULTURE_SECTION_MODE=LOCAL` — fetch **Wolves** feeds only (no skate candidates).

## TechNews web bundle (optional)

Set **`TECHNEWS_WEB_DIR`** to an absolute or relative path; after a **successful Resend send** the agent writes **`latest.json`**, **`images/*.jpg`** (when screenshots exist), and **`technews.html`** (static shell; disable with `TECHNEWS_WEB_HTML=0`). Talking-point text per story is parsed from the **VIDEO PROMPT** **STORY** blocks (legacy **`##`** Markdown still supported). Optional **`TECHNEWS_PUBLIC_BASE_URL`** (no trailing slash) adds absolute `imageUrl` fields for hosting images on a CDN. Deploy the folder to any static host (S3/Cloudflare R2 website, Netlify, Vercel static, etc.) or sync from CI; the page loads `latest.json` via `fetch` (needs HTTP(S), not `file://`).

### Instakyle site (`/news`)

Set **`TECHNEWS_INSTAKYLE_NEWS_DIR`** to the **Instakyle** repo path **`public/news`** (e.g. clone sibling + absolute path). After email succeeds, each run writes **`manifest.json`** (episode list) and **`posts/YYYY-MM-DD.json`** (Chicago date slug). **Instakyle posts do not include source screenshots by default** (JPEGs still attach to the email when **`SCREENSHOT_SOURCES`** is on). To write **`posts/images/YYYY-MM-DD/*.jpg`** and **`image` / `imageUrl`** on the blog again, set **`TECHNEWS_INSTAKYLE_SCREENSHOTS=1`**. The React app serves **`/news`** (index) and **`/news/:slug`** (episode). Optional **`TECHNEWS_VIDEO_URL`** = that day’s YouTube/Instagram/etc. link (shown as “Watch the video”). Optional **`TECHNEWS_SITE_ORIGIN`** (no trailing slash, e.g. `https://instakyle.tech`) fills **`imageUrl`** in post JSON when blog screenshots are enabled. You can set **`TECHNEWS_WEB_DIR`** and **`TECHNEWS_INSTAKYLE_NEWS_DIR`** together or only one of them.

**Instakyle episode layout:** the Short (or watch link) and a **numbered source list** (headline + domain + favicon) share a split column on wide viewports. Optional **`videoStartSec`** per story is still written by **`WEB_VIDEO_START_SECS`** / merge for possible future use; it is not required for the current site UI.
