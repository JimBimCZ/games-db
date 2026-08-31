# Scheduled price refresh — Design

Date: 2026-08-31
Status: approved for implementation planning

M1–M6 are merged and the app is deployed, but nothing keeps its data current. `vercel.json`
carries no `crons`, CI runs only lint/typecheck/test/build, and every catalogue job is a
manual CLI invocation. Counted live against Neon on 2026-08-31:

```
game 14,621 (fetched_at 2026-08-30 11:14 → 2026-08-31 13:42)
price 9,905 · price_history 9,922
steam_list  4 kinds × 100, all fetched 2026-08-30 13:00  (~25h old)
review_summary 8 · library_entry 0
```

This design automates one job — `refresh:prices` — on a monthly schedule. Nothing else.

## 1. Scope and the cadence decision

**In scope:** a scheduled GitHub Actions workflow that runs the existing `pnpm refresh:prices`
CLI once a month against the production database.

**Explicitly out of scope**, each for a stated reason:

- `sync:lists`, `hydrate`, `sync:catalogue` on a schedule. Ranked lists move slowly enough that
  a manual run is tolerable, and hydration was deliberately stopped at 14,621 games.
- The never-priceable tail (§4). Worth fixing at a 6-hourly cadence; not worth a schema or
  query change twelve times a year.
- Notification wiring beyond GitHub's own failed-run email.

**Cadence: monthly**, not the 6 hours that `TTL_MS.price` implies. This is a portfolio app; no
one is consulting it for a live discount.

The consequence is accepted rather than hidden, and it is larger than it first appears.
`TTL_MS.price` has exactly one consumer — `selectStalePriceAppids` in this job. The read path
does not use it: `server/detail/queries.ts` reads `price` through a plain `leftJoin`, and the
`readThrough` helper in `server/steam/cache.ts` is used only by `review-summary.ts`. So **no
page anywhere refreshes a stale price on read**, and between sweeps every displayed price —
detail page, browse card, wishlist delta — is as old as the last run. At monthly cadence that
means prices up to a month stale, with no live fallback to soften it.

That is a deliberate trade for a portfolio app, not an oversight. If it ever becomes
unacceptable, the fix is a read-path `readThrough` on price for the single opened game, not a
tighter sweep.

## 2. Observed behaviour of the existing job

Measured on 2026-08-31 in this repository, not quoted from memory.

`pnpm refresh:prices --max-requests=3` against the live database and storefront:

```
refreshed 0 prices (0 changed) across 3 batches in 3.4s
```

Zero written across 300 requested appids, for the reason set out in §4. Per-batch cost is
therefore ~1.13s of storefront requests with no write load; a batch that writes 100 rows costs
more, and that figure has **not** been measured.

Counts behind the sweep size:

```
game where is_free = false                                  13,515
  … with no price row for cc=cz                              3,611
  … with a price row older than TTL_MS.price (6h)            1,868
```

## 3. The workflow

New file `.github/workflows/refresh-prices.yml`. Runner setup mirrors `ci.yml` exactly:
`actions/checkout@v4`, `pnpm/action-setup@v4`, `actions/setup-node@v4` at node 24 with pnpm
cache, then `pnpm install --frozen-lockfile`.

| Aspect | Decision |
|---|---|
| Schedule | `0 3 1 * *` — 03:00 UTC on the 1st |
| Manual trigger | `workflow_dispatch` with one optional `max_requests` input |
| Command | `pnpm refresh:prices`, unbounded, with `--max-requests` appended only when the dispatch input is set |
| Runaway guard | `timeout-minutes: 30` |
| Overlap guard | a `concurrency` group, over the top of advisory lock `4801002` |

The `max_requests` input exists so the workflow can be proven end to end with a three-batch run
instead of waiting for the 1st of a month. It is the verification mechanism of §6, not a
feature.

