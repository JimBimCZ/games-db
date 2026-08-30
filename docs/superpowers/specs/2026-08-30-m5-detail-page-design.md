# M5 — Detail page — Design

Date: 2026-08-30
Status: approved for implementation planning

M4 shipped browse and left `/game/[appid]` as a 56-line stub: title, header image, a
three-row definition list, and a link to Steam. Every field the detail page is supposed to
show is already hydrated and sitting in the database unused.

Counted live against Neon on 2026-08-30, after the M4 merge:

```
game 552 · game_media 6,567 (5,474 screenshot · 1,093 movie) · game_category 4,989
review_summary 1 · price 262 · price_history 279
```

M5 is therefore a rendering milestone. It adds no Steam job, no new table, and exactly one
new runtime dependency — `hls.js`, already on CLAUDE.md's approved list.

---

## 1. What is already there

Every column the design doc's Detail section calls for was written by M3's hydration and
has never been read. Coverage across the 552 hydrated games, counted live:

| Field | Non-null | Note |
|---|---|---|
| `background_raw` | 552 | hero source |
| `about_html` | 552 | sanitised at write time |
| `pc_requirements` | 552 | never `[]` |
| `supported_languages_raw` | 552 | sanitised at write time |
| `game_media` rows | 552 games | 0 games have no media at all |
| movies | 510 games | 42 hydrated games have screenshots but no trailer |
| `dlc_appids` non-empty | 179 | |
| `content_descriptor_ids` non-empty | 155 | ids 1–5 all occur |
| `achievements_total` | 211 | |
| `recommendations_total` | 157 | |
| `metacritic_score` | 57 | |
| `mac_requirements` = `[]` | 222 | the empty-array case is the common case |
| `linux_requirements` = `[]` | 227 | |

The last three rows set the rule for the right rail and the requirements section: **every
block is individually optional.** Metacritic is present on 10% of hydrated games. A layout
that assumes these fields exist is wrong for the majority of the catalogue.

---

## 2. Decisions taken

| Decision | Rationale |
|---|---|
| New `server/detail/queries.ts` | `server/browse/queries.ts` is 197 lines and browse-shaped. Detail's query set is bigger than browse's and shares none of it. |
| `gameDetail()` moves out of browse | The game page is its only caller. |
| Review score read-through on page view | The one path CLAUDE.md permits a live call: a game the user explicitly opened. No bulk Steam traffic. |
| Price chart hand-rolled in inline SVG | No chart library is on the approved list, and a step chart of ≤20 points does not justify asking for one. |
| Content descriptor **ids are not rendered** | See §5. A guessed id→label map mislabels real games. |
| Media viewer is the only new `'use client'` file | Everything else is a server component. |
| Two PRs | Core page, then the five extra sections. |

---

## 3. Verified during design

### 3.1 The HLS manifests are real and reachable

Fetched live, 2026-08-30, the `hls_url` stored for appid 570 position 0:

```
HTTP 200 · content-type: application/vnd.apple.mpegurl · 706 bytes

#EXTM3U
#EXT-X-VERSION:7
#EXT-X-INDEPENDENT-SEGMENTS
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Default",AUTOSELECT=YES,DEFAULT=YES,URI="hls_264_4_audio.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=5800000,CODECS="avc1.640029,mp4a.40.2",RESOLUTION=1920x1080,FRAME-RATE=30,AUDIO="audio"
hls_264_0_video.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2600000,CODECS="avc1.640029,mp4a.40.2",RESOLUTION=1280x720,FRAME-RATE=30,AUDIO="audio"
hls_264_1_video.m3u8
```

A multi-variant master playlist with a separate audio rendition. All 1,093 stored movie
rows have a non-null `hls_url`. The MIME type above is the exact string the Safari
capability check tests for.

### 3.2 The video host is already allowed

Movies live on `video.akamai.steamstatic.com`, images on
`shared.akamai.steamstatic.com`. `next.config.ts` already carries
`{ hostname: '**.akamai.steamstatic.com' }`, which covers both. No config change.

### 3.3 Requirements JSON is stored unsanitised, by design

`server/catalogue/map-app-details.ts:91-94` states it outright: the requirements fields
bypass `sanitize()` because their embedded HTML sits inside a shape the mapper will not
guess at, and **the code that puts these fields on the page must sanitise them at render
time.** M5 is that code. This is the single most important constraint in the milestone.

The observed shape for appid 570 is `{"minimum": "<strong>Minimum:</strong><br><ul …"}`,
and 222 of 552 games store `[]` for `mac_requirements`. Both shapes must parse without
throwing.

### 3.4 `supported_languages_raw` is a parseable string, not a list

Appid 570, stored value (truncated):

