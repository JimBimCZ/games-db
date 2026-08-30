# M3 — Steam client and hydration — Design

Date: 2026-08-30
Status: approved for implementation planning

M2 left the catalogue index populated and inert: 183,108 games and 61,892 DLC in
`steam_app`, every row `hydration_state = 'pending'` (counted live against the Neon
database on 2026-08-30). M3 builds the machinery that turns those appids into rows the
browse and detail pages can read: a rate-limited Steam client, Zod parsers, a freshness
policy, and the two jobs that use them.

---

## 1. What already exists

| Module | What it does | Changes in M3 |
|---|---|---|
| `server/steam/client.ts` | `steamFetchJson` — retry, exponential backoff, `Retry-After` handling capped at 60s, non-JSON error bodies | Gains a per-host limiter and a request timeout |
| `server/steam/app-list.ts` | `IStoreService/GetAppList` parser and cursor walk | Carries `price_change_number` through |
| `server/catalogue/sync.ts` | Two-pass upsert into `steam_app`, preserving the hydration queue columns | Writes `steam_last_modified` and `price_change_number` |
| `db/client.ts` | Driver selection, `getDb`, `closeDb`. `Db` deliberately omits `transaction` | Gains `getJobDb()` |
| `db/schema.ts` | `game`, `game_media`, `genre`, `category`, `price`, `price_history`, `review_summary` all exist and are unused | One migration, described in §3 |

Nothing in the app reads `game` yet, so M3 can shape the write path without a consumer to
keep compatible.

## 2. Decisions taken

| Question | Decision |
|---|---|
| Hydration scope | Full coverage, prioritised: games before DLC, most-recently-modified first |
| Execution model | One long-running process bounded by a request/duration budget; the same entry point serves a cron caller with a small budget |
| Review summaries | Not in the backfill. Fetched on demand when a detail page is first opened, through the TTL helper |
| Rate limit | Measured once with a bounded probe, then pinned at a conservative fraction of the observed ceiling |
| Queue claim | Ordered scan under a single Postgres advisory lock |
| Job connection | `DATABASE_URL_UNPOOLED`, subject to the verification in §8 |

### Why full coverage is affordable

At one request per 1.5s — the pre-measurement placeholder — 183,108 games take roughly 76
hours and the DLC a further 26. That is acceptable for a background worker precisely
because the worker is resumable and prioritised: the useful head of the table lands in the
first hours, and the long tail costs only wall-clock time on a machine that is idle anyway.
If the probe in §8 shows headroom, both figures fall proportionally.

### Why reviews are not in the backfill

`appreviews` sits on the same rate-limited storefront host, so folding it into the backfill
would roughly double it — to spend that budget on 245,000 apps when nothing in browse reads
a review count. The detail page is the only consumer, and it can fetch on first view like
any other cache miss.

## 3. Schema changes

One migration, generated from `db/schema.ts`:

- `steam_app.steam_last_modified` — `timestamptz`, nullable. Steam's `last_modified` from
  the app list, already parsed by `app-list.ts` into `SteamAppListEntry.lastModified` and
  currently discarded. It is the only ordering signal the catalogue carries.
- `steam_app.price_change_number` — `integer`, nullable. Stored now, used by
  `refresh:prices` once its semantics are confirmed (§8).
- The queue index becomes `(hydration_state, next_attempt_at, app_type, steam_last_modified DESC)`.

`upsertAppBatch` writes both new columns in its `onConflictDoUpdate` set, alongside `name`,
`app_type` and `last_seen_in_list_at`. The hydration queue columns stay excluded, for the
reason already commented there: writing them would re-queue the whole catalogue on every
sync.

Populating the columns for existing rows is a `pnpm sync:catalogue` re-run — six requests,
about 18 seconds against the figures observed in M2.

## 4. The client layer

### 4.1 `server/steam/limiter.ts`

A token bucket: a configurable rate, a queue that admits one waiter at a time, and an
`acquire()` that `steamFetchJson` awaits before every request.

The limiter is **per host**, not global. `api.steampowered.com` and
`store.steampowered.com` are different hosts with different behaviour — the M2 sync moves
245,000 appids in 18 seconds against the former, while the latter is the constrained one.
A single global limiter would slow the sync to storefront speed for no reason. The module
exports one instance per host and a comment records why.

