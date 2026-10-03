import type { F1LiveDataDelta, F1SessionData, F1StreamPoint } from '../../../src/shared/f1live'

/**
 * Deterministic synthetic F1 session for provider tests and micro-benchmarks.
 *
 * Shaped like the real feed's incremental patches (indexed Sectors, string
 * positions, nested interval objects, `_deleted` removal lists), so replaying it
 * exercises the same merge paths a genuine archive does. Everything is derived
 * from a seeded PRNG, so two builds with the same options are deep-equal.
 */

export interface SyntheticOptions {
  durationSec: number
  drivers?: number
  /** TimingData patches per second of session time. */
  timingRate?: number
  /** Include a circular Position feed (1 Hz) that closes a lap every ~90 s. */
  positions?: boolean
  seed?: number
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const SUMMARY = {
  path: '2026/Synthetic_Grand_Prix/2026-01-01_Race/',
  key: 1,
  year: 2026,
  meetingName: 'Synthetic Grand Prix',
  meetingOfficialName: null,
  name: 'Race',
  type: 'Race',
  number: 1,
  circuitShortName: 'Synthetic',
  countryName: 'Test',
  countryCode: 'TST',
  location: 'Test',
  startDate: null,
  endDate: null,
  gmtOffset: '+00:00:00',
  archiveStatus: 'Complete'
}

function lapTime(rand: () => number): string {
  return `1:${String(28 + Math.floor(rand() * 4)).padStart(2, '0')}.${String(
    Math.floor(rand() * 1000)
  ).padStart(3, '0')}`
}

export function buildSyntheticSession(options: SyntheticOptions): F1SessionData {
  const { durationSec } = options
  const driverCount = options.drivers ?? 20
  const timingRate = options.timingRate ?? 3
  const rand = mulberry32(options.seed ?? 1)
  const numbers = Array.from({ length: driverCount }, (_, i) => i + 1)

  const driverList: F1StreamPoint[] = [
    {
      t: 0,
      d: Object.fromEntries(
        numbers.map((n) => [
          String(n),
          {
            RacingNumber: String(n),
            Tla: `D${String(n).padStart(2, '0')}`,
            FirstName: `First${n}`,
            LastName: `Last${n}`,
            TeamName: `Team ${Math.ceil(n / 2)}`
          }
        ])
      )
    }
  ]

  const laps = new Map<number, number>()
  const timing: F1StreamPoint[] = []
  const app: F1StreamPoint[] = []
  const stints = new Map<number, number>()

  // Keyframe: every driver present with a starting classification.
  timing.push({
    t: 1,
    d: {
      Lines: Object.fromEntries(
        numbers.map((n) => [
          String(n),
          {
            Position: String(n),
            NumberOfLaps: 0,
            GapToLeader: n === 1 ? '' : `+${n}.000`,
            IntervalToPositionAhead: { Value: n === 1 ? '' : '+1.000' },
            Sectors: [{ Value: '' }, { Value: '' }, { Value: '' }],
            InPit: false
          }
        ])
      )
    }
  })
  for (const n of numbers) {
    stints.set(n, 0)
    laps.set(n, 0)
  }
  app.push({
    t: 1,
    d: {
      Lines: Object.fromEntries(
        numbers.map((n) => [
          String(n),
          { Stints: { '0': { Compound: 'MEDIUM', New: 'true', TotalLaps: 0, StartLaps: 0 } } }
        ])
      )
    }
  })

  const steps = Math.floor(durationSec * timingRate)
  for (let i = 1; i <= steps; i++) {
    const t = 1 + i / timingRate
    const n = numbers[Math.floor(rand() * driverCount)]
    const line: Record<string, unknown> = {}
    const kind = rand()
    if (kind < 0.35) {
      line.Sectors = { [String(Math.floor(rand() * 3))]: { Value: (20 + rand() * 10).toFixed(3) } }
    } else if (kind < 0.55) {
      line.Position = String(1 + Math.floor(rand() * driverCount))
      line.GapToLeader = `+${(rand() * 60).toFixed(3)}`
    } else if (kind < 0.7) {
      line.IntervalToPositionAhead = { Value: `+${(rand() * 3).toFixed(3)}` }
    } else if (kind < 0.85) {
      const lap = (laps.get(n) ?? 0) + 1
      laps.set(n, lap)
      line.NumberOfLaps = lap
      line.LastLapTime = { Value: lapTime(rand) }
      if (lap % 15 === 0) line.InPit = true
      else line.InPit = false
    } else if (kind < 0.92) {
      // Removal list on a nested object: exercises `_deleted` handling.
      line.Speeds = i % 2 === 0 ? { I1: { Value: String(280 + Math.floor(rand() * 40)) } } : { _deleted: ['I1'] }
    } else {
      line.BestLapTime = { Value: lapTime(rand) }
    }
    timing.push({ t, d: { Lines: { [String(n)]: line } } })

    if (i % (timingRate * 90) === 0) {
      // Pit stop / new stint for one driver.
      const stint = (stints.get(n) ?? 0) + 1
      stints.set(n, stint)
      app.push({
        t: t + 0.5,
        d: {
          Lines: {
            [String(n)]: {
              Stints: { [String(stint)]: { Compound: 'HARD', New: 'true', TotalLaps: 0, StartLaps: 0 } }
            }
          }
        }
      })
    }
  }

  const raceControl: F1StreamPoint[] = []
  for (let t = 45; t < durationSec; t += 120) {
    raceControl.push({
      t,
      d: {
        Messages: [
          { Category: 'Flag', Message: `YELLOW IN TRACK SECTOR ${Math.floor(t) % 20}`, Flag: 'YELLOW' }
        ]
      }
    })
  }

  const trackStatus: F1StreamPoint[] = []
  for (let t = 0; t < durationSec; t += 200) {
    const yellow = Math.floor(t / 200) % 2 === 1
    trackStatus.push({
      t,
      d: { Status: yellow ? '2' : '1', Message: yellow ? 'Yellow' : 'AllClear' }
    })
  }

  const streams: F1SessionData['streams'] = {
    DriverList: driverList,
    TimingData: timing,
    TimingAppData: app,
    RaceControlMessages: raceControl,
    TrackStatus: trackStatus
  }
  if (options.positions) streams.Position = buildCircularPositions(numbers, durationSec)

  return { summary: { ...SUMMARY }, sessionInfo: {}, streams, duration: durationSec }
}

/** All cars circling the same 6 km-radius loop, one lap per 90 s, 1 Hz. */
export function buildCircularPositions(
  numbers: number[],
  durationSec: number,
  fromSec = 0
): F1StreamPoint[] {
  const out: F1StreamPoint[] = []
  for (let t = fromSec; t <= durationSec; t++) {
    const entries: Record<string, unknown> = {}
    for (const n of numbers) {
      const angle = (2 * Math.PI * (t + n * 3)) / 90
      entries[String(n)] = { X: 6000 * Math.cos(angle), Y: 6000 * Math.sin(angle), Z: 10 }
    }
    out.push({ t, d: { Position: { '0': { Entries: entries } } } })
  }
  return out
}

/**
 * Slice a whole session into what the live socket would have delivered by
 * `upToSec` — the full buffer on the first poll, only new points afterwards.
 */
export function liveDeltaFor(
  session: F1SessionData,
  fromSec: number,
  upToSec: number,
  generation = 1
): F1LiveDataDelta {
  const streams: Record<string, F1StreamPoint[]> = {}
  const cursors: Record<string, number> = {}
  for (const [topic, points] of Object.entries(session.streams)) {
    const all = points as F1StreamPoint[]
    streams[topic] = all.filter((p) => p.t > fromSec && p.t <= upToSec)
    cursors[topic] = all.filter((p) => p.t <= upToSec).length
  }
  return {
    summary: { ...session.summary, path: 'live', liveStreamActive: true },
    sessionInfo: session.sessionInfo,
    streams: streams as F1SessionData['streams'],
    duration: upToSec,
    cursors,
    generation
  }
}
