# M2 — Catalogue sync design

Parent spec: `docs/superpowers/specs/2026-08-29-games-db-design.md` (§4 M2).
This document supersedes that spec's statement that `IStoreService/GetAppList` is
unverified. Everything in §1 was observed live on 2026-08-30 with a real
`STEAM_API_KEY`.

## 1. Verified endpoint behaviour

```
GET https://api.steampowered.com/IStoreService/GetAppList/v1/?key=<key>
```

Response:

```json
{ "response": {
    "apps": [ { "appid": 10, "name": "Counter-Strike",
                "last_modified": 1745368572, "price_change_number": 37149137 } ],
    "have_more_results": true,
    "last_appid": 508530 } }
```

| Property | Observed |
|---|---|
| Without a key | HTTP 403, body is **HTML**, not JSON |
| Success header | `x-eresult: 1` |
| Page size | default 10000, hard cap 50000 (`max_results=100000` returns 50000) |
| Cursor | `last_appid`, **exclusive** — `last_appid=508530` returns 508540 first |
| Terminal page | `have_more_results` absent, `last_appid` **undefined** |
| Type filters | `include_games`, `include_dlc`, `include_software`, `include_videos`, `include_hardware`, all server-side |
| Incremental | `if_modified_since=<unix seconds>` filters genuinely: 1000 rows returned, 0 older than a 24h cutoff |

Catalogue size, walked at 50000 per page:

| Pass | Appids | Requests |
|---|---|---|
| `include_games=true` | 183101 | 4 |
| `include_dlc=true, include_games=false` | 61890 | 2 |
| Overlap between the two | **0** | — |
| Combined distinct | 244991 | 6 requests, 17.8s |

### Sharp edges

- **Terminate on `have_more_results`, never on `last_appid`.** The final page omits
  the cursor, so a loop keyed on it either crashes or restarts from the beginning.
- **The cursor is exclusive.** Passing the previous page's `last_appid` verbatim is
  correct; do not decrement or add one.
- **`include_games=false` with no other include flag does not return nothing.** It
  returns low appids such as `{"appid":1,"name":"Action"}`. Always pass the include
  flags explicitly rather than relying on a default.
- **A 403 body is HTML.** Parsing the response as JSON before checking status throws
  a syntax error that masks the real cause.
- **The list is live.** `include_games` returned 183100 and then 183101 within the
  same hour. No test may assert an exact catalogue count.

### Rate limiting

This is `api.steampowered.com`, not the storefront host. The full catalogue is 6
requests. The storefront API's ~200-requests-per-5-minutes limit does not apply
here, and CLAUDE.md's instruction to walk this list "respecting a conservative
self-imposed rate limit with backoff on 429" describes the wrong endpoint. The
bottleneck for this job is the 244991-row upsert into Neon, not Steam.

No 429 was observed at ~1 request per 1.2s. The client still implements backoff,
because an unobserved limit is not an absent one.

## 2. Design

### Components

| Module | Responsibility |
|---|---|
| `server/steam/client.ts` | The only place that calls `fetch` against Steam. Bounded retry with exponential backoff on 429 and 5xx. Reads the body as text and parses defensively, so an HTML error body surfaces as a typed error rather than a JSON syntax error. M3 extends this with the storefront limiter and the TTL cache. |
| `server/steam/app-list.ts` | Zod schema for the page shape, plus `walkAppList(flags)` — an async generator yielding pages, terminating on `have_more_results`, treating `last_appid` as an exclusive cursor. |
| `server/catalogue/sync.ts` | Runs the games pass then the DLC pass, tagging `app_type` per pass, batching upserts. |
| `server/catalogue/cli.ts` | Entry point for `pnpm sync:catalogue`. `--since=<iso date or day count>` maps to `if_modified_since`. |

### Upsert

Chunks of ~2000 rows per statement, comfortably inside Postgres' 65535-parameter
ceiling at four columns per row. `onConflictDoUpdate` sets **only** `name`,
`app_type` and `last_seen_in_list_at`.

It must never write `hydration_state`, `failure_count` or `next_attempt_at` on an
existing row. Those belong to M3's hydration queue, and a sync that reset them would
silently re-queue the entire catalogue on every run. New rows take the column
default, `pending`.

No global transaction. The operation is idempotent and a partial run simply leaves
older `last_seen_in_list_at` values behind — which is what that column exists to
record. Wrapping 244991 rows in one transaction would hold a write lock for the
whole job to buy nothing.

### Sync modes

Full walk is the default: 6 requests and under 20 seconds of Steam time, so
correctness stays simple. `--since` exists for cheap frequent runs once the table is
warm. No stored watermark — a watermark that silently drifts skips apps, and the
full walk is too cheap to justify the risk.

### Scope

Games and DLC. Software, videos and hardware are excluded: the UI is required to keep
non-games out of browse rows, and those three are the bulk of what would be filtered
back out. DLC earns its place because a detail page can then resolve DLC names
locally instead of hydrating each one.

### M1 deferrals that come due here

Ruling R15 named M2 as the milestone for these:

- **#5a** — `db/client.ts` has no `closeDb()`, so a CLI job hangs on the open pool.
- **#5** — the runtime image copies only the standalone output, so it carries no
  `db/` or migrations and cannot run the one-off jobs CLAUDE.md requires.
- **#4a** — resolved by decision, not code: the sync is a container/CLI job on
  `node-postgres`, which has transactions. No `neon-serverless` WebSocket Pool.

### Testing

Fixtures captured from the live responses in §1, committed under
`tests/fixtures/steam/`: a full page, the terminal page, and the 403 HTML body.

- Page parser accepts a well-formed page and rejects a malformed one.
- The walk stops on the terminal page and does not dereference the missing cursor.
- The cursor is passed through exactly, not adjusted.
- A 403 HTML body produces a typed error naming the status, not a JSON syntax error.
- Database integration: an upsert over an existing row updates `name` and
  `last_seen_in_list_at` while leaving `hydration_state`, `failure_count` and
  `next_attempt_at` untouched.

No test asserts an exact catalogue count.

## 3. CLAUDE.md amendments this milestone requires

1. Replace "respecting a conservative self-imposed rate limit with backoff on 429"
   for the catalogue sync with the verified position: 6 requests, cap 50000 per page,
   cursor `last_appid`, and the note that the storefront limit is a different host.
2. Record that `IStoreService/GetAppList` request and response shapes are now
   verified, and state them.
3. Record that the catalogue sync covers games and DLC only.
