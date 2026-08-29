# games-db — Design

Date: 2026-08-29
Status: approved for implementation planning

A personal PC games catalogue. Steam supplies the data; we supply the index, the
cache, and a macOS-styled browsing UI with a personal library.

---

## 1. Verified Steam behaviour

Everything in this section was observed live on 2026-08-29 from this machine.
Anything not listed here is unverified and must be checked before it is relied on.

### 1.1 The catalogue endpoint needs a key

```
GET api.steampowered.com/ISteamApps/GetAppList/v2/   → 404
    "Method 'GetAppList' not found in interface 'ISteamApps'"
GET api.steampowered.com/ISteamApps/GetAppList/v1/   → 404 (same)
GET api.steampowered.com/IStoreService/GetAppList/v1/ → 403
    "Access is denied... Please verify your key= parameter."
```

`ISteamWebAPIUtil/GetSupportedAPIList/v1` (keyless) reports 27 interfaces;
`ISteamApps` exposes only `GetSDRConfig`, `GetServersAtAddress`, `UpToDateCheck`.

**Consequence:** `STEAM_API_KEY` is required, not optional. CLAUDE.md's "only if a
Web API method we use requires one" is now resolved: it does. The catalogue index
cannot be built until the key exists, and the key needs a domain — which is why
the deploy happens before the catalogue work.

`IStoreService/GetAppList` request parameters and response shape are **unverified**
— they cannot be checked without a key. Verify before writing the sync.

### 1.2 Currency: `cc=cz` returns EUR

```
cc=cz → {"currency":"EUR","initial":975,"final":975,"final_formatted":"9,75€"}
cc=us → USD 999      cc=gb → GBP 850      cc=pl → PLN 4599     cc=de → EUR 975
```

`cc` is honoured (four country codes, four different currencies), so this is not a
fallback: Steam prices Czechia in EUR. CLAUDE.md's "we use `cc=cz` so the app shows
CZK" is stale and must be corrected.

**Decision:** keep `cc=cz`, display EUR. Never assume a currency — always read
`price_overview.currency` and store it alongside the amount.

### 1.3 Batching: only `filters=price_overview`

```
appids=620,570                        → null   (4-byte body)
appids=292030,1174180,...&filters=basic → null
appids=620,730,440&filters=price_overview → all three keys returned
```

Free games return `"data": []` — an empty **array**, not an object. Parsers must
tolerate that.

**Consequence:** price refresh may batch; everything else is strictly one appid per
request.

### 1.4 Prices

```
620     → initial 975,  final 975,  discount_percent 0,  initial_formatted ""
1174180 → initial 5999, final 1499, discount_percent 75, initial_formatted "59,99€"
```

`initial_formatted` is empty unless discounted. Read the minor-unit integers
(`initial`, `final`) and format with `Intl.NumberFormat`; never parse the
formatted strings. Free games (`is_free: true`, e.g. 570, 440, 730) have no
`price_overview` at all.

### 1.5 Missing and non-game apps are normal

```
999999999 → {"999999999":{"success":false}}          (no data key)
323180    → type "music"  (Portal 2 Soundtrack), is_free true
271590    → type "game"   but no price_overview      (GTA V Legacy)
```

`type` must be filtered to `game` for browse rows. `success:false` is an expected
outcome, not an error.

### 1.6 Media

Asset hosts observed: `shared.akamai.steamstatic.com`, `video.akamai.steamstatic.com`,
`store.akamai.steamstatic.com`.

Capsule paths are **not derivable from the appid**:

```
620    → /steam/apps/620/capsule_231x87.jpg
292030 → /steam/apps/292030/e4364da910766631c924b6a639ea84681791160a/capsule_231x87_alt_assets_4.jpg
```

Always store the URL from the payload. Never construct one.

`movies[]` contains **no `mp4` or `webm`** (checked on 620 and 1174180) — only:

```
thumbnail, dash_av1 (.mpd), dash_h264 (.mpd), hls_h264 (.m3u8), highlight, id, name
```