No application code changes. The scheduled run executes the same entry point
(`server/catalogue/prices-cli.mts`) as a manual run — there is no second code path to keep in
step, which is the main reason this design chose Actions over a Vercel cron route (§5).

## 4. Why the sweep starts with 3,611 guaranteed-empty requests

`selectStalePriceAppids` orders `p.fetched_at asc nulls first`. 3,611 non-free games have no
`price` row at all — Steam prices them nowhere, the case the code already documents against
appid 271590 — and because no row exists, a completed run cannot stamp `fetched_at` to move
them out of the window. Only the in-run `seen` set makes the loop terminate.

Every run therefore opens with ~37 batches that write nothing, which is exactly what the §2
probe observed. At monthly cadence this is ~31s of wasted requests twelve times a year, and the
run is unbounded, so it still reaches every genuinely stale price. **Accepted, not fixed.** Were
the cadence ever tightened, or the run ever time-boxed, this becomes a real defect and the fix
is a "Steam prices this nowhere" marker that lets `fetched_at` advance.

## 5. Configuration and secrets

One new repository secret: **`DATABASE_URL_UNPOOLED`**, the Neon direct connection string.
`prices-cli.mts` copies it into `DATABASE_URL` itself; the pooled endpoint grants the same
advisory lock to two clients and so excludes nobody (M3 observations §4).

`STEAM_API_KEY` is **not** required. `server/steam/client.ts::steamFetchJson` sends no key, and
the storefront `appdetails` endpoint the price job calls is keyless; only `sync:catalogue`'s
`IStoreService/GetAppList` needs one. `STEAM_COUNTRY_CODE` and `STEAM_LANGUAGE` are left unset
so they fall through to the `cz`/`english` defaults in `server/env.ts`, which is what the
deployed site uses.

`resolveDriver` returns `node-postgres` here because `VERCEL` is unset on a GitHub runner, so
`getJobDb()`'s driver check passes and transactions work with no override.

The workflow must not `echo` its environment or run under `set -x`.

### Rejected alternative: Vercel cron

A `crons` entry plus an `/api/cron/prices` route guarded by `CRON_SECRET` would keep everything
on one platform, at the cost of a second entry point wrapping `refreshPrices`, a
`DB_DRIVER=node-postgres` override to defeat `resolveDriver`'s `VERCEL` branch, `node-postgres`
connecting from a serverless invocation, and a `maxDuration` that must cover the whole sweep or
cut it mid-batch. Three new failure modes for a job that runs twelve times a year. Vercel's
per-plan limits on cron frequency were **not** verified for this design; a monthly schedule may
or may not be accepted on the current plan, and the chosen approach makes the question moot.

## 6. Failure handling and its known gaps

Handled by the existing job, with no new code: `refreshPrices` exits quietly when the advisory
lock is held, and `prices-cli.mts` sets `process.exitCode = 1` on a throw, reddening the run and
triggering GitHub's default email for a failed scheduled workflow.

Two gaps are accepted and recorded rather than mitigated:

1. **A lock-contended run exits 0 having done nothing.** It logs `another refresh:prices run
   holds the lock` and reports success. At monthly cadence a collision requires a manual run at
   the same minute.
2. **GitHub disables scheduled workflows after 60 days of repository inactivity.** On a
   portfolio repo this will eventually happen, and the cron stops silently. This is noted in a
   comment in the workflow file so the next reader finds it; no keepalive is built.

## 7. Testing

The deliverable is CI configuration, not application code, so it gets no unit test — consistent
with this repository's stance on cheap tests. `pnpm lint`, `pnpm typecheck` and `pnpm build` are
run to confirm nothing regressed, though no file they cover is touched.

Acceptance evidence, gathered after merge:

1. A `workflow_dispatch` run with `max_requests: 3`, green, with its log pasted.
2. `select count(*), max(fetched_at) from price` before and after that run, showing the
   scheduled path wrote to the real database.

Neither can be produced before the workflow is on the default branch, since `schedule` and
`workflow_dispatch` only run from there.
