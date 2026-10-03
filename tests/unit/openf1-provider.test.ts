import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OpenF1Provider } from '../../src/renderer/core/providers/OpenF1Provider'

/**
 * OpenF1Provider tests through its public API (listSessions / loadSession /
 * getSnapshotAt / getDriverLaps), with global fetch replaced by a router that
 * serves OpenF1-shaped fixtures. Timers are faked because the provider throttles
 * its request waves with real setTimeout delays.
 */

const BASE = 'https://api.openf1.org/v1'
const START = Date.parse('2026-07-05T13:00:00Z')
const iso = (offsetSec: number): string => new Date(START + offsetSec * 1000).toISOString()

interface Route {
  status?: number
  body?: unknown
  throws?: Error
}

const RACE_SESSION = {
  session_key: 9900,
  meeting_key: 1300,
  session_name: 'Race',
  session_type: 'Race',
  circuit_short_name: 'Spa',
  country_name: 'Belgium',
  country_code: 'BEL',
  location: 'Spa-Francorchamps',
  date_start: iso(0),
  date_end: iso(7200),
  gmt_offset: '02:00:00',
  year: 2026
}

const lap = (driver: number, n: number, startSec: number, dur: number | null, extra: Record<string, unknown> = {}) => ({
  driver_number: driver,
  lap_number: n,
  lap_duration: dur,
  duration_sector_1: dur ? dur / 3 : null,
  duration_sector_2: dur ? dur / 3 : null,
  duration_sector_3: dur ? dur / 3 : null,
  i1_speed: 300,
  i2_speed: 290,
  st_speed: 320,
  is_pit_out_lap: false,
  date_start: iso(startSec),
  ...extra
})

function defaultFeeds(): Record<string, unknown> {
  return {
    sessions: [RACE_SESSION],
    drivers: [
      { driver_number: 1, name_acronym: 'VER', first_name: 'Max', last_name: 'Verstappen', team_name: 'Red Bull', team_colour: '3671C6' },
      { driver_number: 44, name_acronym: 'HAM', first_name: 'Lewis', last_name: 'Hamilton', full_name: 'Lewis HAMILTON' }
    ],
    stints: [
      { driver_number: 1, stint_number: 1, lap_start: 1, lap_end: 2, compound: 'MEDIUM', tyre_age_at_start: 0 },
      { driver_number: 1, stint_number: 2, lap_start: 3, lap_end: 60, compound: 'HARD', tyre_age_at_start: 2 },
      { driver_number: 44, stint_number: 1, lap_start: 1, lap_end: 60, compound: 'soft', tyre_age_at_start: 0 }
    ],
    laps: [
      lap(1, 1, 0, 90),
      lap(1, 2, 90, 88),
      lap(1, 3, 178, 89),
      lap(44, 1, 2, 92),
      lap(44, 2, 94, 91),
      lap(44, 3, 185, 90)
    ],
    intervals: [
      { driver_number: 44, date: iso(100), gap_to_leader: 2.5, interval: 2.5 },
      { driver_number: 44, date: iso(10), gap_to_leader: '+1 LAP', interval: null },
      { driver_number: 1, date: iso(10), gap_to_leader: 0, interval: 0 }
    ],
    weather: [
      { date: iso(60), air_temperature: 21, track_temperature: 30, humidity: 50, pressure: 1010, rainfall: 0, wind_speed: 2, wind_direction: 90 },
      { date: iso(0), air_temperature: 20, track_temperature: 29, humidity: 55, pressure: 1010, rainfall: null, wind_speed: 1, wind_direction: 80 },
      { date: iso(300), air_temperature: 19, track_temperature: 27, humidity: 60, pressure: 1009, rainfall: 1.2, wind_speed: 3, wind_direction: 70 }
    ],
    position: [
      { driver_number: 44, date: iso(0), position: 2 },
      { driver_number: 1, date: iso(0), position: 1 },
      { driver_number: 44, date: iso(150), position: 1 },
      { driver_number: 1, date: iso(150), position: 2 }
    ],
    race_control: [
      { date: iso(120), category: 'Flag', message: 'YELLOW IN TRACK SECTOR 4', flag: 'YELLOW', scope: 'Sector', sector: 4, driver_number: null, lap_number: 2 },
      { date: iso(20), category: 'Flag', message: 'GREEN LIGHT - PIT EXIT OPEN', flag: 'GREEN', scope: 'Track', sector: null, driver_number: null, lap_number: 1 }
    ]
  }
}