There is no embeddable Steam player page, so an `<iframe>` is not possible. The HLS
master playlist serves `access-control-allow-origin: *`, `content-type:
application/vnd.apple.mpegurl`, and a valid ladder (940×528 / 854×480 / 640×360), so
in-browser playback works with a library.

### 1.7 Reviews

`store.steampowered.com/appreviews/<appid>?json=1&num_per_page=0&purchase_type=all`
returns a `query_summary` carrying `review_score`, `review_score_desc` ("Very
Positive"), `total_positive`, `total_negative`, `total_reviews`, and — verified —
an empty `reviews` array.

**`purchase_type` must be pinned.** It defaults to `steam`, and the totals move
with it:

```
default              total=310349  (+285634/-24715)
purchase_type=steam  total=310349  (identical — confirms the default)
purchase_type=all    total=329951  (+303463/-26488)
language=english     total=310349  (no effect on the summary)
day_range=365        total=310349  (no effect on the summary)
```

A ~6% swing. We send `purchase_type=all` explicitly so stored counts stay
comparable over time rather than drifting when Valve changes a default.

The endpoint will also return review bodies — ordered by `weighted_vote_score`
descending when queried with `filter=all&day_range=365` (observed 0.980, 0.949,
0.944) — with an `author` block containing `steamid`, `personaname`, `avatar`,
`profile_url` and `playtime_forever`.

**Decision: we store none of that.** Only the aggregate `query_summary` is
persisted. Review bodies and author identifiers are personal data; keeping them in
our database would create a retention and erasure obligation we cannot honour,
because Steam gives us no signal when a user edits or deletes a review. Their being
publicly visible on Steam does not make them ours to hold. `num_per_page=0` means
the bodies are never fetched in the first place, not merely discarded after arrival.

### 1.8 Not available from Steam

- **Community tags** ("Open World", "Story Rich") are not in `appdetails`. Only
  `genres` and `categories` are. Do not display community tags until a verified
  source exists.
- **Price history.** No endpoint provides it. We accumulate our own from
  `price_history` rows as the hydration job runs; the chart starts empty.

### 1.9 Still unverified

- The real storefront rate-limit ceiling. The widely repeated "200 requests per 5
  minutes" is **not** something this session measured. The limiter ships with a
  conservative configurable default and a `TODO` naming this gap. Do not state the
  ceiling as fact anywhere in the code or docs.
- `IStoreService/GetAppList` request/response shape (needs the key).
- Whether `pg_trgm` is enabled by default on Neon (needed for fuzzy search).

---

## 2. Decisions taken

| Question | Decision |
|---|---|
| Sign-in | GitHub OAuth via Auth.js v5 + `@auth/drizzle-adapter`, database sessions |
| Database | Neon, provisioned through the Vercel storage integration |
| Domain | Vercel-issued subdomain; custom domain can be added later without rework |
| First deploy | Thin skeleton, no Steam data — deploy early to unblock the API key |
| Country code | `cc=cz`, display EUR, currency always read from the response |
| UI direction | macOS app: sidebar + toolbar chrome, App Store-style content pane |
| Theme | Light **and** dark (`my_movies` is dark-only) |
| Video | `hls.js`, lazy-loaded on the detail page only; Safari uses native HLS |
| Reviews | Aggregate score only. No review text, no author data, ever stored or displayed |
| Sanitiser | `isomorphic-dompurify` on Steam's description HTML, applied at write time before caching |
| Approved extra deps | Vitest, Zod, `@auth/drizzle-adapter`, Playwright, hls.js, isomorphic-dompurify |

### Working agreement

Every meaningful increment ends as a pull request: branch → commit → push →
`gh pr create`. Nothing is pushed straight to `main`.

---

## 3. Architecture

### 3.1 Module boundaries

```
db/schema.ts        table definitions — the single source of truth
db/client.ts        the only module that constructs a database client
lib/steam/client.ts the only module that calls fetch() against Steam
lib/steam/schemas.ts Zod parsers for every Steam payload we consume
lib/steam/ttl.ts    all freshness windows, one object
lib/steam/media.ts  URL extraction from payloads (never construction)
server/catalogue/   sync + hydration job logic, callable from CLI or cron
server/library/     library mutations, validated at the boundary
app/                routes and server components
components/         presentational units
```

`db/client.ts` selects the Neon serverless driver when `process.env.VERCEL` is set
and a `node-postgres` Pool otherwise, so the container path never depends on a
Vercel-only API.

### 3.2 Data model

Auth.js adapter tables: `users`, `accounts`, `sessions`, `verification_tokens`.

**Catalogue index**

- `steam_app` — `appid` PK, `name`, `app_type`, `last_seen_in_list_at`,
  `hydration_state` (`pending` | `ok` | `failed` | `unavailable`), `failure_count`,
  `next_attempt_at`. The hydration worker's work queue.

**Hydrated detail**

- `game` — `appid` PK → `steam_app`, `name`, `type`, `is_free`, `short_description`,
  `about_html` and `detailed_html` (both sanitised before insert), `header_image`,
  `capsule_image`, `background_raw`, `release_date_text`, `release_coming_soon`,
  `release_date` (nullable, parsed), `developers[]`, `publishers[]`, `platforms`,
  `metacritic_score`, `metacritic_url`, `recommendations_total`,
  `achievements_total`, `supported_languages_raw`, `content_descriptor_ids[]`,
  `content_descriptor_notes`, `dlc_appids[]`, `pc_requirements`,
  `mac_requirements`, `linux_requirements`, `fetched_at`
- `game_media` — `appid`, `kind` (`screenshot` | `movie`), `position`,
  `steam_media_id`, `thumbnail_url`, `full_url`, `hls_url`, `dash_h264_url`,
  `dash_av1_url`, `name`, `highlight`
- `genre` / `game_genre`, `category` / `game_category` — normalised so browse
  filtering is an indexed join, never a JSON scan

**Prices**

- `price` — (`appid`, `cc`) PK, `currency`, `initial_minor`, `final_minor`,
  `discount_percent`, `fetched_at`. Current price only.
- `price_history` — append-only, one row per observed change, feeding the chart and
  the wishlist delta.

**Reviews**

- `review_summary` — `appid` PK, `review_score`, `review_score_desc`,
  `total_positive`, `total_negative`, `total_reviews`, `fetched_at`

There is deliberately no table for individual reviews. See §1.7: we hold aggregates
only, and never fetch review bodies or author identifiers.

**Library**

- `library_entry` — `user_id`, `appid`, `status` (`backlog` | `playing` |
  `finished` | `abandoned` | `wishlist`), `added_at`, `updated_at`,
  `price_seen_minor`, `price_seen_currency`. Unique on (`user_id`, `appid`).
- `library_status_event` — `entry_id`, `status`, `at`. Gives "finished in March".

Search uses a Postgres expression index on `game.name`; trigram fuzzy matching is
added only if `pg_trgm` proves available on Neon.

### 3.3 The Steam client

One module, one limiter. A token bucket with a conservative configurable rate,
`Retry-After`-aware exponential backoff on 429, a request timeout, and a single
place where `cc` and `l` are attached. Every response passes through a Zod parser
before it reaches the rest of the app, so a shape change surfaces as a parse error
naming the field rather than an `undefined` three layers away.

Freshness windows live in `lib/steam/ttl.ts` as one object: prices short, review
summaries medium, descriptions and media long, unreleased-game release dates in
between. Reads go through a helper that serves cached data inside TTL and refreshes
outside it. On a Steam error or timeout the helper serves stale cache and logs —
never an error page.

### 3.4 Jobs

- `pnpm sync:catalogue` — pulls the full app list, upserts `steam_app`. Needs the key.
- `pnpm hydrate` — walks `steam_app` by `next_attempt_at`, calls `appdetails` one
  appid at a time, writes `game`, `game_media`, genres, categories, prices; marks
  `unavailable` on `success:false`; backs off with `failure_count`.
- `pnpm refresh:prices` — batches appids through `filters=price_overview`, the one
  endpoint that permits it, and appends `price_history` rows on change.

All three are plain Node entry points runnable inside the container, with Vercel
cron as one caller rather than the only one.

### 3.5 UI

**Shell.** Fixed sidebar source list (Library: All Games, Playing, Backlog,
Finished, Abandoned, Wishlist · Store: Discover, Specials, Coming Soon, New
Releases · Genres, populated from the `genre` table) plus a toolbar carrying the
view switcher and search. Server components by default; `'use client'` only for the
theme toggle, search input, library status control, and video player.

**Look.** System font stack (`-apple-system, BlinkMacSystemFont, "SF Pro Text"`),
hairline separators at low alpha, translucent chrome, 5–8px radii, macOS accent blue
(`#0a74f0` light / `#0a84ff` dark), high information density. Tokens are CSS custom
properties on `:root`, overridden under both `prefers-color-scheme: dark` and an
explicit `[data-theme]` attribute so the toggle wins in either direction.

**Discover.** Featured hero card plus card grids using Steam's landscape capsule
art — deliberately not portrait posters, and no horizontal carousels.

**Detail.** Hero from `background_raw`; left column carries the hls.js trailer
player, screenshot gallery, and the sanitised About; right rail carries the price
card (discount, struck-through original, final), the review score as a bar and
label ("Very Positive · 303,463 of 329,951"), Metacritic, recommendations,
achievements, developer, publisher, platforms. No review text or reviewer
identities appear anywhere in the UI. Plus, all in scope:
system requirements, DLC and editions, the full language table, content warnings,
and the price-history chart.

**Library.** Denser table view with sortable columns and the optimistic status
control that rolls back on failure.

Prices are never rendered without their discount context. Capsule art carries the
game title as alt text and links to the Steam store page.

---

## 4. Milestones

**M1 — Deployable skeleton (no Steam data).** Next.js + TypeScript + Tailwind, the
full schema and its first migration applied to real Neon, GitHub sign-in, the macOS
app shell with light/dark, `/api/health` that touches the database but never Steam,
multi-stage Dockerfile running as non-root, CI running lint/typecheck/build/test.
Deploy to Vercel. **You then register the Steam key against the deployed domain.**

**M2 — Catalogue sync.** Verify `IStoreService/GetAppList` against the real key,
then build `sync:catalogue`.

**M3 — Steam client and hydration.** Limiter, Zod parsers, TTL helper, `hydrate`,
`refresh:prices`, all against captured fixtures plus live spot checks.

**M4 — Browse.** Discover, Specials, Coming Soon, New Releases, genre pages, search.

**M5 — Detail page.** Including video, gallery, the aggregate review score, and the
five extra sections.

**M6 — Library and wishlist.** Status control, transition history, price deltas.

Each milestone lands as its own pull request, or several.

---

## 5. Required CLAUDE.md amendments

To be applied in M1 so the file stops contradicting the app:

1. "Netflix-style browsing UI: hero banner, horizontally scrolling rows" → macOS
   App Store-style: sidebar, toolbar, featured hero, card grids, no carousels.
2. "we use `cc=cz` so the app shows CZK" → `cc=cz` returns EUR; read the currency
   from the response.
3. `STEAM_API_KEY` "only if... required" → required, with the 403 evidence.
4. Add the approved dependency list.
5. Add the branch → PR working agreement.
6. Add: image URLs are read from payloads, never constructed.
7. Add: only `filters=price_overview` accepts multiple appids.
8. Replace the `ISteamApps/GetAppList` sync description with `IStoreService`.
9. Add the review-data policy: aggregates only, requested with `num_per_page=0`
   and `purchase_type=all`; review bodies and author identifiers are never
   fetched, stored, or rendered.

---

## 6. Testing

Vitest covers the price parser (discounted, undiscounted, free, absent), the media
extractor, the `success:false` path, the empty-array `data` case, and TTL
selection — all against fixtures captured live this session and committed under
`tests/fixtures/steam/`. Playwright covers sign-in, theme toggle, and the health
endpoint at first, growing with the UI. Database-touching tests run against a real
Neon branch, not a mock.

Definition of done is CLAUDE.md's: code written, `pnpm build`, `pnpm lint`,
`pnpm typecheck` passing with pasted output, the path exercised, Steam shapes
observed live, and an explicit statement of what was and was not verified.
