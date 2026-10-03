// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({ fetch: vi.fn() }))
vi.mock('electron', () => ({ net: { fetch: electron.fetch } }))

import { StandingsService } from '../../src/main/standings-service'

const BASE = 'https://api.jolpi.ca/ergast/f1'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

const schedule = (
  rounds: Array<{ round: number; date: string; name?: string; sprint?: boolean }>
) => ({
  MRData: {
    RaceTable: {
      Races: rounds.map((r) => ({
        round: String(r.round),
        raceName: r.name ?? `GP ${r.round}`,
        date: r.date,
        Circuit: { circuitId: `c${r.round}` },
        ...(r.sprint ? { Sprint: { date: r.date } } : {})
      }))
    }
  }
})

const drivers = (rows: Array<[string, number, number]>) => ({
  MRData: {
    StandingsTable: {
      StandingsLists: [
        {
          DriverStandings: rows.map(([family, points, wins], i) => ({
            position: String(i + 1),
            points: String(points),
            wins: String(wins),
            Driver: { driverId: family.toLowerCase(), familyName: family, givenName: 'X', code: family.slice(0, 3).toUpperCase(), permanentNumber: String(i + 1) },
            Constructors: [{ name: 'Old Team' }, { name: `${family} Racing` }]
          }))
        }
      ]
    }
  }
})

const constructors = (rows: Array<[string, number]>) => ({
  MRData: {
    StandingsTable: {
      StandingsLists: [
        {
          ConstructorStandings: rows.map(([name, points], i) => ({
            position: String(i + 1),
            points: String(points),
            wins: '0',
            Constructor: { constructorId: name.toLowerCase(), name }
          }))
        }
      ]
    }
  }
})

const SEASON = schedule([
  { round: 1, date: '2026-03-08', name: 'Australian Grand Prix' },
  { round: 2, date: '2026-03-15', name: 'Chinese Grand Prix', sprint: true },
  { round: 3, date: '2026-03-29', name: 'Japanese Grand Prix' },
  { round: 4, date: '2026-04-12', name: 'Bahrain Grand Prix', sprint: true }
])

/** Serve schedule + standings for any round; record which URLs were requested. */
function serve(overrides: Record<string, () => Response> = {}): void {
  electron.fetch.mockImplementation(async (url: string) => {
    for (const [frag, h] of Object.entries(overrides)) if (url.includes(frag)) return h()
    if (url.includes('/races/')) return json(SEASON)
    if (url.includes('driverstandings')) return json(drivers([['Norris', 100, 2], ['Piastri', 80, 1]]))
    if (url.includes('constructorstandings')) return json(constructors([['McLaren', 180]]))
    return new Response('', { status: 404 })
  })
}
const urls = (): string[] => electron.fetch.mock.calls.map((c) => c[0] as string)

beforeEach(() => {
  electron.fetch.mockReset()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-06-01T00:00:00Z'))
})
afterEach(() => {
  vi.useRealTimers()
})

describe('StandingsService.getChampionship request validation', () => {
  it.each([
    ['null', null],
    ['a string', '2026'],
    ['an array', [2026]],
    ['a missing year', {}],
    ['a string year', { year: '2026' }],
    ['NaN', { year: Number.NaN }],
    ['Infinity', { year: Number.POSITIVE_INFINITY }],
    ['a year before 1950', { year: 1949 }],
    ['a year after 2100', { year: 2101 }]
  ])('rejects %s without touching the network', async (_label, req) => {
    const res = await new StandingsService().getChampionship(req)
    expect(res).toEqual({ ok: false, error: 'Invalid standings request.', championship: null })
    expect(electron.fetch).not.toHaveBeenCalled()
  })

  it('truncates a fractional year', async () => {
    serve()
    const res = await new StandingsService().getChampionship({ year: 2026.9, sessionDate: '2026-03-08' })
    expect(res.ok).toBe(true)
    expect(res.championship?.year).toBe(2026)
    expect(urls()[0]).toBe(`${BASE}/2026/races/?limit=100`)
  })
})