Configuration comes from `STEAM_STOREFRONT_RPS`, parsed in `server/env.ts` with a default
pinned from the §8 probe. Until that probe runs the default is 0.67 requests per second (one
per 1.5s), which corresponds to the widely repeated "200 per 5 minutes" figure that this
project has never measured.

`steamFetchJson` also gains an `AbortSignal` timeout so a hung connection cannot stall the
worker indefinitely; a timeout is retried like a network fault.

### 4.2 `server/steam/schemas.ts`

Zod parsers for every payload M3 consumes, each written against a fixture captured live and
committed under `tests/fixtures/steam/`:

- `appdetails` envelope: `{ "<appid>": { success: boolean, data?: ... } }`
- `appdetails` data, for the fields `db/schema.ts` already declares
- `price_overview`, including the multi-appid `filters=price_overview` form
- `appreviews` `query_summary`

Rules the parsers enforce, each from an observation recorded in the M1 design:

- `data` may be an empty **array** for free games — the parser tolerates it and yields no
  price rather than throwing.
- `success: false` with no `data` key parses successfully into an "unavailable" result. It
  is a normal outcome, not an error.
- Unknown fields are ignored; missing optional fields stay `undefined` and are never
  defaulted to a fabricated value. A missing `price_overview` means free or unpriced, not
  zero.
- `initial` and `final` are read as minor-unit integers. `currency` is read from the
  payload, never inferred from `cc`.

### 4.3 `server/steam/ttl.ts`

One object, one place to change a freshness window:

| Entity | TTL | Reason |
|---|---|---|
| `price` | 6 hours | Discounts turn over daily; a stale price is the most visible error |
| `review_summary` | 24 hours | Aggregates move slowly at the scale we display |
| `game` (released) | 30 days | Descriptions, media and requirements are near-static |
| `game` (unreleased, `release_coming_soon = true`) | 24 hours | Release dates and store copy churn until launch |

### 4.4 `server/steam/cache.ts`

The read-through helper every consumer uses:

1. Read the stored row. Inside TTL, return it.
2. Outside TTL, fetch, parse, write, return the fresh value.
3. On a Steam error, timeout, or parse failure, return the stale row and log. Only a miss
   with no stored row at all propagates a failure to the caller.

This is the rule the M1 design states as "a stale price is better than a broken page", made
concrete in one function so no call site can forget it.

### 4.5 Sanitisation

`isomorphic-dompurify` — approved in the M1 design, not yet installed — is applied to
`about_the_game` and `detailed_description` at write time, before insert. Nothing
unsanitised reaches the database, so no reader has to remember to sanitise. Adding the
dependency is part of M3.

### 4.6 `getJobDb()`

`db/client.ts` exports `Db` with `transaction` omitted, because the neon-http driver has no
transactions and a shared type that promised one would compile call sites that break on
Vercel. Hydration needs a real transaction: `game`, `game_media`, the genre and category
joins, and `price` must land together or not at all.

`getJobDb()` returns the full `NodePgDatabase`, throwing if `resolveDriver` does not report
`node-postgres`. Only the job entry points call it; nothing under `app/` does.

## 5. The jobs

### 5.1 `pnpm hydrate`

`server/catalogue/hydrate.ts` plus `server/catalogue/hydrate-cli.mts`, following the
`sync:catalogue` pattern already established (`.mts` entry, `process.loadEnvFile`, dynamic
imports, `closeDb` in a `finally`).

Flow:

1. Take `pg_try_advisory_lock(4801001)`. If it is already held, log and exit 0 — a second
   accidental run must not spend the shared rate budget.
2. Loop: select up to 200 due rows — `hydration_state IN ('pending', 'failed')` and
   `next_attempt_at IS NULL OR next_attempt_at <= now()` — ordered by
   `(app_type = 'game') DESC` then `steam_last_modified DESC NULLS LAST`. The ordering is
   written as that boolean, not as `app_type` itself: sorting the column ascending would put
   `dlc` first.
3. For each appid: one `appdetails` request through the limiter, parse, sanitise, then in
   one transaction write `game`, replace `game_media`, upsert the `genre` and `category`
   dictionaries and their join rows, write `price` and append `price_history` if the price
   changed, and set `hydration_state = 'ok'`, `failure_count = 0`, `next_attempt_at = NULL`.
4. Stop on an empty queue, an exhausted budget, or SIGINT — releasing the lock and closing
   the pool in every case.

