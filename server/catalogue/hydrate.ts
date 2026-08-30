import 'server-only'
import { getJobDb } from '../../db/client.ts'
import { fetchAppDetails } from '../steam/app-details.ts'
import { SteamParseError } from '../steam/schemas.ts'
import { serverEnv } from '../env.ts'
import {
  HYDRATE_LOCK_KEY,
  markFailed,
  markOk,
  markUnavailable,
  releaseAdvisoryLock,
  selectDueApps,
  tryAdvisoryLock,
} from './queue.ts'
import { writeHydratedApp } from './hydrate-write.ts'

export type HydrateCounts = {
  attempted: number
  ok: number
  unavailable: number
  failed: number
  parseFailures: number
}

export type HydrateOptions = {
  maxRequests?: number
  maxDurationMs?: number
  appid?: number
  type?: 'game' | 'dlc'
  batchSize?: number
}

const DEFAULT_BATCH_SIZE = 200

// A single odd app is normal; a stream of parse failures means Valve changed the payload and
// the worker is writing nothing useful. Aborting in minutes beats marching through 183,000
// appids with a broken parser.
const PARSE_FAILURE_ABORT_COUNT = 25
const PARSE_FAILURE_ABORT_RATIO = 0.1

export async function hydrate(opts: HydrateOptions = {}): Promise<HydrateCounts> {
  const db = getJobDb()
  const { steamCountryCode: cc, steamLanguage: l } = serverEnv()
  const counts: HydrateCounts = { attempted: 0, ok: 0, unavailable: 0, failed: 0, parseFailures: 0 }

  if (!(await tryAdvisoryLock(db, HYDRATE_LOCK_KEY))) {
    console.log('another hydrate run holds the lock; exiting')
    return counts
  }

  const startedAt = Date.now()
  const budgetSpent = () =>
    (opts.maxRequests !== undefined && counts.attempted >= opts.maxRequests) ||
    (opts.maxDurationMs !== undefined && Date.now() - startedAt >= opts.maxDurationMs)

  let stopping = false
  const onSignal = () => {
    console.log('signal received; finishing the current app then exiting')
    stopping = true
  }
  process.on('SIGINT', onSignal)
  process.on('SIGTERM', onSignal)

  try {
    for (;;) {
      if (stopping || budgetSpent()) break

      const appids =
        opts.appid !== undefined
          ? [opts.appid]
          : await selectDueApps(db, { limit: opts.batchSize ?? DEFAULT_BATCH_SIZE, type: opts.type })

      if (appids.length === 0) break

      for (const appid of appids) {
        if (stopping || budgetSpent()) break
        counts.attempted += 1

        try {
          const result = await fetchAppDetails(appid, cc, l)
          if (result.kind === 'unavailable') {
            await markUnavailable(db, appid)
            counts.unavailable += 1
          } else {
            await writeHydratedApp(db, result.data, cc, new Date())
            await markOk(db, appid)
            counts.ok += 1
          }
        } catch (err) {
          await markFailed(db, appid)
          counts.failed += 1
          if (err instanceof SteamParseError) {
            counts.parseFailures += 1
            console.error(`parse failure for appid ${appid}:`, err.issues)
            if (
              counts.parseFailures >= PARSE_FAILURE_ABORT_COUNT &&
              counts.parseFailures / counts.attempted >= PARSE_FAILURE_ABORT_RATIO
            ) {
              throw new Error(
                `aborting: ${counts.parseFailures} parse failures in ${counts.attempted} attempts — the appdetails payload shape has probably changed`,
              )
            }
          } else {
            console.error(`hydration failed for appid ${appid}:`, err)
          }
        }
      }

      if (opts.appid !== undefined) break
      console.log(
        `hydrate: attempted=${counts.attempted} ok=${counts.ok} unavailable=${counts.unavailable} failed=${counts.failed}`,
      )
    }
  } finally {
    process.off('SIGINT', onSignal)
    process.off('SIGTERM', onSignal)
    await releaseAdvisoryLock(db, HYDRATE_LOCK_KEY)
  }

  return counts
}
