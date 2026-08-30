import { afterEach, describe, expect, it, vi } from 'vitest'
import { SteamHttpError, steamFetchJson } from '@/server/steam/client'
import { resetLimitersForTest } from '@/server/steam/limiter'

const url = new URL('https://api.steampowered.com/IStoreService/GetAppList/v1/')

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  resetLimitersForTest()
})

function respond(
  status: number,
  body: string,
  contentType = 'application/json',
  extraHeaders: Record<string, string> = {},
) {
  return new Response(body, { status, headers: { 'content-type': contentType, ...extraHeaders } })
}

describe('steamFetchJson', () => {
  it('returns parsed JSON on success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respond(200, '{"response":{"apps":[]}}')))
    expect(await steamFetchJson(url)).toEqual({ response: { apps: [] } })
  })

  it('reports the status rather than a JSON syntax error when the body is HTML', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      respond(403, '<html><head><title>Forbidden</title></head></html>', 'text/html'),
    ))
    const err: unknown = await steamFetchJson(url, { retries: 0 }).catch((e) => e)
    expect(err).toBeInstanceOf(SteamHttpError)
    expect((err as SteamHttpError).status).toBe(403)
    expect((err as SteamHttpError).message).toContain('403')
  })

  it('does not retry a 403', async () => {
    const spy = vi.fn(async () => respond(403, '<html></html>', 'text/html'))
    vi.stubGlobal('fetch', spy)
    await steamFetchJson(url, { retries: 3, backoffMs: 1 }).catch(() => {})
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('retries a 429 and succeeds', async () => {
    const spy = vi
      .fn()
      .mockResolvedValueOnce(respond(429, 'slow down', 'text/plain'))
      .mockResolvedValueOnce(respond(200, '{"ok":true}'))
    vi.stubGlobal('fetch', spy)
    expect(await steamFetchJson(url, { retries: 2, backoffMs: 1 })).toEqual({ ok: true })
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('gives up after the retry budget and reports the last status', async () => {
    const spy = vi.fn(async () => respond(500, 'boom', 'text/plain'))
    vi.stubGlobal('fetch', spy)
    const err: unknown = await steamFetchJson(url, { retries: 2, backoffMs: 1 }).catch((e) => e)
    expect(err).toBeInstanceOf(SteamHttpError)
    expect((err as SteamHttpError).status).toBe(500)
    expect(spy).toHaveBeenCalledTimes(3)
  })

  it('rejects a 200 whose body is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respond(200, 'not json', 'text/plain')))
    await expect(steamFetchJson(url, { retries: 0 })).rejects.toThrow(/not valid JSON/i)
  })

  it('rejects a negative retry budget immediately', async () => {
    await expect(steamFetchJson(url, { retries: -1 })).rejects.toThrow(
      /retries must be non-negative/,
    )
  })

  // Stubs setTimeout to fire immediately and records the requested delay, so the wait
  // itself never actually elapses in the test. Date.now is advanced by the same amount
  // on each fake sleep so the limiter's own setTimeout-based spacing (also stubbed here,
  // since it shares the same global) sees time pass the way it would for a real delay,
  // instead of computing a second bogus wait against a clock that never moved.
  function recordSleeps(): number[] {
    const delays: number[] = []
    let clock = Date.now()
    vi.spyOn(Date, 'now').mockImplementation(() => clock)
    vi.stubGlobal('setTimeout', ((fn: () => void, ms: number) => {
      delays.push(ms)
      clock += ms
      fn()
      return 0 as unknown as ReturnType<typeof setTimeout>
    }) as typeof setTimeout)
    return delays
  }

  it('honours Retry-After', async () => {
    const spy = vi
      .fn()
      .mockResolvedValueOnce(respond(429, 'slow down', 'text/plain', { 'retry-after': '2' }))
      .mockResolvedValueOnce(respond(200, '{"ok":true}'))
    vi.stubGlobal('fetch', spy)
    const delays = recordSleeps()

    expect(await steamFetchJson(url, { retries: 1, backoffMs: 1 })).toEqual({ ok: true })

    expect(delays).toEqual([2000])
  })

  it('caps an absurd Retry-After instead of obeying it', async () => {
    const spy = vi
      .fn()
      .mockResolvedValueOnce(respond(429, 'slow down', 'text/plain', { 'retry-after': '86400' }))
      .mockResolvedValueOnce(respond(200, '{"ok":true}'))
    vi.stubGlobal('fetch', spy)
    const delays = recordSleeps()

    expect(await steamFetchJson(url, { retries: 1, backoffMs: 1 })).toEqual({ ok: true })

    expect(delays).toEqual([60_000])
  })

  it('waits for the limiter before each storefront request', async () => {
    const timestamps: number[] = []
    vi.stubEnv('STEAM_STOREFRONT_RPS', '50')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        timestamps.push(Date.now())
        return new Response('{"ok":true}', { status: 200 })
      }),
    )

    const storefrontUrl = new URL('https://store.steampowered.com/api/appdetails?appids=620')
    await steamFetchJson(storefrontUrl)
    await steamFetchJson(storefrontUrl)

    expect(timestamps).toHaveLength(2)
    expect(timestamps[1]! - timestamps[0]!).toBeGreaterThanOrEqual(15)
  })

  it('aborts a request that exceeds the timeout', async () => {
    vi.stubEnv('STEAM_STOREFRONT_RPS', '100')
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: URL, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        }),
      ),
    )

    await expect(
      steamFetchJson(new URL('https://store.steampowered.com/api/appdetails?appids=620'), {
        retries: 0,
        timeoutMs: 30,
      }),
    ).rejects.toThrow()
  })
})
