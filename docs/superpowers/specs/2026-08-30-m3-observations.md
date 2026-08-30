# M3 — Live observations

Date: 2026-08-30
Machine: local (Czech IP, no proxy)

Everything here was observed live. Each item names the command, its output, and the value
pinned as a result. Anything not observed says so and carries no number. §1 to §6 come from
one session; §2a was added from a later session the same day and says so.

These resolve §8 of `2026-08-30-m3-hydration-design.md`.

---

## 1. `appdetails` payload shapes

Fixtures captured with `cc=cz&l=english`, one appid per request:

```
tests/fixtures/steam/appdetails-620.json       28,314 bytes  success=true  type=game   price 975 EUR   movies=17 screenshots=12
tests/fixtures/steam/appdetails-570.json       16,089 bytes  success=true  type=game   is_free=true    movies=5  screenshots=10
tests/fixtures/steam/appdetails-1174180.json   16,430 bytes  success=true  type=game   price 1499 EUR  movies=2  screenshots=5
tests/fixtures/steam/appdetails-323180.json     3,465 bytes  success=true  type=music  is_free=true    movies=0  screenshots=1
tests/fixtures/steam/appdetails-missing.json       31 bytes  {"999999999":{"success":false}}
```

Keys present on appid 620's `data`:

```
about_the_game, achievements, background, background_raw, capsule_image, capsule_imagev5,
categories, content_descriptors, controller_support, detailed_description, developers, dlc,
genres, header_image, is_free, linux_requirements, mac_requirements, metacritic, movies,
name, package_groups, packages, pc_requirements, platforms, price_overview, publishers,
ratings, recommendations, release_date, required_age, screenshots, short_description,
steam_appid, support_info, supported_languages, type, website
```

### 1a. `movies[]` URL fields are strings, not variant objects

The plan assumed `hls_h264` / `dash_h264` / `dash_av1` were `Record<string, string>` needing a
"pick the first variant" helper. They are plain strings:

```json
{
  "id": 256768371,
  "name": "RDR2 60 FPS Trailer (INT)",
  "thumbnail": "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/256768371/movie.293x165.jpg?t=1574881352",
  "dash_av1": "https://video.akamai.steamstatic.com/store_trailers/1174180/254764/7a9619def1d2b41fbb7aeab0ebd6a2b4ada81f0d/1750634248/dash_av1.mpd?t=1574881352",
  "dash_h264": "https://video.akamai.steamstatic.com/store_trailers/1174180/254764/.../dash_h264.mpd?t=1574881352",
  "hls_h264": "https://video.akamai.steamstatic.com/store_trailers/1174180/254764/.../hls_264_master.m3u8?t=1574881352",
  "highlight": true
}
```

**Consequence:** `mediaEntrySchema` types these as `z.string().optional()` and the mapper reads
them directly. The `firstUrl()` helper the plan specified is deleted. No `mp4` or `webm` key
appears, consistent with the M1 design.

### 1b. Other confirmed shapes

```
screenshots[0]      {"id":0,"path_thumbnail":"https://shared.akamai.steamstatic.com/...600x338.jpg?t=...","path_full":"...1920x1080.jpg?t=..."}
pc/mac/linux_requirements   object on 620, 570 and 323180 (an array remains possible on other apps; the column stays jsonb and the field stays unknown)
content_descriptors 620 → {"ids":[],"notes":null}    1174180 → {"ids":[5],"notes":null}
release_date        {"coming_soon":false,"date":"18 Apr, 2011"}
metacritic          {"score":95,"url":"https://www.metacritic.com/game/pc/portal-2?ftag=..."}
recommendations     {"total":389704}
achievements.total  51
price_overview      {"currency":"EUR","initial":975,"final":975,"discount_percent":0,"initial_formatted":"","final_formatted":"9,75€"}
genres[]            {"id":"1","description":"Action"}      — id is a STRING
categories[]        {"id":2,"description":"Single-player"} — id is a NUMBER
```

`cc=cz` returning EUR is confirmed again on both priced fixtures.

**Not observed:** an `appdetails` response whose `data` is an empty array. The M1 design records
that shape for the multi-appid `price_overview` form, which §3 below confirms.

