# CLAUDE.md

Guidance for AI agents working in this repository.

## Project

A personal PC games catalogue app. It pulls game data from Steam's storefront API and presents it in a macOS App Store-style browsing UI: sidebar, toolbar, a featured hero, and card grids (New Releases, Top Sellers, Specials, Coming Soon, by genre and tag) — no carousels — plus detail pages and search. Signed-in users can add games to a personal library and track status and price.

Steam is the source of catalogue data. Our database stores users, library entries, and a cache of Steam responses — plus one thing the movies equivalent of this app does not need: a local index of the Steam app catalogue, because Steam has no browse-and-filter endpoint (see "Steam integration").

## Stack

- Next.js (App Router) + TypeScript, `output: 'standalone'`, deployed on Vercel and as a single Docker image
- Tailwind CSS for styling
- Neon Postgres, accessed through Drizzle
- Drizzle ORM + Drizzle Kit for schema and migrations
- Auth.js (NextAuth) for sessions

Do not introduce a new library, ORM, state manager, or UI kit without asking first. If a task seems to need one, say what it would solve and let the human decide.

Approved beyond the core stack above: Vitest, Zod, `@auth/drizzle-adapter`, Playwright, hls.js, isomorphic-dompurify.

## Agent rules

### Working agreement

Every meaningful increment ends as a pull request: branch → commit → push → `gh pr create`. Nothing is pushed straight to `main`.

### Prove before asserting

Never state that something works, exists, or is fixed unless you have evidence in this session. Evidence means: a command you ran and its output, a file you read, or a test that passed. Not memory, not inference, not "this should work".

This rule bites harder here than on a normal API project, because most of what we consume is undocumented. Concretely:

- Before claiming a Steam endpoint exists or a response has a given shape, call it and show the actual JSON. Do not describe `appdetails` fields from memory — the payload varies by app type, by country code, and by whether the app is free, unreleased, or delisted. Fields that exist for one appid are absent for another.
- Never hardcode a rate limit, image CDN hostname, or field path you have not observed in a live response in this session. If you need one and cannot verify it, leave a `TODO` naming what must be checked and say so in your reply.
- Before claiming a build passes, run the build and paste the result.
- Before claiming a query works, run it against a real database and show the rows.
- Before editing a file, read it. Do not patch from assumption about its contents.
- When you cannot verify something, say so explicitly: "I have not verified this" or "this is untested". An honest gap is more useful than a confident guess.

Prohibited without evidence in the same message: "this should work", "I've fixed it", "the endpoint returns", "it now handles", "verified", "tested and working".

### No unnecessary comments

Write code that does not need explaining. Comments earn their place only when they record something the code cannot say:

- Why a non-obvious choice was made, especially a workaround for Steam's behaviour ("appdetails ignores multiple appids for full detail; batching only works for price_overview" is worth a comment).
- A link to the source that justifies a magic value.
- A genuine warning about a sharp edge.

Do not write comments that restate the line below them, label sections of a function, narrate what you are about to do, or apologise for the code. Do not leave commented-out code. Do not add JSDoc that repeats the TypeScript signature.

Delete any comment you would not defend in review.

## Commands

```
pnpm dev              # local dev server
pnpm build            # production build
pnpm lint
pnpm typecheck
pnpm db:generate      # generate migration from schema changes
pnpm db:migrate       # apply migrations
pnpm db:studio        # inspect data
pnpm sync:catalogue   # refresh the local Steam app index (see below)
docker build -t games-app .
docker run --env-file .env.local -p 3001:3000 games-app
```

Run the real command before reporting on it. Do not report the outcome of a command you did not run.

## Steam integration

### What Steam actually gives us

Two different hosts, with different rules. Confirm current behaviour before relying on any of this:

- **`store.steampowered.com/api/...`** — the storefront API. No API key. Completely undocumented by Valve; it exists to serve Steam's own client, and Valve has published nothing about third-party use, limits, or stability. Treat every endpoint here as something that can change or disappear without notice.
- **`store.steampowered.com/appreviews/<appid>?json=1`** — review data, and unusually for our purposes it *is* documented in the Steamworks docs, with cursor-based pagination.
- **`api.steampowered.com/...`** — the official Steamworks Web API. Some methods need a key, some do not. Many methods have undocumented per-method rate limits; when limited it typically returns HTTP 429, or an `x-eresult` of 25 or 84.

### Review data policy

`appreviews/<appid>` is always called with `num_per_page=0&purchase_type=all`. `purchase_type` must be pinned — it defaults to `steam` and the totals move with it (a ~6% swing observed between `purchase_type=steam` and `purchase_type=all`), so pinning `all` keeps stored counts comparable over time instead of drifting when Valve changes the default. We store only the aggregate `query_summary` (`review_score`, `review_score_desc`, `total_positive`, `total_negative`, `total_reviews`). Review bodies and author identifiers (`steamid`, `personaname`, `avatar`, `profile_url`, `playtime_forever`) are never fetched, stored, or rendered — `num_per_page=0` means the bodies never arrive in the first place, not merely that we discard them. They are personal data, and Steam gives us no signal when a user edits or deletes a review, so keeping them would create a retention and erasure obligation we cannot honour.

### The constraint that shapes the architecture

Steam has no endpoint equivalent to TMDB's `/trending` or `/discover`. There is no "give me action games released in 2026, sorted by rating, page 3". Detail lookups are per-appid, and the storefront API has been rate limited to roughly 200 requests per 5 minutes since 2015, with multiple appids no longer working for full detail in a single request.

This means the app cannot be a thin proxy. It must maintain its own index:

