# Scheduled price refresh — Design

Date: 2026-08-31
Status: implemented and merged (PR #28, 2026-08-31). §2a and §7 record post-merge measurements.

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

Zero written across 300 requested appids, for the reason set out in §4. Dividing the 3.4s wall
clock by 3 batches gives ~1.13s, but that wall clock also includes process start, `.env.local`
load, pool connect, and the advisory-lock round trip — none of which repeats per batch. So
~1.13s is an **upper bound on steady-state per-batch cost**, not the per-batch cost itself; a
batch that writes 100 rows costs more on top of that, and that figure has **not** been
measured.

Counts behind the sweep size:

```
game where is_free = false                                  13,515
  … with no price row for cc=cz                              3,611
  … with a price row older than TTL_MS.price (6h)            1,868
```

### 2a. The write path, measured from Actions (2026-08-31, post-merge)

The figures above are all from the no-write path. The write path was first executed on
2026-08-31 by dispatched run
[33404206467](https://github.com/JimBimCZ/games-db/actions/runs/33404206467), from a
GitHub-hosted runner against production:

```
refreshed 919 prices (41 changed) across 45 batches in 289.6s
```

Reconciled against the database, which is what makes this evidence rather than a log line:

```
price rows          9,905 → 9,935      max(fetched_at) 13:42:08 → 14:47:38 (the run's own stamp)
price_history       9,922 → 9,963      +41, exactly the run's reported `changed`
fetched_at within 15 min of the run     919, exactly the run's reported `written`
non-free games with no price row  3,611 → 3,581
```

Two things follow. First, the never-priceable tail of §4 is not inert: 30 of those appids
gained a price row, so Steam does eventually price some of them and the tail shrinks slowly on
its own. Second, and load-bearing for §3's bound:

```
no-write batch    ~0.93s   (from the 3-batch run above, 2.8s from Actions)
writing batch     ~32s     ((289.6s − 37×0.93s) / 8 batches) ≈ 320ms per appid
```

~320ms per appid is the cost of `applyPriceBatch` opening **one transaction per appid**
(`server/catalogue/prices.ts`) across an Azure-runner-to-Neon round trip. Projecting a full
sweep — 136 batches, ~37 empty then ~99 writing — gives **~53 minutes**.

That projection is why `--max-duration=1500` exists. Without it the monthly run would exceed
`timeout-minutes: 30`, be killed by GitHub, and be marked **failed every month**, turning the
one failure signal this design has into noise. With it, a monthly run completes green after
~25 minutes having refreshed roughly 45-47 batches, about 4,700 of the 9,935 priced rows.

**So "monthly refresh" currently means each individual price is refreshed every two to three
months**, not every month. Ordering is `fetched_at asc`, so the coverage rotates and nothing
starves, but the honest description is the one above. The single change that would make the
cadence mean what it says is folding a batch's 100 upserts into one transaction instead of
100; that is application code and out of scope here.

Still unmeasured: the sweep has never actually run to the `--max-duration` bound, so the clean
green exit at 1500s is projected from the numbers above rather than observed.

## 3. The workflow

New file `.github/workflows/refresh-prices.yml`. Runner setup mirrors `ci.yml` exactly:
`actions/checkout@v4`, `pnpm/action-setup@v4`, `actions/setup-node@v4` at node 24 with pnpm
cache, then `pnpm install --frozen-lockfile`.

| Aspect | Decision |
|---|---|
| Schedule | `0 3 1 * *` — 03:00 UTC on the 1st |
| Manual trigger | `workflow_dispatch` with one optional `max_requests` input |
| Command | `pnpm refresh:prices --max-duration=1500` on the scheduled/unattended path (25min, under the 30min job timeout); `--max-requests` appended instead when the dispatch input is set |
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

"Prices them nowhere" is true of the tail as a set, not permanently of each member: §2a
observed 30 of these appids gaining a price row in a single run, so the tail drains slowly as
Steam prices previously-unpriced apps. It shrinks; it does not clear.

Every run therefore opens with ~37 batches that write nothing, which is exactly what the §2
probe observed. At monthly cadence this is ~31s of wasted requests twelve times a year.
**Accepted, not fixed.** Against the `--max-duration=1500` bound the scheduled path now runs
under (§3), ~31s is a rounding error in a 1500s budget, so it doesn't meaningfully compete with
genuinely stale prices for time. Were the cadence ever tightened enough, or the duration bound
ever tightened close to that ~31s, this stops being negligible and the fix is a "Steam prices
this nowhere" marker that lets `fetched_at` advance.

### Named risk: the exclude list grows unboundedly on a full sweep

`selectStalePriceAppids` excludes appids the current run has already requested by inlining
them as a literal `NOT IN (...)` list via `sql.raw` — the mechanism the in-run `seen` set
above relies on to guarantee termination, since a row with no `price` entry can't be moved out
of the window by stamping `fetched_at`. Every batch of a full sweep adds up to 100 more appids
to that list. On an unbounded run the excluded set approaches the full 13,515 non-free games,
so the query text sent and re-planned on the last iterations is on the order of ~13,400
comma-separated integers, roughly 108 KB of SQL. Every run measured to date (`--max-requests=3`
or the 45-batch null-tail workaround) has kept `opts.exclude` at ≤300 entries, so this cost has
never actually been observed, only derived from the appid count.

This is a second, independent reason the unbounded path (§3's `else` branch) is risky beyond
the request volume in §2, and a second reason that path is bounded by `--max-duration` rather
than left to run to completion. It is **not fixed here** — `server/catalogue/prices.ts` is out
of scope for this design — but it is a real cost of running the job unbounded, and worth
knowing about if a full sweep is ever slower than the request count alone would predict.

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

Four gaps are accepted and recorded rather than mitigated:

1. **A lock-contended run exits 0 having done nothing.** It logs `another refresh:prices run
   holds the lock` and reports success. A collision doesn't require a manual run at the same
   *minute* — it requires overlap with the whole duration of one of the runs. Measured (§2a),
   the monthly run holds the advisory lock until the `--max-duration=1500` bound stops it, so
   the collision window is **~25 minutes**, and would be ~53 minutes if the sweep ran to
   completion. That is the real window a manual invocation has to land in.
2. **GitHub disables scheduled workflows after 60 days of repository inactivity.** On a
   portfolio repo this will eventually happen, and the cron stops silently. This is noted in a
   comment in the workflow file so the next reader finds it; no keepalive is built.
3. **The job runs from an unmeasured network origin.** `DEFAULT_STOREFRONT_RPS = 1.2` in
   `server/steam/limiter.ts` was derived from a ramp run on the developer's home connection
   (§2 of the M3 observations doc). Steam's storefront rate limiting is IP-scoped, and
   GitHub-hosted runners execute from shared Azure IP ranges, so whether 1.2 req/s is safe from
   a runner is unobserved — exactly the situation CLAUDE.md's rule against hardcoding an
   unverified rate limit is about. If it isn't safe, the failure is at least visible:
   `steamFetchJson` retries a 429 up to three times with backoff before throwing, and
   `prices-cli.mts` sets `process.exitCode = 1` on that throw, reddening the run.
   **First observation (2026-08-31, §2a):** 45 consecutive storefront batches at the default
   1.2 req/s from a GitHub-hosted runner completed with no 429 and no retry. That is a floor,
   not a clearance — 45 requests is a fraction of a full sweep's ~136, and runner IPs vary
   between jobs, so a future run from a differently-reputed Azure address may still be limited.
4. **One failed batch aborts the entire sweep.** `refreshPrices`'s loop has no per-batch
   `catch`; a throw from `steamFetchJson` or `applyPriceBatch` propagates straight out through
   the `finally` that releases the advisory lock, up to the CLI, which exits 1. At monthly
   cadence, one transient Steam blip in batch 3 of ~136 costs the whole month's refresh, and a
   manual re-dispatch is the only recovery — there's no automatic retry of the run itself.
   Accepted as the right tradeoff for a portfolio app: a per-batch catch-and-continue would
   need its own error accounting and retry policy for a job that runs twelve times a year.

## 7. Testing

The deliverable is CI configuration, not application code, so it gets no unit test — consistent
with this repository's stance on cheap tests. `pnpm lint`, `pnpm typecheck` and `pnpm build` are
run to confirm nothing regressed, though no file they cover is touched.

Acceptance evidence, gathered after merge on 2026-08-31:

1. ✅ A `workflow_dispatch` run with `max_requests: 3`, green:
   `refreshed 0 prices (0 changed) across 3 batches in 2.8s` — zero written, exactly as §4
   predicts for the null tail. Run
   [33404114374](https://github.com/JimBimCZ/games-db/actions/runs/33404114374).
2. ✅ `select count(*), max(fetched_at) from price` before and after. The 3-batch run moved
   nothing (its 300 appids have no price row to stamp), so a 45-batch run was dispatched to
   reach past the tail; §2a records both the log line and the database reconciliation that
   prove the scheduled path wrote to production.
3. ❌ **Not gathered.** A run with no `max_requests` input — the path the monthly cron actually
   takes — has never been dispatched. §2a projects its behaviour from the 45-batch measurement
   rather than observing it. The first monthly fire on 2026-09-01 is the next opportunity.

None of these could be produced before the workflow was on the default branch, since `schedule`
and `workflow_dispatch` only run from there.