Flags: `--max-requests=N`, `--max-duration=<seconds>`, `--appid=N` (a single app, for spot
checks), `--type=game|dlc`.

`appdetails` is called with `cc` from `STEAM_COUNTRY_CODE` and `l=english`, attached in the
one place §4.1 describes.

### 5.2 Failure policy

| Outcome | State | Next attempt |
|---|---|---|
| `success: false`, or a null payload | `unavailable` | 30 days — delisted and region-locked apps do come back |
| 429, 5xx, network fault, timeout | `failed`, `failure_count + 1` | `min(15 minutes × 2^failure_count, 24 hours)`, ±20% jitter |
| Zod parse failure | `failed`, `failure_count + 1` | Same backoff, plus a log naming the appid and the failing field path |

The parse-failure log is the shape-change tripwire. A single failure is one odd app; a
stream of them means Valve changed the payload and the worker is writing nothing useful. The
run therefore aborts when parse failures exceed both 25 in absolute terms and 10% of
attempts, so a wrong parser surfaces in minutes instead of after 183,000 appids.

### 5.3 `pnpm refresh:prices`

`filters=price_overview` is the one `appdetails` form that accepts several appids — verified
in the M1 design for three appids; the practical maximum is unknown and is measured in §8.

The job walks `game` rows whose `price.fetched_at` is outside the price TTL, batches them at
the measured size, and for each result: writes `price` unconditionally (so `fetched_at`
advances), and appends a `price_history` row only when `currency`, `initial_minor`,
`final_minor` or `discount_percent` actually changed. `price_history` has no foreign key by
deliberate design — it must outlive the `game` rows it describes.

It takes `pg_try_advisory_lock(4801002)` and the same budget flags.

## 6. Testing

**Unit, against committed fixtures** — captured live during implementation, one file per
shape: a free game (`data: []`), a discounted game, `success: false`, a game with `movies`,
a non-game `type`, an app with no `price_overview`. Parser tests assert the mapping to
column values, not merely that parsing succeeds.

**Database integration**, under the existing `vitest.db.config.ts`: queue ordering (games
before DLC, recent before old), backoff arithmetic and the `unavailable` path, rollback when
a write inside the per-app transaction fails, `price_history` appended only on change, and
the advisory lock making a second worker exit.

**Live spot checks**, recorded in the pull request: `--appid=` against three real apps
covering a priced game, a free game, and a delisted appid, with the resulting rows shown.

## 7. Out of scope

Deferred deliberately, not forgotten: browse and detail UI (M4, M5), review summaries in
bulk, `pg_trgm` fuzzy search, a Vercel cron schedule (the entry points accept a budget;
wiring the schedule is a deploy concern), and any rehydration policy beyond the TTLs in §4.3.

## 8. To verify during implementation

Nothing in this list is currently known. Each must be observed live, in-session, before the
code that depends on it is written, and the observation recorded in the pull request.

1. **`appdetails` payload shapes.** Capture the fixtures in §6 before writing the parsers.
   Field presence varies by app type, country and release state.
2. **The storefront rate-limit ceiling.** A bounded probe: ramp the request rate against
   `appdetails`, stop at the first 429, record where it appeared. Pin the default to roughly
   60–70% of that. Do not state a ceiling anywhere in code or docs without this observation.
3. **The `filters=price_overview` batch maximum.** Three appids are known to work. Find where
   it stops working and pin the batch size below it.
4. **Advisory locks over the Neon pooler.** The jobs default to `DATABASE_URL_UNPOOLED`
   because a session-level advisory lock may not survive across statements on a pooled
   connection. Confirm the actual behaviour rather than assuming pooler semantics; if the
   pooled endpoint holds the lock correctly, the direct connection is still the right choice
   for a long-running job, but the reason changes.
5. **`price_change_number` semantics.** Whether it is comparable across syncs, and therefore
   usable to skip apps in `refresh:prices`. Store it either way; use it only once confirmed.

The environment documentation changes with item 4: `DATABASE_URL_UNPOOLED` is described in
CLAUDE.md as "direct connection, migrations only" and becomes "migrations and one-off jobs".

## 9. Definition of done

The code is written; `pnpm build`, `pnpm lint` and `pnpm typecheck` pass with output shown;
unit and database-integration tests pass with output shown; the live spot checks in §6 have
been run and their rows shown; every item in §8 is either observed and recorded or explicitly
listed as still unverified; and the pull request states plainly which parts were verified and
which were not.