1. `pnpm sync:catalogue` pulls the full app list from `IStoreService/GetAppList` (`ISteamApps/GetAppList` is gone — v1 and v2 both 404) and upserts appids and names into a `steam_app` table. Its request parameters and response shape have not been verified — that call needs `STEAM_API_KEY`, which does not exist yet. Verify both against a live response before writing the sync — do not assume.
2. A background hydration job walks that table and fills in detail from `appdetails`, one appid at a time, respecting a conservative self-imposed rate limit with backoff on 429.
3. All browse, filter, and search queries in the app hit our own tables. They never fan out to Steam.
4. `appdetails` is called live only for a game the user has explicitly opened and that has no fresh cache row.

Never write a code path that calls Steam once per item in a list. If you find yourself mapping over results with a fetch inside, stop and reconsider the data model.

### Caching and freshness

- Every Steam response we store carries `fetched_at`. Reads go through a helper that returns cached data when it is within TTL and refreshes otherwise.
- TTLs differ by volatility: price and discount are short-lived, descriptions and screenshots are long-lived, release dates for unreleased games sit in between. Put the TTLs in one config object, not scattered through call sites.
- On a Steam error or timeout, serve stale cache and log it. A stale price is better than a broken page.
- Rate limiting is enforced in one place — a single queue or limiter in the Steam client module. Nothing calls `fetch` against Steam directly.

### Requests

- Always send `cc` and `l`. We use `cc=cz`, but Steam prices Czechia in EUR, not CZK — verified live across `cc=cz` (EUR), `cc=us` (USD), `cc=gb` (GBP), and `cc=pl` (PLN). Never assume the currency from `cc`; always read it from `price_overview.currency` in the response and store it alongside the amount. Do not convert currencies ourselves.
- Read prices from the minor-unit integer field, not the preformatted string, and format for display with `Intl.NumberFormat`.
- All Steam calls happen server-side. The browser never talks to `store.steampowered.com`.
- Only `filters=price_overview` accepts multiple appids in one `appdetails` request. `filters=basic` and a bare multi-appid request (no `filters`) both return a `null` body — verified live. Everything except a price refresh is strictly one appid per request.
- Image URLs come from the Steam CDN. Confirm the current hostname and path pattern from a live response before adding it to `next.config.js` remote patterns — the hostnames have changed more than once. Capsule paths are not derivable from the appid — they contain a per-app hash segment (e.g. `/steam/apps/292030/e4364da910766631c924b6a639ea84681791160a/capsule_231x87_alt_assets_4.jpg`). Always store and read the URL from the payload; never construct one.

### Known limitations to design around, not paper over

- Steam-only. No GOG, Epic, or itch data. Do not imply otherwise in UI copy.
- `appdetails` returns store marketing copy, not editorial metadata. Descriptions contain HTML and promotional formatting — sanitise before rendering, and never use `dangerouslySetInnerHTML` on it unsanitised.
- Delisted and region-locked apps return `success: false` or a null payload. Handle that as a normal case, not an error.
- The app list includes DLC, soundtracks, videos, demos, and tools. Filter on `type` and keep non-games out of browse rows.

## Data layer

- Schema lives in `db/schema.ts`. Change it there and generate a migration; never hand-write SQL that drifts from the schema file.
- The database client is created once in `db/client.ts`. Driver selection happens there based on runtime — the serverless driver on Vercel, a standard connection pool in the container. No other module constructs a client.
- Migrations run as an explicit step, not on container start. Two containers starting at once must not race.
- `steam_appid` is the natural key for a game and is unique. Library rows reference it.
- A library entry stores status as an enum: `backlog`, `playing`, `finished`, `abandoned`, `wishlist`. Status transitions are recorded with a timestamp so the UI can show "finished in March".
- Wishlist entries store the price seen when added, so the UI can show the delta against the current price.
- User input is validated at the boundary with a schema, before it reaches a query. Trust nothing from the client.

## UI conventions

- Server components by default. `'use client'` only where interactivity genuinely requires it — the theme toggle, library status control, search input, video player.
- Card grids (not carousels) use Steam's landscape capsule art and lazily load it below the fold.
- The library status control updates optimistically and rolls back on failure.
- Every interactive element is reachable by keyboard and has an accessible name. Capsule art has alt text with the game title.
- Loading states are skeletons matching the final layout, not spinners.
- Never render a price without also rendering whether it is a discount and what the base price was.
- Steam's own artwork is used unmodified and links back to the store page for that game.

## Docker

- Multi-stage build: dependencies, build, runtime. The runtime stage copies only the standalone output and static assets.
- The container runs as a non-root user.
- No Vercel-specific APIs in application code. Anything that only works on Vercel breaks the container path — if you need such an API, raise it rather than adding it.
- A healthcheck endpoint exists and does not touch Steam. It may check the database.
- The catalogue sync and hydration jobs must be runnable as one-off commands in the container, not only as Vercel cron.

## Environment

```
DATABASE_URL            # Neon pooled connection string
DATABASE_URL_UNPOOLED   # direct connection, migrations only
STEAM_API_KEY           # required, not optional — IStoreService/GetAppList returns 403 without it
STEAM_COUNTRY_CODE      # defaults to cz
AUTH_SECRET
AUTH_GITHUB_ID          # GitHub OAuth app, the only sign-in provider
AUTH_GITHUB_SECRET
AUTH_URL                # required in the container path
```

Local values live in `.env.local`, which is gitignored. Never commit real credentials, never print them in logs or terminal output, and never paste them into a file you create.

## Definition of done

A change is done when: the code is written, `pnpm build`, `pnpm lint` and `pnpm typecheck` pass with output you can show, the affected path has been exercised (test or manual run), any Steam response shape you relied on was observed live in this session, and you have stated plainly which parts you verified and which you did not.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