```
Bulgarian, Czech, Danish, Dutch, English<strong>*</strong>, Finnish, French, German,
… Vietnamese<br><strong>*</strong>languages with full audio support
```

Comma-separated names; `<strong>*</strong>` immediately after a name marks full audio; a
trailing `<br>`-prefixed footnote explains the asterisk. Dota 2 yields 28 languages, 3
starred. This is a parser with edge cases, so it gets unit tests.

### 3.5 Price history barely exists yet

```
appid 2147481100 · 16 rows · 2026-08-30 11:13 → 12:53
appid 620        ·  2 rows · 2026-08-30 11:14 → 11:24
```

Two appids of 262 priced games have more than one observation, and both sets were produced
by `refresh:prices` runs during M3 development within a single afternoon — they are
development churn, not a market history. The chart must therefore be built for a table
that is almost always too thin to plot, and it must say so honestly rather than drawing a
misleading flat line. Real history accrues as `refresh:prices` runs on schedule.

---

## 4. Module layout

```
server/detail/queries.ts       gameDetailFull(appid) — every row the page needs
lib/format/languages.ts        parseSupportedLanguages() — tested
lib/format/requirements.ts     parseRequirements() shape guard + sanitise — tested
lib/format/price-series.ts     buildPriceSeries() — tested
components/media-viewer.tsx    'use client' — gallery + hls.js player
components/review-bar.tsx      server
components/price-card.tsx      server
components/detail/*.tsx        the five extra sections, server
app/game/[appid]/page.tsx      composition
app/game/[appid]/loading.tsx   skeleton matching the new layout
```

`gameDetailFull` runs a fixed set of indexed queries — game row, media, genres,
categories, DLC names, current price, price history — and returns one object. It never
fans out to Steam and its query count does not vary with the size of any list, per
CLAUDE.md's rule against per-item fetches.

The review summary is deliberately *not* part of `gameDetailFull`. It comes from the
existing `getReviewSummary(appid)` in `server/catalogue/review-summary.ts`, which is a
read-through cache that may make a live Steam call. Keeping it separate keeps
`gameDetailFull` a pure database read.

---

## 5. Content warnings: ids are not labels

`content_descriptor_ids` contains values 1–5 across the 155 games that carry any. There is
an obvious temptation to map them to the labels Steam shows on its own store pages. The
data says not to. Sampled live:

```
[5] → "Dota 2 includes fantasy violence, use of alcohol, and mild partial nudity."
[5] → "This game contains no adult content. It features non-violent, stylized
       bomb-defusal gameplay focused on cooperative puzzle-solving."
[5] → "LIVORA contains mature life themes … does not contain graphic violence, gore,
       explicit sexual content, nudity, or depictions of self-harm."
```

The same id sits on a game with partial nudity and on a game whose own note states it has
no adult content. Whatever id 5 means, it is not a content label we can render beside a
game's title without risking a false accusation about somebody's game.

**M5 renders `content_descriptor_notes` only** — Steam's own free text, under a neutral
heading — and drops the ids. The section is omitted entirely when the notes are null.

> `TODO`: descriptor ids are stored but never displayed. Before any id→label mapping is
> added, the meaning of ids 1–5 must be confirmed against a Valve-published source or
> against enough live store pages to be sure, and the mapping recorded here with that
> evidence. Do not infer it from the ids that happen to appear in our table.

---

## 6. The page

### 6.1 Hero

Full-bleed band from `background_raw` (present on all 552), title and release text over a
gradient scrim that keeps text contrast legible against an arbitrary image. Header image is
no longer shown at the top — the media viewer supersedes it.

### 6.2 Media viewer — `components/media-viewer.tsx`

The only new client component. Items are the game's `game_media` rows, movies first by
`position`, then screenshots.

- Selected item renders large. Screenshots use `next/image` on `full_url`; movies use
  `<video controls preload="none">` with `thumbnail_url` as the poster.
- A thumbnail strip below, each a real `<button>` with an accessible name — the movie's
  `name`, or `Screenshot N` for screenshots, which carry no name.
- **hls.js loads lazily and conditionally.** If
  `video.canPlayType('application/vnd.apple.mpegurl')` is truthy the `hls_url` is assigned
  to `video.src` directly (Safari). Otherwise `await import('hls.js')` — and only at the
  moment a movie is first selected, so a visitor who never plays a trailer never downloads
  the library.
- No autoplay. The player is torn down on unmount and when switching items, so switching
  trailers does not leak a detached HLS instance.
- 42 hydrated games have no movie at all; the viewer opens on the first screenshot in that
  case and no video code path runs.

### 6.3 Right rail

