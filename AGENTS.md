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

- Default: **mobile** viewport (~393×852 CSS px), **content** mode — **article/main crop** from the headline downward (gap trim above `h1` when helpful), height capped by `SCREENSHOT_MAX_CONTENT_HEIGHT` (default **2200** CSS px). Good for **title + hero/lede** on slides without the experimental tight union.
- Optional tight **h1 + hero image** union: `SCREENSHOT_HEADLINE_IMAGE_ONLY=1`. Disable screenshots: `SCREENSHOT_SOURCES=0`.

## CI schedule

`.github/workflows/daily_news.yml` — cron is **UTC**; adjust for local morning.

## Secrets / env

Resend, Gemini, `RESEND_TO`, optional `FEED_ITEM_LIMIT`, `SCREENSHOT_*`, `GEMINI_MODEL`, etc. Never commit `.env`.
