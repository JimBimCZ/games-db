# M4 — Browse — Design

Date: 2026-08-30
Status: approved for implementation planning

M3.5 left the catalogue with four ranked lists and a hydrated core. Counted live against
Neon on 2026-08-30, immediately after the M3.5 merge:

```
steam_app:  game/pending 182,580   dlc/pending 61,893   game/ok 552
game 552 · genre 19 · game_genre 1,600 · price 262 (165 discounted) · review_summary 1
steam_list: top_sellers 100 · specials 100 · coming_soon 100 · new_releases 100
```

Every route the sidebar already links to — `/specials`, `/coming-soon`, `/new-releases`,
`/library` — is a 404 today, and `/` renders the string "Discover". M4 makes the store half
of that sidebar real.

---

## 1. The constraint that shapes this milestone

0.3% of the catalogue is hydrated: 552 games of 182,580. At the ~2.05s per app measured in
M3.5 §9, hydrating even a tenth of the remainder is a multi-day job.

**Browse therefore queries the `game` table and nothing else.** Whatever is hydrated is what
is browsable. The pages get richer for free as hydration runs; no hydration work happens
inside M4. `steam_app`'s 244k names are not reachable from any browse surface, including
search — a name-only result that cannot be opened is worse than no result.

The honest consequence, which the UI states rather than hides: pages can be sparse, and the
empty state says the catalogue is still hydrating.

---

## 2. Decisions taken

1. Browse reads `game`; never `steam_app`, never Steam.
2. The four store pages take their contents *and* their ordering from `steam_list`.
3. Discover is a hero plus one capped grid per ranked list. Genres live in the sidebar and
   on their own pages.
4. Search is a toolbar input that navigates to a server-rendered `/search?q=` page.
5. Cards link to a minimal `/game/[appid]` stub, which M5 expands into the full detail page.
6. Grid cards use `header_image`, not `capsule_image`. See §8.

---

## 3. Verified during design

Run live against Neon and against the stored payloads on 2026-08-30.

### 3.1 `pg_trgm` is available

```
select name, default_version, installed_version
  from pg_available_extensions where name in ('pg_trgm','unaccent');
→ pg_trgm  1.6  null
  unaccent 1.1  null

create extension if not exists pg_trgm;   → succeeded
select extname from pg_extension;         → plpgsql, pg_trgm
```

The extension was created on the development database during this probe. It is idempotent
and the migration in §7 carries it to every other environment.

`unaccent` is available but not installed; M4 does not use it.

### 3.2 Image fields are populated on every hydrated game

```
select count(*) total, count(capsule_image) capsule, count(header_image) header,
       count(release_date) reldate from game;
→ total 552 · capsule 552 · header 552 · reldate 340
```

212 of 552 have no parsed `release_date` — they are unreleased, and carry
`release_coming_soon = true` with a `release_date_text` of "Coming soon".

Two live URLs, one with a hash segment and one without:

```
570      https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/570/capsule_231x87.jpg?t=…
                                                                             …/header.jpg?t=…
4434410  …/steam/apps/4434410/b60b0f7b840b322e4cbb7e33507366508c870b31/capsule_231x87.jpg?t=…
         …/steam/apps/4434410/1a0302028271d59dd5c5c75d4e8e58d9d62394f5/header.jpg?t=…
```

The hash segment differs between the capsule and the header of the same app, which is why
URLs are read from the payload and never constructed. `next.config.ts` already allows
`**.akamai.steamstatic.com`; no change is needed.

### 3.3 Genre distribution is lopsided

```
Indie 319 · Action 232 · Casual 201 · Adventure 200 · Simulation 170 · Strategy 154
RPG 127 · Early Access 66 · Free To Play 57 · Massively Multiplayer 33 · Racing 17 · Sports 17
Utilities 1 · Movie 1 · Design & Illustration 1 · Game Development 1 · Photo Editing 1
Video Production 1 · Animation & Modeling 1
```

Seven genres hold exactly one game each, all of them software categories on apps whose
`type` is nevertheless `game`. §6 filters them out of the sidebar.

---

## 4. Module layout

```
server/browse/queries.ts      every browse query; returns GameCard[] / GameSummary
server/browse/params.ts       Zod validation for q, page, genre id
lib/format/price.ts           minor units → Intl.NumberFormat string
components/game-card.tsx      one card
components/card-grid.tsx      responsive grid + empty state
components/featured-hero.tsx  the Discover hero
components/search-input.tsx   'use client'
app/page.tsx                          Discover
app/top-sellers/page.tsx
app/specials/page.tsx
app/coming-soon/page.tsx
app/new-releases/page.tsx
app/genre/[id]/page.tsx
app/search/page.tsx
app/game/[appid]/page.tsx     M5 stub
```

Two boundaries hold. Nothing under `app/` imports Drizzle — routes call
`server/browse/queries.ts` and hand the result to a component. And `server/browse/` never
imports from `server/steam/`: browse is a pure database read, so no browse path can fan out
to Steam even by accident.

---

## 5. The data contract

```ts
type GameCard = {
  appid: number
  name: string
  headerImage: string | null
  capsuleImage: string | null
  shortDescription: string | null
  releaseDateText: string | null
  releaseComingSoon: boolean
  isFree: boolean
  price: {
    currency: string
    initialMinor: number
    finalMinor: number
    discountPercent: number
  } | null
}
```

`shortDescription` is on the card rather than in a separate query because the Discover hero
is a card with prose next to it; no grid card renders it.

`price` is genuinely nullable: only 262 of 552 games have a row, so the card renders
correctly without one. Three states, and nothing else:

