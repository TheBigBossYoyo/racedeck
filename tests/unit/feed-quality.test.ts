import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { F1SessionData, F1StreamPoint } from '@shared/f1live'
import {
  buildCircularPositions,
  buildSyntheticSession,
  liveDeltaFor
} from './fixtures/f1SyntheticSession'

const ipc = vi.hoisted(() => ({
  loadSession: vi.fn(),
  loadSessionEnrichment: vi.fn(),
  getLive: vi.fn()
}))

vi.mock('@renderer/lib/ipc', () => ({
  hasBridge: () => true,
  bridge: () => ({ f1: ipc })
}))
vi.mock('@renderer/store/persist', () => ({
  persist: {
    get: async () => null,
    set: async () => undefined,
    remove: async () => undefined,
    all: async () => ({}),
    __resetMemory: () => undefined
  }
}))

import { F1LiveProvider } from '@renderer/core/providers/F1LiveProvider'
import {
  EMPTY_FEED_QUALITY,
  FeedQualityTracker
} from '@renderer/core/providers/f1/FeedQualityTracker'
import { CHECK_IDS } from '@renderer/core/providers/f1/feedChecks'
import {
  buildCurrentTyres,
  buildTiming,
  buildTyreStintHistory,
  collectRaceControl,
  normalizeDrivers,
  positionCoordinatesAt
} from '@renderer/core/providers/f1normalize'
import type { FeedQualityReport } from '@renderer/core/providers/types'

// ── helpers ─────────────────────────────────────────────────────────────────────

/** Observe one topic's payloads on a fresh tracker and return its report. */
function reportFor(topic: string, ...payloads: unknown[]): FeedQualityReport {
  const tracker = new FeedQualityTracker()
  tracker.observe(
    topic,
    payloads.map((d, i) => ({ t: i, d }))
  )
  expect(tracker.validatorFaults).toBe(0)
  return tracker.report()
}

function countOf(report: FeedQualityReport, feed: string, problem: string): number {
  return (
    report.feeds.find((f) => f.feed === feed)?.reasons.find((r) => r.problem === problem)?.count ??
    0
  )
}

// Realistic shapes (as the live feed sends them).
const CLEAN_TIMING = {
  Lines: {
    '1': {
      Position: '1',
      GapToLeader: '',
      IntervalToPositionAhead: { Value: '', Catching: false },
      NumberOfLaps: 12,
      NumberOfPitStops: 1,
      InPit: false,
      PitOut: false,
      Retired: false,
      Stopped: false,
      LastLapTime: { Value: '1:29.456', PersonalFastest: false },
      BestLapTime: { Value: '' },
      Sectors: [{ Value: '28.1', Segments: [{ Status: 2048 }] }, { Value: '' }, { Value: '31.9' }]
    },
    '44': {
      Position: 2,
      GapToLeader: '+1.234',
      IntervalToPositionAhead: { Value: '+1.234' },
      Sectors: { '1': { Value: '27.9' }, _deleted: ['2'] }
    }
  },
  SessionPart: 2
}
const CLEAN_DRIVERS = {
  '1': {
    RacingNumber: '1',
    Tla: 'VER',
    FirstName: 'Max',
    LastName: 'Verstappen',
    FullName: 'Max VERSTAPPEN',
    BroadcastName: 'M VERSTAPPEN',
    TeamName: 'Red Bull Racing',
    TeamColour: '3671C6',
    HeadshotUrl: 'https://example.test/ver.png',
    CountryCode: 'NED',
    Line: 1
  },
  '44': { Tla: 'HAM' }
}
const CLEAN_POSITION = {
  Position: [
    {
      Timestamp: '2026-01-01T12:00:00Z',
      Entries: {
        '1': { Status: 'OnTrack', X: 100, Y: -200, Z: 5 },
        '44': { Status: 'OffTrack', X: 0, Y: 0, Z: 0 }
      }
    }
  ]
}
const CLEAN_TYRES = {
  Tyres: { '1': { Compound: 'SOFT', New: 'true', TyresNotChanged: '0' }, '44': { New: false } }
}
const CLEAN_STINTS = {
  Stints: {
    '1': { '0': { Compound: 'MEDIUM', New: 'false', TotalLaps: 12, StartLaps: 2 } },
    '44': [{ Compound: 'HARD', New: 'true', TotalLaps: 0, StartLaps: 0 }, { TotalLaps: 4 }]
  }
}
const CLEAN_RC = {
  Messages: [
    {
      Utc: '2026-01-01T12:00:00',
      Category: 'Flag',
      Flag: 'YELLOW',
      Scope: 'Sector',
      Sector: 7,
      Lap: 3,
      Message: 'YELLOW IN TRACK SECTOR 7'
    },
    { Category: 'Other', Message: 'no utc is fine', RacingNumber: '44' }
  ]
}