---

## 2. Storefront rate limit — a floor, not a ceiling

A bounded ramp against `appdetails`, 40 requests per tier, stopping at the first 429:

```
tier interval=1500ms: 40 requests in 69.3s = 0.58 req/s  (cumulative 40)
tier interval=1000ms: 40 requests in 47.7s = 0.84 req/s  (cumulative 80)
tier interval=750ms:  40 requests in 37.6s = 1.06 req/s  (cumulative 120)
tier interval=500ms:  40 requests in 27.5s = 1.45 req/s  (cumulative 160)
tier interval=350ms:  40 requests in 21.5s = 1.86 req/s  (cumulative 200)
NO LIMIT HIT: 200 requests in 203.6s = 0.98 req/s overall
```

**No 429 or 403 was returned at any tier.** This measurement therefore establishes a floor —
1.86 req/s sustained for 21.5 seconds did not trigger limiting — and **not** a ceiling. The
probe deliberately stopped rather than climbing until it provoked a block.

For context, the widely repeated "200 requests per 5 minutes" equals 0.67 req/s. This run sent
200 requests in 3.4 minutes without limiting, which is not consistent with that figure being a
hard ceiling, but is not proof it is wrong either: the limit may be windowed, per-endpoint, or
applied at a burst rate this ramp never reached.

**Pinned:** `DEFAULT_STOREFRONT_RPS = 1.2` — about 65% of the highest rate observed without
limiting. At that rate the 183,108-game backfill is roughly 42 hours and the 61,892 DLC a
further 14.

**Still unverified:** where the storefront actually starts refusing. Nothing in the code states
a ceiling.

**Superseded in part:** the wall-clock projections above assume the job achieves 1.2 req/s. It
does not — see §2a, which measures the end-to-end rate at 0.52–0.58 req/s.

---

## 2a. End-to-end hydration throughput — slower than the limiter interval implies

Observed in a later session the same day, during the post-M6 backfill. This confirms the
per-app cost already recorded in `2026-08-30-m3.5-ranked-lists-design.md` §9 (500 apps at
2.05s each) from a different part of the queue: all 365 `steam_list` appids were already
hydrated, so every app measured here came from the non-listed backlog.

```
$ pnpm hydrate --max-duration=300
hydrate: attempted=158 ok=158 unavailable=0 failed=0
hydrated 158 ok, 0 unavailable, 0 failed of 158 attempted in 301.4s
```

Per-app cost derived from `game.fetched_at`, which times the writes themselves rather than the
process, segmenting the two runs at any inter-app gap over 10s:

```
probe run   158 apps, 293.5s span = 0.535 apps/s = 1,926 apps/h  (1.87 s/app)
main run     55 apps,  93.4s span = 0.578 apps/s = 2,081 apps/h  (1.73 s/app)
inter-app gap, both runs: p50=1.73s  p90=2.11s  p99=2.44s
```

`fetchAppDetails` issues exactly one storefront request per app and no retry fired (0 failed),
so apps/s is req/s here. **The job sends 0.52–0.58 req/s** — under half the 1.2 rps pinned in
§2, and under a third of the 1.86 req/s §2 observed without limiting. Raising
`STEAM_STOREFRONT_RPS` alone would not close that gap: the limiter interval at 1.2 rps is
0.833s, leaving roughly 0.9–1.2s per app spent outside it. m3.5 §9 traces that structurally
through the code — serial fetch, then a multi-statement transaction to Neon, then `markOk`,
with `limiter.acquire()` reserving its slot from `now` so database time is added on top of the
interval rather than absorbed by it.

**Not measured:** the split between fetch latency and database round trips, and whether
concurrent in-flight apps would help. Nothing here establishes a safe concurrency level, and
no concurrency change has been made.

**Consequence for planning:** at 1,900–2,100 apps/h, a full pass over the 182,580 pending games
is roughly 90–95 hours and the 61,893 DLC a further 30. The 42-hour and 14-hour figures in §2
are computed from the limiter interval alone and do not hold once per-app database cost is
counted — the same correction m3.5 §9 reached from its own sample.