describe('StandingsService.getChampionship baseline resolution', () => {
  it('uses the standings after the round BEFORE the session, and counts remaining rounds/sprints', async () => {
    serve()
    const res = await new StandingsService().getChampionship({ year: 2026, sessionDate: '2026-03-29T05:00:00Z' })
    expect(res.ok).toBe(true)
    const c = res.championship!
    expect(c).toMatchObject({
      year: 2026,
      round: 3,
      roundResolved: true,
      raceName: 'Japanese Grand Prix',
      totalRounds: 4,
      remainingRounds: 1,
      remainingSprints: 1
    })
    expect(c.driverStandings.map((d) => [d.familyName, d.points, d.constructorName])).toEqual([
      ['Norris', 100, 'Norris Racing'], // last constructor wins (mid-season team switch)
      ['Piastri', 80, 'Piastri Racing']
    ])
    expect(c.constructorStandings).toEqual([
      { constructorId: 'mclaren', name: 'McLaren', position: 1, points: 180, wins: 0 }
    ])
    expect(urls()).toContain(`${BASE}/2026/2/driverstandings/?limit=100`)
    expect(urls()).toContain(`${BASE}/2026/2/constructorstandings/?limit=100`)
  })

  it('has an empty baseline for round 1 and fetches no standings', async () => {
    serve()
    const res = await new StandingsService().getChampionship({ year: 2026, sessionDate: '2026-03-08' })
    expect(res.championship).toMatchObject({ round: 1, driverStandings: [], constructorStandings: [], remainingRounds: 3, remainingSprints: 2 })
    expect(urls().filter((u) => u.includes('standings'))).toEqual([])
  })

  it('falls back to the latest standings when the session date cannot be resolved', async () => {
    serve()
    const res = await new StandingsService().getChampionship({ year: 2026, sessionDate: 'garbage' })
    const c = res.championship!
    expect(c).toMatchObject({ round: null, roundResolved: false, raceName: null, remainingRounds: 0, remainingSprints: 0 })
    expect(c.driverStandings).toHaveLength(2)
    expect(urls()).toContain(`${BASE}/2026/driverstandings/?limit=100`)
  })

  it('resolves an off-weekend session to the most recent earlier round', async () => {
    serve()
    const res = await new StandingsService().getChampionship({ year: 2026, sessionDate: '2026-04-01' })
    expect(res.championship?.round).toBe(3)
  })

  it('treats a session before the season as unresolved', async () => {
    serve()
    const res = await new StandingsService().getChampionship({ year: 2026, sessionDate: '2026-01-01' })
    expect(res.championship?.roundResolved).toBe(false)
  })

  it('degrades to an empty schedule when the upstream schedule JSON has an unexpected shape', async () => {
    serve({ '/races/': () => json({ MRData: 'nope' }) })
    const res = await new StandingsService().getChampionship({ year: 2026, sessionDate: '2026-03-08' })
    expect(res.ok).toBe(true)
    expect(res.championship).toMatchObject({ totalRounds: 0, round: null, roundResolved: false })
  })

  it('drops standings rows with missing names instead of failing', async () => {
    serve({
      driverstandings: () =>
        json({ MRData: { StandingsTable: { StandingsLists: [{ DriverStandings: [{ Driver: {} }, null, { Driver: { familyName: 'Ok' }, points: 'abc' }] }] } } })
    })
    const res = await new StandingsService().getChampionship({ year: 2026, sessionDate: '2026-03-29' })
    expect(res.championship?.driverStandings).toEqual([
      expect.objectContaining({ familyName: 'Ok', points: 0, position: 1, permanentNumber: null })
    ])
  })
})