const CLEAN: Record<string, unknown> = {
  TimingData: CLEAN_TIMING,
  DriverList: CLEAN_DRIVERS,
  Position: CLEAN_POSITION,
  CurrentTyres: CLEAN_TYRES,
  TyreStintSeries: CLEAN_STINTS,
  RaceControlMessages: CLEAN_RC
}

// ── validators ──────────────────────────────────────────────────────────────────

describe('feed validators: clean input reports nothing', () => {
  it.each(Object.keys(CLEAN))('%s', (topic) => {
    expect(reportFor(topic, CLEAN[topic])).toBe(EMPTY_FEED_QUALITY)
  })

  it('reports nothing for partial deltas, blank values and cleared (null) fields', () => {
    expect(reportFor('TimingData', { SessionPart: 1 }, { Withheld: false }, { Lines: {} })).toBe(
      EMPTY_FEED_QUALITY
    )
    expect(
      reportFor('TimingData', {
        Lines: {
          '5': { LastLapTime: { Value: '' }, Position: null, Sectors: { '0': { Value: '' } } }
        }
      })
    ).toBe(EMPTY_FEED_QUALITY)
    expect(reportFor('CurrentTyres', {})).toBe(EMPTY_FEED_QUALITY)
  })

  it('ignores topics it has no validator for', () => {
    expect(reportFor('WeatherData', { AirTemp: 'hot' })).toBe(EMPTY_FEED_QUALITY)
  })

  it('reports nothing for the synthetic session, including its Position feed', () => {
    const session = buildSyntheticSession({ durationSec: 300, positions: true, seed: 3 })
    const tracker = new FeedQualityTracker()
    tracker.observeStreams(session.streams)
    expect(tracker.report()).toBe(EMPTY_FEED_QUALITY)
  })
})