let feeds: Record<string, unknown>
let routes: Record<string, Route>
let fetchLog: Array<{ endpoint: string; at: number }>
const fetchMock = vi.fn()

function installFetch(): void {
  fetchMock.mockReset()
  fetchLog = []
  fetchMock.mockImplementation(async (url: string) => {
    const endpoint = url.slice(BASE.length + 1).split('?')[0]
    fetchLog.push({ endpoint, at: Date.now() })
    const r = routes[endpoint]
    if (r?.throws) throw r.throws
    const status = r?.status ?? 200
    const body = r && 'body' in r ? r.body : feeds[endpoint]
    return new Response(JSON.stringify(body ?? []), { status })
  })
}

async function load(p: OpenF1Provider, id = '9900') {
  const promise = p.loadSession(id)
  // Two 350ms throttle waves.
  await vi.advanceTimersByTimeAsync(800)
  return promise
}

/** Attach the rejection handler before advancing so it is never "unhandled". */
async function loadExpectingReject(p: OpenF1Provider, id = '9900'): Promise<Error> {
  const settled = p.loadSession(id).then(
    () => new Error('did not reject'),
    (e: Error) => e
  )
  await vi.advanceTimersByTimeAsync(800)
  return settled
}

async function loaded(): Promise<OpenF1Provider> {
  const p = new OpenF1Provider()
  await load(p)
  return p
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-19T12:00:00Z'))
  feeds = defaultFeeds()
  routes = {}
  installFetch()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('OpenF1Provider.loadSession', () => {
  it('maps the session, computes total laps for a race and exposes the duration', async () => {
    const p = new OpenF1Provider()
    const info = await load(p)
    expect(info).toMatchObject({
      id: '9900',
      meetingId: '1300',
      name: 'Race',
      type: 'race',
      circuitShortName: 'Spa',
      countryCode: 'BEL',
      year: 2026,
      totalLaps: 3,
      provider: 'openf1'
    })
    expect(p.getDuration()).toBe(7200)
  })

  it('leaves totalLaps null for a non-race session', async () => {
    feeds.sessions = [{ ...RACE_SESSION, session_name: 'Qualifying' }]
    const info = await load(new OpenF1Provider())
    expect(info.type).toBe('qualifying')
    expect(info.totalLaps).toBeNull()
  })

  it.each([
    ['Sprint Qualifying', 'sprint-qualifying'],
    ['Sprint Shootout', 'sprint'],
    ['Sprint', 'sprint'],
    ['Practice 2', 'practice'],
    ['Something Else', 'unknown']
  ])('maps session name %s to type %s', async (name, type) => {
    feeds.sessions = [{ ...RACE_SESSION, session_name: name }]
    expect((await load(new OpenF1Provider())).type).toBe(type)
  })

  it('rejects with a clear error when the session key is unknown', async () => {
    feeds.sessions = []
    const err = await loadExpectingReject(new OpenF1Provider(), '424242')
    expect(err.message).toBe('OpenF1 session 424242 not found')
  })

  it.each(['sessions', 'drivers', 'stints', 'laps'])(
    'rejects when the REQUIRED %s feed returns a non-2xx status',
    async (endpoint) => {
      routes[endpoint] = { status: 429, body: { detail: 'rate limited' } }
      const err = await loadExpectingReject(new OpenF1Provider())
      expect(err.message).toBe(`OpenF1 429 for ${BASE}/${endpoint}?session_key=9900`)
    }
  )

  it('rejects when a required feed fails with a network error', async () => {
    routes.laps = { throws: new Error('socket hang up') }
    const err = await loadExpectingReject(new OpenF1Provider())
    expect(err.message).toBe('socket hang up')
  })

  it.each([
    ['intervals', 'intervals'],
    ['weather', 'weather'],
    ['race_control', 'raceControl']
  ] as const)('still loads when the optional %s feed fails, and reports it unavailable', async (endpoint, flag) => {
    routes[endpoint] = { status: 500 }
    const snap = (await loaded()).getSnapshotAt(200)
    expect(snap.availability[flag]).toBe(false)
    expect(snap.availability).toMatchObject({ timing: true, laps: true })
  })

  it('still loads when the optional position feed fails, falling back to synthetic ordering', async () => {
    routes.position = { status: 500 }
    const snap = (await loaded()).getSnapshotAt(200)
    expect(snap.timing.map((t) => t.driverNumber).sort()).toEqual([1, 44])
    expect(snap.timing.map((t) => t.position)).toEqual([1, 2])
    expect(snap.availability.laps).toBe(true)
  })

  it('survives every optional feed failing at once', async () => {
    for (const e of ['intervals', 'weather', 'position', 'race_control']) routes[e] = { throws: new Error('down') }
    const p = await loaded()
    const snap = p.getSnapshotAt(200)
    expect(snap.raceControl).toEqual([])
    expect(snap.weather).toBeNull()
    expect(snap.trackStatus).toBe('CLEAR')
  })

  it('treats a non-array (object/null/string) body as an empty feed rather than crashing', async () => {
    routes.drivers = { body: { detail: 'Not found' } }
    routes.stints = { body: null }
    routes.intervals = { body: 'oops' }
    const p = await loaded()
    const snap = p.getSnapshotAt(200)
    expect(snap.drivers).toEqual([])
    expect(snap.timing).toEqual([])
    expect(snap.stints).toEqual([])
    expect(snap.availability).toMatchObject({ timing: false, stints: false, intervals: false })
  })

  it('reports an empty sessions object as a missing session', async () => {
    routes.sessions = { body: { detail: 'No results found' } }
    const err = await loadExpectingReject(new OpenF1Provider())
    expect(err.message).toContain('not found')
  })

  it('throttles requests into three waves separated by 350ms', async () => {
    const p = new OpenF1Provider()
    const promise = p.loadSession('9900')
    await vi.advanceTimersByTimeAsync(0)
    const at = (e: string) => fetchLog.find((f) => f.endpoint === e)?.at
    expect(['sessions', 'drivers', 'stints'].every((e) => at(e) != null)).toBe(true)
    expect(at('laps')).toBeUndefined()

    await vi.advanceTimersByTimeAsync(349)
    expect(at('laps')).toBeUndefined()
    await vi.advanceTimersByTimeAsync(1)
    expect(['laps', 'intervals', 'weather'].every((e) => at(e) != null)).toBe(true)
    expect(at('position')).toBeUndefined()

    await vi.advanceTimersByTimeAsync(349)
    expect(at('position')).toBeUndefined()
    await vi.advanceTimersByTimeAsync(1)
    expect(at('position')).toBeDefined()
    expect(at('race_control')).toBeDefined()
    await promise
    expect(at('position')! - at('sessions')!).toBe(700)
  })

  it('a failed reload leaves the previously loaded session intact', async () => {
    const p = await loaded()
    routes.laps = { status: 500 }
    const err = await loadExpectingReject(p, '1')
    expect(err.message).toContain('OpenF1 500')
    const snap = p.getSnapshotAt(200)
    expect(snap.session.id).toBe('9900')
    expect(snap.timing).toHaveLength(2)
  })

  it('a successful reload replaces (not merges) the previous session state', async () => {
    const p = await loaded()
    feeds = { ...defaultFeeds(), laps: [], stints: [], race_control: [], drivers: [feeds.drivers && (feeds.drivers as unknown[])[0]] }
    await load(p)
    const snap = p.getSnapshotAt(200)
    expect(snap.timing).toHaveLength(1)
    expect(snap.laps).toEqual([])
    expect(snap.stints).toEqual([])
    expect(snap.raceControl).toEqual([])
    expect(snap.totalLaps).toBeNull()
  })
})

describe('OpenF1Provider.getSnapshotAt', () => {
  it('throws if no session has been loaded', () => {
    expect(() => new OpenF1Provider().getSnapshotAt(0)).toThrow('no session loaded')
  })

  it('clamps the clock to [0, duration]', async () => {
    const p = await loaded()
    expect(p.getSnapshotAt(-50).clock).toBe(0)
    expect(p.getSnapshotAt(99_999).clock).toBe(7200)
    expect(p.getSnapshotAt(200).clock).toBe(200)
  })

  it('orders by OpenF1 position and applies the latest position sample at or before the clock', async () => {
    const p = await loaded()
    expect(p.getSnapshotAt(100).timing.map((t) => t.driverNumber)).toEqual([1, 44])
    // At t=150 the positions swap.
    const later = p.getSnapshotAt(150).timing
    expect(later.map((t) => [t.driverNumber, t.position])).toEqual([[44, 1], [1, 2]])
  })

  it('gives the leader gap 0 / no interval, and normalises lapped and missing gaps', async () => {
    const p = await loaded()
    // intervals were supplied out of order; t=100 -> HAM's latest sample at/before is the t=100 one.
    const at100 = p.getSnapshotAt(100).timing
    const ver = at100.find((t) => t.driverNumber === 1)!
    const ham = at100.find((t) => t.driverNumber === 44)!
    expect(ver).toMatchObject({ position: 1, gapToLeader: 0, intervalAhead: null })
    expect(ham).toMatchObject({ position: 2, gapToLeader: 2.5, intervalAhead: 2.5 })

    // Before the t=100 sample the earlier "+1 LAP" row applies (out-of-order input still binary-searches right).
    const at50 = p.getSnapshotAt(50).timing.find((t) => t.driverNumber === 44)!
    expect(at50.gapToLeader).toBe('+1 LAP')
    expect(at50.intervalAhead).toBeNull()
  })

  it('falls back to lap-count ordering and synthetic positions when no position feed exists', async () => {
    routes.position = { body: [] }
    const p = await loaded()
    const timing = p.getSnapshotAt(200).timing
    expect(timing.map((t) => t.position)).toEqual([1, 2])
    expect(new Set(timing.map((t) => t.driverNumber))).toEqual(new Set([1, 44]))
  })

  it('counts completed laps, last/best lap, tyre stint and pit stops from the clock', async () => {
    const p = await loaded()
    // t=200: VER finished laps 1-2 (ends 178s), on lap 3 in stint 2 (HARD, age 2 at start).
    const ver = p.getSnapshotAt(200).timing.find((t) => t.driverNumber === 1)!
    expect(ver).toMatchObject({
      lapNumber: 3,
      lastLap: 88,
      bestLap: 88,
      compound: 'HARD',
      stintAge: 2,
      lapsThisStint: 0,
      pitStops: 1,
      status: 'RUNNING'
    })
    expect(ver.sector1.seconds).toBeCloseTo(88 / 3, 6)
    const ham = p.getSnapshotAt(200).timing.find((t) => t.driverNumber === 44)!
    expect(ham).toMatchObject({ lapNumber: 3, lastLap: 91, bestLap: 91, compound: 'SOFT', pitStops: 0 })
  })

  it('marks drivers FINISHED after completing every lap', async () => {
    const p = await loaded()
    const snap = p.getSnapshotAt(400)
    expect(snap.timing.every((t) => t.status === 'FINISHED')).toBe(true)
    expect(snap.currentLap).toBe(3) // capped at totalLaps
  })

  it('reports no completed laps and lap 1 before the first lap ends', async () => {
    const p = await loaded()
    const snap = p.getSnapshotAt(5)
    for (const t of snap.timing) {
      expect(t.lapNumber).toBe(1)
      expect(t.lastLap).toBeNull()
      expect(t.bestLap).toBeNull()
    }
    expect(snap.laps).toEqual([])
    expect(snap.currentLap).toBe(1)
  })

  it('handles null lap fields: no crash, null carried through, null-dated laps never count as completed', async () => {
    feeds.laps = [
      lap(1, 1, 0, 90),
      // Unknown duration but a start time: treated as ending at its start.
      lap(1, 2, 90, null),
      // No start time at all: can never be "completed".
      lap(1, 3, 0, 89, { date_start: null }),
      lap(44, 1, 2, 92, { duration_sector_1: null, i1_speed: null, st_speed: null })
    ]
    const p = await loaded()
    const snap = p.getSnapshotAt(200)
    const ver = snap.timing.find((t) => t.driverNumber === 1)!
    expect(ver.lastLap).toBeNull() // lap 2 (null duration) is the last "completed" lap
    expect(ver.bestLap).toBe(90) // best only from real durations
    expect(snap.laps.some((l) => l.driverNumber === 1 && l.lapNumber === 3)).toBe(false)
    const nullDur = snap.laps.find((l) => l.driverNumber === 1 && l.lapNumber === 2)!
    expect(nullDur.lapTime).toBeNull()
    expect(nullDur.sector1).toBeNull()
    const ham = snap.timing.find((t) => t.driverNumber === 44)!
    expect(ham.sector1.seconds).toBeNull()
    const hamLap = snap.laps.find((l) => l.driverNumber === 44)!
    expect(hamLap).toMatchObject({ speedI1: null, speedST: null })
  })

  it('does not treat a zero-length lap duration as a valid best lap', async () => {
    feeds.laps = [lap(1, 1, 0, 0), lap(1, 2, 0, 90)]
    const p = await loaded()
    const ver = p.getSnapshotAt(200).timing.find((t) => t.driverNumber === 1)!
    expect(ver.bestLap).toBe(90)
  })

  it('flags a driver IN_PIT shortly after a pit-out lap starts, then RUNNING', async () => {
    feeds.laps = [lap(1, 1, 0, 90), lap(1, 2, 90, 100, { is_pit_out_lap: true })]
    const p = await loaded()
    const early = p.getSnapshotAt(95).timing.find((t) => t.driverNumber === 1)!
    expect(early).toMatchObject({ inPit: true, status: 'IN_PIT' })
    const later = p.getSnapshotAt(150).timing.find((t) => t.driverNumber === 1)!
    expect(later).toMatchObject({ inPit: false, status: 'RUNNING' })
  })

  it('flags a lapped, inactive car STOPPED but never claims it retired', async () => {
    // HAM stops after lap 1; VER keeps lapping every 90s.
    feeds.laps = [
      ...Array.from({ length: 12 }, (_, i) => lap(1, i + 1, i * 90, 90)),
      lap(44, 1, 0, 90)
    ]
    feeds.stints = []
    const p = await loaded()
    const ham = p.getSnapshotAt(90 * 11).timing.find((t) => t.driverNumber === 44)!
    expect(ham.status).toBe('STOPPED')
    expect(ham.retired).toBe(false)
  })

  it('emits laps and a fastest-lap flag only once enough credible laps exist', async () => {
    const p = await loaded()
    // t=91: only VER has finished a lap (HAM's ends at 94s) -> under 50% coverage, no flag yet.
    expect(p.getSnapshotAt(91).timing.some((t) => t.isFastestLap)).toBe(false)
    const late = p.getSnapshotAt(400)
    expect(late.timing.filter((t) => t.isFastestLap)).toHaveLength(1)
    expect(late.timing.find((t) => t.isFastestLap)!.driverNumber).toBe(1) // 88s beats 90s
    expect(late.laps).toHaveLength(6)
    const ver3 = late.laps.find((l) => l.driverNumber === 1 && l.lapNumber === 3)!
    expect(ver3).toMatchObject({ compound: 'HARD', sessionTime: 267 })
  })

  it('progresses lap samples as the clock advances (cache does not go stale)', async () => {
    const p = await loaded()
    const counts = [5, 100, 200, 400].map((t) => p.getSnapshotAt(t).laps.length)
    expect(counts).toEqual([0, 2, 4, 6])
    // Scrubbing backwards recomputes correctly.
    expect(p.getSnapshotAt(5).laps.length).toBe(0)
  })

  it('filters weather and race control to the clock, sorted, and maps rainfall to a boolean', async () => {
    const p = await loaded()
    const snap = p.getSnapshotAt(100)
    expect(snap.weather?.airTemp).toBe(21) // nearest sample at/before t=100 (t=60) despite feed order
    expect(snap.weatherHistory.map((w) => w.airTemp)).toEqual([20, 21])
    expect(snap.weatherHistory[0].rainfall).toBe(false) // null rainfall
    expect(p.getSnapshotAt(400).weather?.rainfall).toBe(true)
    expect(snap.raceControl.map((m) => m.flag)).toEqual(['GREEN']) // 120s message not yet
    const rc = p.getSnapshotAt(200).raceControl
    expect(rc.map((m) => m.flag)).toEqual(['GREEN', 'YELLOW'])
    expect(rc[1]).toMatchObject({ severity: 'warning', sector: 4, lapNumber: 2 })
  })

  it('has no current weather before the first sample', async () => {
    feeds.weather = [{ date: iso(500), air_temperature: 1, track_temperature: 1, humidity: 1, pressure: 1, rainfall: 0, wind_speed: 1, wind_direction: 1 }]
    const p = await loaded()
    expect(p.getSnapshotAt(10).weather).toBeNull()
  })

  it('derives track status from race control, latest message first', async () => {
    feeds.race_control = [
      { date: iso(10), category: 'Flag', message: 'RED FLAG', flag: 'RED', scope: 'Track', sector: null, driver_number: null, lap_number: 1 },
      { date: iso(50), category: 'Flag', message: 'GREEN LIGHT', flag: 'GREEN', scope: 'Track', sector: null, driver_number: null, lap_number: 1 },
      { date: iso(90), category: 'Flag', message: 'DOUBLE YELLOW IN SECTOR 2', flag: 'DOUBLE YELLOW', scope: 'Sector', sector: 2, driver_number: null, lap_number: 1 }
    ]
    const p = await loaded()
    expect(p.getSnapshotAt(20).trackStatus).toBe('RED')
    expect(p.getSnapshotAt(60).trackStatus).toBe('CLEAR')
    expect(p.getSnapshotAt(100).trackStatus).toBe('YELLOW')
  })

  it('recognises a Safety Car deployment and its end', async () => {
    feeds.race_control = [
      { date: iso(10), category: 'SafetyCar', message: 'SAFETY CAR DEPLOYED', flag: null, scope: 'Track', sector: null, driver_number: null, lap_number: 1 },
      { date: iso(60), category: 'SafetyCar', message: 'SAFETY CAR IN THIS LAP', flag: null, scope: 'Track', sector: null, driver_number: null, lap_number: 1 }
    ]
    const p = await loaded()
    expect(p.getSnapshotAt(30).trackStatus).toBe('SAFETY_CAR')
    expect(p.getSnapshotAt(100).trackStatus).toBe('CLEAR')
  })

  // "virtual safety car" contains "safety car", so the VSC check has to run first.
  it('reports a Virtual Safety Car deployment as VSC, not SAFETY_CAR', async () => {
    feeds.race_control = [
      { date: iso(10), category: 'SafetyCar', message: 'VIRTUAL SAFETY CAR DEPLOYED', flag: null, scope: 'Track', sector: null, driver_number: null, lap_number: 1 }
    ]
    const p = await loaded()
    expect(p.getSnapshotAt(30).trackStatus).toBe('VSC')
  })

  it('exposes race-only current lap and null for other session types', async () => {
    const race = await loaded()
    expect(race.getSnapshotAt(200).currentLap).toBe(3)
    feeds.sessions = [{ ...RACE_SESSION, session_name: 'Practice 1' }]
    const fp = new OpenF1Provider()
    await load(fp)
    expect(fp.getSnapshotAt(200).currentLap).toBeNull()
  })

  it('reports availability from what the feeds actually delivered', async () => {
    const snap = (await loaded()).getSnapshotAt(200)
    expect(snap.availability).toMatchObject({
      timing: true,
      laps: true,
      stints: true,
      intervals: true,
      raceControl: true,
      weather: true,
      positions: false,
      telemetry: false,
      live: false
    })
  })

  it('computes lap progress from the current lap window', async () => {
    const p = await loaded()
    // VER lap 3 starts at 178s and lasts 89s; at t=222.5 progress is 0.5.
    const pos = p.getSnapshotAt(222.5).positions.find((s) => s.driverNumber === 1)!
    expect(pos.lapProgress).toBeCloseTo(0.5, 6)
    expect(pos.x).toBeNull()
    // Before the first lap has a duration to measure, progress stays 0.
    feeds.laps = [lap(1, 1, 0, null)]
    const p2 = await loaded()
    expect(p2.getSnapshotAt(10).positions.find((s) => s.driverNumber === 1)!.lapProgress).toBe(0)
  })

  it('falls back to "first last" when a driver has no full_name', async () => {
    const snap = (await loaded()).getSnapshotAt(0)
    expect(snap.drivers.find((d) => d.number === 1)!.fullName).toBe('Max Verstappen')
    expect(snap.drivers.find((d) => d.number === 44)!.fullName).toBe('Lewis HAMILTON')
  })
})

describe('OpenF1Provider.getDriverLaps', () => {
  it('returns one driver\'s laps in lap order, preserving nulls, and [] for an unknown driver', async () => {
    feeds.laps = [lap(1, 2, 90, null), lap(1, 1, 0, 90)]
    const p = await loaded()
    const laps = p.getDriverLaps(1)
    expect(laps.map((l) => l.lapNumber)).toEqual([1, 2])
    expect(laps[1].lapTime).toBeNull()
    expect(laps[0]).toMatchObject({ compound: 'MEDIUM', isPitInLap: false })
    expect(p.getDriverLaps(999)).toEqual([])
  })
})

describe('OpenF1Provider.listSessions', () => {
  const row = (key: number, startSec: number, name = 'Race') => ({ ...RACE_SESSION, session_key: key, session_name: name, date_start: iso(startSec) })

  async function list(p = new OpenF1Provider()) {
    const promise = p.listSessions()
    await vi.advanceTimersByTimeAsync(2000)
    return promise
  }
  const years = () => fetchLog.map((f) => f.endpoint)

  it('returns the newest year that has data, newest session first, and stops there', async () => {
    feeds.sessions = [row(1, 0, 'Practice 1'), row(3, 200_000, 'Race'), row(2, 100_000, 'Qualifying')]
    const out = await list()
    expect(out.map((s) => s.id)).toEqual(['3', '2', '1'])
    expect(out.map((s) => s.type)).toEqual(['race', 'qualifying', 'practice'])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/sessions?year=2026`)
  })

  it('falls back to the previous year when the current year is empty', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      fetchLog.push({ endpoint: url, at: Date.now() })
      return new Response(JSON.stringify(url.endsWith('year=2025') ? [row(7, 0)] : []), { status: 200 })
    })
    const out = await list()
    expect(out.map((s) => s.id)).toEqual(['7'])
    expect(years()).toEqual([`${BASE}/sessions?year=2026`, `${BASE}/sessions?year=2025`])
  })

  it('skips a year whose request fails and carries on to the next', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('year=2026')) return new Response('', { status: 401 })
      if (url.endsWith('year=2025')) throw new Error('network')
      return new Response(JSON.stringify([row(5, 0)]), { status: 200 })
    })
    const out = await list()
    expect(out.map((s) => s.id)).toEqual(['5'])
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      `${BASE}/sessions?year=2026`,
      `${BASE}/sessions?year=2025`,
      `${BASE}/sessions?year=2023`
    ])
  })

  it('returns an empty list when every year fails or returns a non-array body', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.endsWith('year=2026') ? new Response('', { status: 500 }) : new Response(JSON.stringify({ detail: 'x' }), { status: 200 })
    )
    expect(await list()).toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('waits 300ms between year requests', async () => {
    fetchMock.mockImplementation(async () => new Response('[]', { status: 200 }))
    const p = new OpenF1Provider()
    const promise = p.listSessions()
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(299)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(300)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(300)
    await promise
  })
})