- **Free** (`isFree`) → "Free".
- **Priced** → the final amount. Whenever `discountPercent > 0`, also the struck-through
  initial amount and a `−X%` badge. A price is never rendered without its discount context.
- **Unknown** (no row, not free) → no price element at all. Not a dash, which reads as
  "costs nothing".

Amounts come from the minor-unit integers and are formatted with `Intl.NumberFormat` using
the row's own `currency`. The country code is never used to infer a currency.

---

## 6. Routes

### 6.1 The four list pages

`steam_list` **inner** join `game`, ordered by `rank`, served by `steam_list_rank_idx`.

The inner join is deliberate. A fresh `sync:lists` can name an appid hydration has not
reached yet; skipping it yields a page of 97 rather than a page with three broken holes.
Accepted consequence: these pages can show fewer than 100 games without anything being
wrong.

`/top-sellers` is a new route. The sidebar has no entry for it today and gains one, because
Discover carries a Top Sellers row whose "See all" must land somewhere.

### 6.2 Discover

Hero: rank 1 of `top_sellers` — header image, name, short description, price.

Then four sections in this order: Top Sellers, Specials, Coming Soon, New Releases. Twelve
cards each, each with a "See all" link to its full page. Five queries for the page, all
indexed.

### 6.3 Genre pages and the sidebar

The sidebar becomes an async server component. It reads the `genre` table joined to
`game_genre`, lists genres alphabetically, and **filters to those with at least 3 games**.
Without that filter the sidebar carries a permanent tail of one-item software categories
(§3.3) that are noise in a games app. The threshold is a floor on noise, not a cap on
growth: genres cross it as hydration runs.

`/genre/[id]` sorts by `release_date desc nulls last, name`, paginated with `?page=` at 60
per page. Indie is already 319 rows and only grows, so pagination is not speculative here.

### 6.4 Search

The toolbar input is the one new client component. It debounces and calls
`router.push('/search?q=…')`. The page is a server component running one query:

```sql
where name ilike '%' || $q || '%'
order by similarity(name, $q) desc, name
limit 50
```

A GIN trigram index on `game.name` makes the leading-wildcard `ILIKE` index-assisted, which
a B-tree cannot do. Capped at 50 with no pagination — a search that needs a 51st result
needs better terms, not another page.

`q` is validated at the boundary with Zod: trimmed, 2 to 100 characters. Anything shorter
renders the empty state without touching the database.

### 6.5 The `/game/[appid]` stub

Name, header image, price with discount context, release date text, genres, and a link out
to the Steam store page. It exists so browse can be exercised end to end and so M5 has a
route to expand rather than a set of card links to rewrite. Everything else in §3.5 of the
main design — trailer, gallery, review bar, requirements, DLC, price history — is M5.

---

## 7. Schema changes

Both go in `db/schema.ts` and are generated with `pnpm db:generate`:

```ts
index('game_name_trgm_idx').using('gin', sql`${t.name} gin_trgm_ops`)
```

`CREATE EXTENSION IF NOT EXISTS pg_trgm` has no `schema.ts` equivalent, so it is appended by
hand to the generated migration, above the index. This is the one place in the project where
SQL is added to a migration by hand; it is idempotent, and the index below it does not
compile without it.

The existing `game_name_idx` B-tree stays. The trigram index does not replace it: a GIN
index cannot serve an ordered scan, and the B-tree remains the only index on `name` usable
for ordering.

---

## 8. Images: a deliberate departure from CLAUDE.md

CLAUDE.md says card grids use "landscape capsule art". Cards will use `header_image`
instead.

`capsule_231x87.jpg` is 231px wide and visibly soft in a grid cell around 260px.
`header.jpg` is 460×215 — the same landscape shape at twice the resolution, and the asset
Steam's own store uses for tiles. Both are read from the payload; neither is constructed.

**CLAUDE.md is amended as part of this milestone** to say "landscape header/capsule art",
so the file stops contradicting the code. `capsuleImage` stays on `GameCard` for M5's denser
surfaces.

Cards render through `next/image` with `loading="lazy"`, and alt text is the game title.

---

## 9. Errors, loading, and empty states

No browse path calls Steam, so there is no stale-cache case and no Steam error to handle.

- A database error surfaces through the route's error boundary.
- `loading.tsx` per route renders grid skeletons matching the final layout, not spinners.
- Empty results state that the catalogue is still hydrating. At 0.3% this is the truth, not
  a euphemism.

---

## 10. Testing

Vitest over the pure functions, no database:

- price formatting across all four states — discounted, undiscounted, free, absent
- the `q` and `page` validators, including the below-minimum short-circuit
- `GameCard` mapping from a row, including a row with no price

One Playwright smoke walking Discover → "See all" → a card → the stub detail page.

Then a manual pass over all eight routes — the seven browse surfaces plus the `/game/[appid]`
stub — against the real database, with output pasted.

Database-backed integration tests are deliberately skipped: they are slow and this is a
personal project.

---

## 11. Out of scope

- The toolbar view switcher. It needs the library, which is M6.
- Sort controls and any filter beyond genre.
- Hydration of any kind. M4 adds no jobs and changes no job.
- DLC surfaces. `game` holds only `type = 'game'` rows today.
- The full detail page. M5.

---

## 12. Definition of done

`pnpm build`, `pnpm lint`, `pnpm typecheck` and `pnpm test` pass with output pasted. All
eight routes exercised against the real database with output pasted. The migration applied
to real Neon and the trigram index confirmed in use. The PR states plainly which claims were
verified in this session and which were not.