describe('feed validators: malformed input is counted', () => {
  it('TimingData', () => {
    const bad = {
      Lines: {
        '1': {
          Position: 'P1', // timingPosition
          NumberOfLaps: {}, // timingLaps
          NumberOfPitStops: 'x', // timingPitStops
          InPit: 'true', // timingFlag
          Retired: 1, // timingFlag
          GapToLeader: { v: 1 }, // timingGap
          IntervalToPositionAhead: 'x', // timingInterval
          LastLapTime: { Value: 'OUT' }, // timingLapTime
          BestLapTime: 'fast', // timingLapTime (not an object)
          Sectors: [{ Value: 'n/a' }, 'x'] // timingSector, timingSectors
        },
        abc: { Position: '1' }, // timingKey
        '2': 'oops' // timingLine
      }
    }
    const report = reportFor('TimingData', bad, { Lines: 5 }, 'not an object')
    const p = (problem: string): number => countOf(report, 'TimingData', problem)
    expect(p('non-numeric position')).toBe(1)
    expect(p('non-numeric lap count')).toBe(1)
    expect(p('non-numeric pit-stop count')).toBe(1)
    expect(p('non-boolean pit/retired/stopped flag')).toBe(2)
    expect(p('gap that is neither text nor a number')).toBe(1)
    expect(p('interval that is not an object')).toBe(1)
    expect(p('non-numeric lap time')).toBe(2)
    expect(p('non-numeric sector time')).toBe(1)
    expect(p('malformed sector entry')).toBe(1)
    expect(p('non-numeric driver key')).toBe(1)
    expect(p('driver entry that is not an object')).toBe(1)
    expect(p('malformed payload')).toBe(2) // Lines: 5, and a non-object payload
    expect(report.feeds).toHaveLength(1)
    expect(report.totalAnomalies).toBe(report.feeds[0].anomalies)
  })

  it('describes a repeated fault the way a person would say it', () => {
    const points = Array.from({ length: 12 }, () => ({
      Lines: { '44': { LastLapTime: { Value: 'OUT' } } }
    }))
    const report = reportFor('TimingData', ...points)
    expect(report.totalAnomalies).toBe(12)
    expect(report.feeds[0].reasons[0]).toMatchObject({
      problem: 'non-numeric lap time',
      count: 12,
      checked: 12,
      example: '#44 LastLapTime: "OUT"'
    })
  })

  it('DriverList', () => {
    const report = reportFor('DriverList', {
      '1': { Tla: 12, TeamName: null, FullName: ['x'] }, // 2 non-text (null is "cleared")
      '2': 'x', // entry not an object
      Lines: { Tla: 'X' } // non-numeric key
    })
    expect(countOf(report, 'DriverList', 'identity field that is not text')).toBe(2)
    expect(countOf(report, 'DriverList', 'driver entry that is not an object')).toBe(1)
    expect(countOf(report, 'DriverList', 'non-numeric driver key')).toBe(1)
    expect(reportFor('DriverList', 42).totalAnomalies).toBe(1)
  })

  it('Position', () => {
    const report = reportFor(
      'Position',
      {
        Position: [
          {
            Entries: {
              '1': { Status: 7, X: 'a', Y: 2, Z: 3 }, // status, coord
              '2': { Status: 'OnTrack', Y: 2, Z: 3 }, // missing X
              '3': 'x', // entry
              x9: { X: 1, Y: 1, Z: 1 } // key
            }
          },
          { Timestamp: 'no entries' } // malformed frame
        ]
      },
      { Position: 'nope' }
    )
    expect(countOf(report, 'Position', 'status that is not text')).toBe(1)
    expect(countOf(report, 'Position', 'missing or non-numeric X/Y/Z')).toBe(2)
    expect(countOf(report, 'Position', 'car entry that is not an object')).toBe(1)
    expect(countOf(report, 'Position', 'non-numeric driver key')).toBe(1)
    expect(countOf(report, 'Position', 'malformed position frame')).toBe(2)
  })

  it('CurrentTyres', () => {
    const report = reportFor(
      'CurrentTyres',
      { Tyres: { '1': { Compound: 3, New: 'maybe' }, '2': 'x', y: {} } },
      { Tyres: [] }
    )
    expect(countOf(report, 'CurrentTyres', 'compound that is not text')).toBe(1)
    expect(countOf(report, 'CurrentTyres', 'non-boolean New flag')).toBe(1)
    expect(countOf(report, 'CurrentTyres', 'tyre entry that is not an object')).toBe(1)
    expect(countOf(report, 'CurrentTyres', 'non-numeric driver key')).toBe(1)
    expect(countOf(report, 'CurrentTyres', 'malformed payload')).toBe(1)
  })

  it('TyreStintSeries', () => {
    const report = reportFor(
      'TyreStintSeries',
      {
        Stints: {
          '1': { '0': { Compound: 9, New: 'x', StartLaps: 'a', TotalLaps: {} }, '1': 'x' },
          '2': 'bad',
          z: {}
        }
      },
      { Stints: 1 }
    )
    expect(countOf(report, 'TyreStintSeries', 'compound that is not text')).toBe(1)
    expect(countOf(report, 'TyreStintSeries', 'non-boolean New flag')).toBe(1)
    expect(countOf(report, 'TyreStintSeries', 'non-numeric StartLaps/TotalLaps')).toBe(2)
    expect(countOf(report, 'TyreStintSeries', 'stint that is not an object')).toBe(1)
    expect(
      countOf(report, 'TyreStintSeries', 'driver stint list that is not an object or array')
    ).toBe(1)
    expect(countOf(report, 'TyreStintSeries', 'non-numeric driver key')).toBe(1)
    expect(countOf(report, 'TyreStintSeries', 'malformed payload')).toBe(1)
  })

  it('RaceControlMessages', () => {
    const report = reportFor(
      'RaceControlMessages',
      {
        Messages: [
          { Category: 5, Message: 'ok', Utc: 'not a date', Lap: 'three' },
          { Category: 'Flag' }, // no Message
          'x'
        ]
      },
      { Messages: 3 }
    )
    expect(countOf(report, 'RaceControlMessages', 'non-text Category/Flag/Scope')).toBe(1)
    expect(countOf(report, 'RaceControlMessages', 'unparseable Utc timestamp')).toBe(1)
    expect(countOf(report, 'RaceControlMessages', 'non-numeric Lap/Sector/RacingNumber')).toBe(1)
    expect(countOf(report, 'RaceControlMessages', 'missing or non-text Message')).toBe(1)
    expect(countOf(report, 'RaceControlMessages', 'message that is not an object')).toBe(1)
    expect(countOf(report, 'RaceControlMessages', 'malformed payload')).toBe(1)
  })

  it('keeps memory bounded: counters are per check, examples are short', () => {
    const tracker = new FeedQualityTracker()
    const huge = 'x'.repeat(10_000)
    const points: F1StreamPoint[] = Array.from({ length: 20_000 }, (_, i) => ({
      t: i,
      d: { Lines: { [String(i % 20)]: { LastLapTime: { Value: `${huge}${i}` }, Position: 'z' } } }
    }))
    tracker.observe('TimingData', points)
    const report = tracker.report()
    expect(report.totalAnomalies).toBe(40_000)
    const reasons = report.feeds.flatMap((f) => f.reasons)
    expect(reasons.length).toBeLessThanOrEqual(CHECK_IDS.length)
    for (const reason of reasons) expect(reason.example?.length ?? 0).toBeLessThan(80)
  })

  it('contains a validator fault instead of breaking the load', () => {
    const tracker = new FeedQualityTracker()
    const hostile = {
      get Lines(): unknown {
        throw new Error('boom')
      }
    }
    expect(() => tracker.observe('TimingData', [{ t: 0, d: hostile }])).not.toThrow()
    expect(tracker.validatorFaults).toBe(1)
  })

  it('resets, and reports a fresh (shared, empty) report afterwards', () => {
    const tracker = new FeedQualityTracker()
    tracker.observe('CurrentTyres', [{ t: 0, d: { Tyres: 4 } }])
    expect(tracker.report().totalAnomalies).toBe(1)
    tracker.reset()
    expect(tracker.report()).toBe(EMPTY_FEED_QUALITY)
  })
})