describe('StandingsService.getChampionship errors', () => {
  it('maps a non-2xx schedule response to an error result', async () => {
    serve({ '/races/': () => new Response('', { status: 503 }) })
    const res = await new StandingsService().getChampionship({ year: 2026, sessionDate: '2026-03-08' })
    expect(res).toEqual({ ok: false, error: 'Jolpica request failed (503).', championship: null })
  })

  it('maps a non-2xx standings response to an error result', async () => {
    serve({ driverstandings: () => new Response('', { status: 429 }) })
    const res = await new StandingsService().getChampionship({ year: 2026, sessionDate: '2026-03-29' })
    expect(res.ok).toBe(false)
    expect(res.error).toBe('Jolpica request failed (429).')
  })

  it('maps malformed JSON to an error result', async () => {
    serve({ '/races/': () => new Response('<html>oops', { status: 200 }) })
    const res = await new StandingsService().getChampionship({ year: 2026, sessionDate: '2026-03-08' })
    expect(res.ok).toBe(false)
    expect(res.championship).toBeNull()
    expect(res.error).toBeTruthy()
  })

  it('uses a generic message when the failure carries none', async () => {
    electron.fetch.mockRejectedValue({})
    const res = await new StandingsService().getChampionship({ year: 2026 })
    expect(res.error).toBe('Standings request failed.')
  })

  it('times out after 15s with a readable message', async () => {
    electron.fetch.mockImplementation(
      (_u: string, init: { signal: AbortSignal }) =>
        new Promise((_res, reject) => {
          init.signal.addEventListener('abort', () => {
            const e = new Error('aborted')
            e.name = 'AbortError'
            reject(e)
          })
        })
    )
    const p = new StandingsService().getChampionship({ year: 2026 })
    await vi.advanceTimersByTimeAsync(14_999)
    let settled = false
    void p.then(() => (settled = true))
    await vi.advanceTimersByTimeAsync(0)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await p).toEqual({ ok: false, error: 'Standings request timed out after 15s.', championship: null })
  })
})

describe('StandingsService cache', () => {
  it('serves a repeat request from cache within 30 minutes, keyed by year and session date', async () => {
    serve()
    const svc = new StandingsService()
    const req = { year: 2026, sessionDate: '2026-03-29' }
    const first = await svc.getChampionship(req)
    const calls = electron.fetch.mock.calls.length
    vi.setSystemTime(Date.now() + 29 * 60 * 1000)
    const second = await svc.getChampionship(req)
    expect(second).toBe(first)
    expect(electron.fetch).toHaveBeenCalledTimes(calls)

    // A different session date is a different key and hits the network again.
    await svc.getChampionship({ year: 2026, sessionDate: '2026-03-15' })
    expect(electron.fetch.mock.calls.length).toBeGreaterThan(calls)
  })

  it('refetches once the 30-minute TTL has elapsed', async () => {
    serve()
    const svc = new StandingsService()
    const req = { year: 2026, sessionDate: '2026-03-29' }
    await svc.getChampionship(req)
    const calls = electron.fetch.mock.calls.length
    vi.setSystemTime(Date.now() + 30 * 60 * 1000 + 1)
    await svc.getChampionship(req)
    expect(electron.fetch.mock.calls.length).toBe(calls * 2)
  })

  it('does not cache failures, so a retry can succeed', async () => {
    serve({ '/races/': () => new Response('', { status: 500 }) })
    const svc = new StandingsService()
    const req = { year: 2026, sessionDate: '2026-03-08' }
    expect((await svc.getChampionship(req)).ok).toBe(false)
    serve()
    const retry = await svc.getChampionship(req)
    expect(retry.ok).toBe(true)
  })

  it('normalizes missing and null sessionDate to the same cache entry, and truncates long dates', async () => {
    serve()
    const svc = new StandingsService()
    await svc.getChampionship({ year: 2026 })
    const calls = electron.fetch.mock.calls.length
    await svc.getChampionship({ year: 2026, sessionDate: null })
    await svc.getChampionship({ year: 2026, sessionDate: 42 })
    expect(electron.fetch).toHaveBeenCalledTimes(calls)
  })

  it('keeps separate caches per service instance', async () => {
    serve()
    await new StandingsService().getChampionship({ year: 2026 })
    const calls = electron.fetch.mock.calls.length
    await new StandingsService().getChampionship({ year: 2026 })
    expect(electron.fetch.mock.calls.length).toBe(calls * 2)
  })
})