**Also observed:** 245 consecutive non-listed apps hydrated with 0 `unavailable` and 0 `failed`
(`steam_app` holds no row in either state). m3.5 §9 recorded that no *listed* appid returned
`success: false`; that now extends to this stretch of the backlog. It says nothing about the
catalogue as a whole: the queue orders by `steam_last_modified desc`, so this sample sits at
the recently-updated end, where delisted apps are least likely.

---

## 3. `filters=price_overview` batch maximum — no boundary found

Distinct appids per request, counting how many keys came back:

```
requested=3   status=200 bytes=231    keysReturned=3    withPrice=1
requested=5   status=200 bytes=434    keysReturned=5    withPrice=2
requested=10  status=200 bytes=1155   keysReturned=10   withPrice=6
requested=20  status=200 bytes=2829   keysReturned=20   withPrice=16
requested=30  status=200 bytes=4263   keysReturned=30   withPrice=24
requested=40  status=200 bytes=5967   keysReturned=40
requested=50  status=200 bytes=7396   keysReturned=50
```

Repeated with 200 real appids drawn from our own `steam_app` table:

```
requested=60   urlLen=571   status=200 bytes=2221  keysReturned=60
requested=100  urlLen=891   status=200 bytes=3701  keysReturned=100
requested=150  urlLen=1291  status=200 bytes=5551  keysReturned=150
requested=200  urlLen=1691  status=200 bytes=7401  keysReturned=200
```

Every requested appid came back at every size tested, up to 200.

**Pinned:** `PRICE_BATCH_SIZE = 100` — half the largest size verified working, for margin
against a boundary this probe did not find.

**Consequence:** a full price sweep of 183k priced games is roughly 1,831 requests rather than
18,311 at the plan's placeholder of 10.

**Still unverified:** the true maximum, and whether Steam silently truncates above some size
this probe did not reach.

---

## 4. Advisory locks: the pooled endpoint provides no mutual exclusion

Two separate clients against the same endpoint, both calling `pg_try_advisory_lock` on the same
key. Correct behaviour is `first=true second=false`.

```
direct (DATABASE_URL_UNPOOLED): first=true second=false secondAfterAsNextStatement=false
pooled (DATABASE_URL):          first=true second=true  secondAfterAsNextStatement=true
```

**The pooled endpoint grants the same advisory lock to two concurrent clients.** A worker
holding `pg_try_advisory_lock` over `DATABASE_URL` would not exclude a second worker at all —
the guard would silently do nothing while appearing to work.

**Consequence:** both job CLIs point `DATABASE_URL` at `DATABASE_URL_UNPOOLED` before importing
the database client. This is now a correctness requirement, not a precaution about long-running
connections.

An earlier run of this probe reported `first=false` on the direct endpoint. That was an artifact
of the pooled test immediately before it: advisory locks are database-wide, and a lock still held
by that test's second client blocked the direct attempt. Re-running each endpoint in isolation,
with a fresh key and `pg_advisory_unlock_all()` between them, produced the results above.

---

## 5. `price_change_number` semantics — not verified

Stored by the catalogue sync as of Task 2, but nothing in this session established whether it is
comparable across syncs, so no code uses it to skip apps. `refresh:prices` ignores it.

---

## 6. Review policy holds

```
$ jq '{success, query_summary}' tests/fixtures/steam/appreviews-620.json
{"success":1,"query_summary":{"num_reviews":0,"review_score":9,
 "review_score_desc":"Overwhelmingly Positive","total_positive":208479,
 "total_negative":2465,"total_reviews":210944}}

$ jq '.reviews | length' tests/fixtures/steam/appreviews-620.json
0

$ grep -c -i "steamid\|personaname\|playtime_forever" tests/fixtures/steam/appreviews-620.json
0
```

`num_per_page=0` means the bodies never arrive: the `reviews` array is empty and the payload
contains no author identifiers at all. Top-level keys are `cursor, query_summary, reviews,
success`. Note `success` is the number `1`, not a boolean — the parser reads only
`query_summary`, so this does not matter, and it is recorded here so nobody later assumes a
boolean.