// ── differential: validation never changes what the normalizers produce ─────────

/** Every normalizer that reads the six validated feeds, over a session's streams. */
function normalizeEverything(streams: F1SessionData['streams'], tMax: number): string {
  const drivers = normalizeDrivers(
    (streams.DriverList ?? []).reduce<Record<string, unknown>>(
      (acc, p) => ({ ...acc, ...(p.d as Record<string, unknown>) }),
      {}
    )
  )
  const timingState = (streams.TimingData ?? [])[1]?.d
  const output = {
    drivers,
    timing: buildTiming(timingState, (streams.TimingAppData ?? [])[0]?.d, drivers),
    tyres: buildCurrentTyres(streams.CurrentTyres ?? [], tMax),
    stints: buildTyreStintHistory(streams.TyreStintSeries ?? [], tMax),
    raceControl: collectRaceControl(streams.RaceControlMessages ?? [], tMax),
    positions: positionCoordinatesAt(streams.Position ?? [], tMax)
  }
  return JSON.stringify(output)
}

function sessionWithEveryFeed(): F1SessionData {
  const session = buildSyntheticSession({ durationSec: 200, positions: true, seed: 11 })
  session.streams.CurrentTyres = [{ t: 5, d: CLEAN_TYRES }]
  session.streams.TyreStintSeries = [{ t: 5, d: CLEAN_STINTS }]
  session.streams.RaceControlMessages = [
    ...session.streams.RaceControlMessages,
    { t: 150, d: CLEAN_RC }
  ]
  return session
}