Price card, review bar, then Metacritic, recommendations, achievements, developers,
publishers, platforms. Every one of these is conditional — see the coverage table in §1.

The price card reuses `formatMinor` and always renders discount context with the final
price: struck-through original and the percentage when `discount_percent > 0`, per
CLAUDE.md's rule that a price never appears without it.

The review bar renders a positive-ratio bar plus `review_score_desc` and the counts, e.g.
`Very Positive · 303,463 of 329,951`. `getReviewSummary` returns `undefined` on any Steam
failure — it already swallows and logs — so the block is simply absent. A missing review
score never fails the page.

### 6.4 About

`about_html`, sanitised at write time by M3. Rendered with `dangerouslySetInnerHTML`, which
is safe here precisely because the sanitising already happened before the value was
cached — unlike the requirements HTML in §7.1.

---

## 7. The five extra sections

### 7.1 System requirements

`parseRequirements()` in `lib/format/requirements.ts` takes the jsonb `unknown`, validates
it with Zod against `{ minimum?: string, recommended?: string }`, and returns `null` for
anything else — which covers the 222 `[]` values on mac and the 227 on linux. Each surviving
string is passed through `DOMPurify.sanitize` **at render time**, discharging the obligation
`map-app-details.ts:91-94` records.

One block per platform the game's `platforms` jsonb marks true and for which requirements
actually parse, with minimum and recommended as sub-blocks.

### 7.2 DLC and editions

`dlc_appids[]` resolved to names in a single `inArray` query against `game` — one query, not
one per id. Entries that resolve to a hydrated game link to its detail page; the rest render
as plain text. Section omitted when the array is empty (373 of 552 games).

### 7.3 Language table

`parseSupportedLanguages()` per §3.4, rendering a table of language name against a full-audio
column. Section omitted if the parser finds no languages.

### 7.4 Content warnings

Per §5: `content_descriptor_notes` only, ids dropped, section omitted when null.

### 7.5 Price history chart

`buildPriceSeries()` reads `price_history` rows for the game at the current `cc`, ordered by
`observed_at`, and returns points of `{ observedAt, finalMinor, discountPercent }`.

- Fewer than two points → no chart. The section renders a single quiet line: no price
  changes recorded yet. This is the case for 260 of 262 priced games today.
- Two or more → a step line in inline SVG in a server component, no client JS and no chart
  library. Price changes are steps, not slopes; a smooth line would imply prices we never
  observed.

Both branches are checkable against real rows: appid `2147481100` has 16 observations and
`620` has 2.

---

## 8. Loading and error states

`app/game/[appid]/loading.tsx` is rebuilt to mirror the new two-column layout — hero band,
media viewer block, rail — per CLAUDE.md's rule that skeletons match the final layout. An
unparseable or unknown appid keeps M4's `notFound()`.

---

## 9. Testing

Vitest, over pure functions and against fixtures — no database-touching tests:

- `parseSupportedLanguages` — the Dota 2 string (28 languages, 3 starred), a single
  unstarred language, an empty string, and a string that is only the footnote.
- `parseRequirements` — the `{minimum, recommended}` object, `{minimum}` alone, `[]`,
  `null`, and a junk value. Plus a case asserting a `<script>` in the HTML does not survive
  sanitising.
- `buildPriceSeries` — zero, one, and many points, and ordering by `observed_at`.
- Review-bar ratio formatting, including `total_reviews` of 0.

Playwright adds a detail-page check to `e2e/smoke.spec.ts`: appid 570 renders its title,
thumbnail strip, and requirements section with no console errors.

---

## 10. Out of scope

- Library and wishlist controls — M6.
- Bulk warming of `review_summary`. Read-through on page view only.
- Any change to hydration, `refresh:prices`, or the schema. M5 adds no migration.
- Descriptor id→label mapping, per the `TODO` in §5.
- Reviews beyond the aggregate. Bodies and author identifiers are never fetched, stored, or
  rendered, per CLAUDE.md's review-data policy.

---

## 11. PR split

**PR 1 — core page.** `server/detail/queries.ts`, hero, media viewer with hls.js, About,
price card, review bar, rebuilt skeleton.

**PR 2 — extras.** The five sections of §7 and their parsers and tests.

---

## 12. Definition of done

Per CLAUDE.md: code written; `pnpm build`, `pnpm lint`, `pnpm typecheck` passing with pasted
output; the detail page exercised against real rows for an appid with a trailer (570), one
without (any of the 42), and one with price history (2147481100); Vitest and the Playwright
smoke check passing; and an explicit statement of what was verified and what was not.

Trailer playback must be confirmed in an actual browser on both paths — native HLS and the
hls.js fallback — or reported as unverified. A trailer that loads its manifest is not a
trailer that plays.
