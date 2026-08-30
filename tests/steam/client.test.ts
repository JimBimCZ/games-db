import { afterEach, describe, expect, it, vi } from 'vitest'
import { SteamHttpError, steamFetchJson } from '@/server/steam/client'

const url = new URL('https://api.steampowered.com/IStoreService/GetAppList/v1/')

afterEach(() => vi.unstubAllGlobals())

function respond(status: number, body: string, contentType = 'application/json') {
  return new Response(body, { status, headers: { 'content-type': contentType } })
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
    vi.stubGlobal('fetch', vi.fn(async () => respond(500, 'boom', 'text/plain')))
    const err: unknown = await steamFetchJson(url, { retries: 2, backoffMs: 1 }).catch((e) => e)
    expect(err).toBeInstanceOf(SteamHttpError)
    expect((err as SteamHttpError).status).toBe(500)
  })

  it('rejects a 200 whose body is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respond(200, 'not json', 'text/plain')))
    await expect(steamFetchJson(url, { retries: 0 })).rejects.toThrow(/not valid JSON/i)
  })
})