/** The same session with a fault of every kind injected (none of which the normalizers throw on). */
function malformedSession(): F1SessionData {
  const session = sessionWithEveryFeed()
  const { streams } = session
  streams.TimingData.splice(50, 0, {
    t: streams.TimingData[50].t + 0.0001,
    d: {
      Lines: {
        '3': {
          LastLapTime: { Value: 'OUT' },
          Position: 'P?',
          InPit: 'yes',
          Sectors: { '0': { Value: 'x' } }
        },
        oops: 1
      }
    }
  })
  streams.DriverList.push({ t: 1, d: { '1': { Tla: 99 } } })
  streams.Position[10] = {
    t: streams.Position[10].t,
    d: { Position: [{ Entries: { '2': { Status: 'OnTrack', X: 'a', Y: 1, Z: 2 }, '3': 'x' } }] }
  }
  streams.CurrentTyres.push({ t: 6, d: { Tyres: { '2': { Compound: 'SOFT', New: 'maybe' } } } })
  streams.TyreStintSeries.push({ t: 6, d: { Stints: { '2': { '0': { TotalLaps: 'many' } } } } })
  streams.RaceControlMessages.push({ t: 160, d: { Messages: [{ Category: 'Flag' }] } })
  return session
}

describe('differential: validation does not change normalizer output', () => {
  it.each([
    ['clean', sessionWithEveryFeed],
    ['malformed', malformedSession]
  ])('%s session: output is byte-identical and the input untouched', (_name, build) => {
    const pristine = build()
    const inspected = structuredClone(pristine)
    const untouchedCopy = structuredClone(pristine)

    const tracker = new FeedQualityTracker()
    tracker.observeStreams(inspected.streams)

    expect(inspected).toEqual(untouchedCopy)
    for (const tMax of [10, 100, 250]) {
      expect(normalizeEverything(inspected.streams, tMax)).toBe(
        normalizeEverything(pristine.streams, tMax)
      )
    }
  })

  it('the malformed session is actually flagged in every validated feed, the clean one in none', () => {
    const clean = new FeedQualityTracker()
    clean.observeStreams(sessionWithEveryFeed().streams)
    expect(clean.report()).toBe(EMPTY_FEED_QUALITY)

    const dirty = new FeedQualityTracker()
    dirty.observeStreams(malformedSession().streams)
    expect(
      dirty
        .report()
        .feeds.map((f) => f.feed)
        .sort()
    ).toEqual([
      'CurrentTyres',
      'DriverList',
      'Position',
      'RaceControlMessages',
      'TimingData',
      'TyreStintSeries'
    ])
  })
})

// ── differential through the provider ───────────────────────────────────────────

const DURATION = 200

let malformedTail = true

function feedTail(): F1StreamPoint[] {
  const points = buildCircularPositions([1, 2, 3], DURATION + 60, DURATION + 1)
  if (malformedTail)
    points[1] = {
      t: points[1].t,
      d: { Position: [{ Entries: { '1': { Status: 'OnTrack', X: 'bad', Y: 1, Z: 1 } } }] }
    }
  return points
}

