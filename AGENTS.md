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

`.github/workflows/daily_news.yml` — cron is **UTC**; adjust for local morning.

## Secrets / env

Resend, Gemini, `RESEND_TO`, optional `FEED_ITEM_LIMIT`, `SCREENSHOT_*`, `GEMINI_MODEL`, etc. Never commit `.env`.