async function loadProvider(session: F1SessionData): Promise<F1LiveProvider> {
  ipc.loadSession.mockResolvedValue(structuredClone(session))
  const provider = new F1LiveProvider()
  await provider.loadSession(session.summary.path)
  await vi.waitFor(() => {
    const progress = provider.getDiagnostics().enrichmentProgress
    expect(progress?.position.state).toBe('done')
    expect(progress?.carData.state).toBe('done')
  })
  return provider
}

function snapshotsOf(provider: F1LiveProvider): string {
  const times = [0, 20, 75, 150, provider.getDuration()]
  return JSON.stringify({
    duration: provider.getDuration(),
    snapshots: times.map((t) => provider.getSnapshotAt(t))
  })
}

describe('differential: the provider serves identical data with or without the tracker', () => {
  beforeEach(() => {
    ipc.loadSession.mockReset()
    ipc.getLive.mockReset()
    malformedTail = true
    ipc.loadSessionEnrichment.mockReset().mockImplementation(async (req: { feed: string }) => ({
      carData: [],
      position: req.feed === 'position' ? feedTail() : [],
      duration: DURATION + 60,
      nextCarDataOffset: 0,
      nextPositionOffset: 61,
      done: true
    }))
  })

  it('malformed archive: snapshots are byte-identical, and the anomalies are still counted', async () => {
    const session = malformedSession()

    const observing = await loadProvider(session)
    const observed = snapshotsOf(observing)
    const report = observing.getDiagnostics().feedQuality
    expect(report.totalAnomalies).toBeGreaterThan(0)
    // Both entry points count: the session payload and the streamed Position chunk.
    expect(countOf(report, 'Position', 'missing or non-numeric X/Y/Z')).toBeGreaterThanOrEqual(2)

    const silenced = vi
      .spyOn(FeedQualityTracker.prototype, 'observe')
      .mockImplementation(() => undefined)
    const observeStreams = vi
      .spyOn(FeedQualityTracker.prototype, 'observeStreams')
      .mockImplementation(() => undefined)
    try {
      const baseline = await loadProvider(session)
      expect(baseline.getDiagnostics().feedQuality.totalAnomalies).toBe(0)
      expect(snapshotsOf(baseline)).toBe(observed)
    } finally {
      silenced.mockRestore()
      observeStreams.mockRestore()
    }
  })

  it('clean archive: no anomalies are reported', async () => {
    malformedTail = false
    const provider = await loadProvider(sessionWithEveryFeed())
    expect(provider.getDiagnostics().feedQuality).toBe(EMPTY_FEED_QUALITY)
  })

  it('live polls count each point once and start over on a new connection', async () => {
    const session = malformedSession()
    const direct = new FeedQualityTracker()
    direct.observeStreams(session.streams)
    const expected = direct.report().totalAnomalies

    const provider = new F1LiveProvider()
    for (const [from, to] of [
      [-1, 90],
      [90, 210]
    ] as const) {
      ipc.getLive.mockResolvedValueOnce(liveDeltaFor(session, from, to))
      await provider.loadSession('live')
    }
    // A repeated (empty) poll must not double-count what it already saw.
    ipc.getLive.mockResolvedValueOnce(liveDeltaFor(session, 210, 210))
    await provider.loadSession('live')
    const live = provider.getDiagnostics().feedQuality.totalAnomalies
    expect(live).toBeGreaterThan(0)
    expect(live).toBe(expected)

    // New socket generation: the full buffer replaces what was known.
    ipc.getLive.mockResolvedValueOnce(liveDeltaFor(session, -1, 60, 2))
    await provider.loadSession('live')
    const fresh = new FeedQualityTracker()
    fresh.observeStreams(liveDeltaFor(session, -1, 60, 2).streams)
    expect(provider.getDiagnostics().feedQuality.totalAnomalies).toBe(fresh.report().totalAnomalies)
  })
})
