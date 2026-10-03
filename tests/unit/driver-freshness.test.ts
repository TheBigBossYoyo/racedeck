import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { F1LiveDataDelta, F1StreamPoint } from '@shared/f1live'
import { DriverFeedTracker } from '@renderer/core/providers/DriverFeedTracker'
import { staleDriverFeeds, DRIVER_STALE_MS } from '@renderer/lib/driverStaleness'
import { buildSyntheticSession, liveDeltaFor } from './fixtures/f1SyntheticSession'

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

const timing = (t: number, ...drivers: number[]): F1StreamPoint => ({
  t,
  d: { Lines: Object.fromEntries(drivers.map((n) => [String(n), { Position: '1' }])) }
})
const position = (t: number, ...drivers: number[]): F1StreamPoint => ({
  t,
  d: {
    Position: {
      '0': { Entries: Object.fromEntries(drivers.map((n) => [String(n), { X: 1, Y: 2, Z: 3 }])) }
    }
  }
})
const carData = (t: number, ...drivers: number[]): F1StreamPoint => ({
  t,
  d: {
    Entries: [
      { Cars: Object.fromEntries(drivers.map((n) => [String(n), { Channels: { '2': 200 } }])) }
    ]
  }
})

describe('DriverFeedTracker', () => {
  it('ages a driver by how far behind the feed head their newest point is, plus the feed age', () => {
    const tracker = new DriverFeedTracker()
    tracker.observe('TimingData', [timing(10, 1, 2), timing(20, 1), timing(30, 1)], true)

    // Feed head is t=30 and the feed itself last delivered 500 ms ago.
    const ages = tracker.ages({ TimingData: 500 })
    expect(ages[1]).toEqual({ TimingData: 500 })
    expect(ages[2]).toEqual({ TimingData: 20_500 })
  })

  it('learns drivers from Position and CarData points independently per topic', () => {
    const tracker = new DriverFeedTracker()
    tracker.observe('Position', [position(5, 1, 2), position(6, 1, 2)], true)
    tracker.observe('CarData', [carData(4, 1, 2), carData(6, 1)], true)

    const ages = tracker.ages({ Position: 0, CarData: 0 })
    expect(ages[1]).toEqual({ Position: 0, CarData: 0 })
    expect(ages[2]).toEqual({ Position: 0, CarData: 2_000 })
  })

  it('leaves a feed a driver never appeared on absent — unknown, not fresh', () => {
    const tracker = new DriverFeedTracker()
    tracker.observe('TimingData', [timing(1, 1, 2)], true)
    tracker.observe('CarData', [carData(1, 1)], true)

    const ages = tracker.ages({ TimingData: 0, CarData: 0 })
    expect(ages[2]).toEqual({ TimingData: 0 })
    expect('CarData' in (ages[2] ?? {})).toBe(false)
  })

  it('omits a topic whose own feed age is unknown', () => {
    const tracker = new DriverFeedTracker()
    tracker.observe('Position', [position(1, 1)], true)
    expect(tracker.ages({})).toEqual({})
  })

  it('folds increments into the existing state without rescanning', () => {
    const tracker = new DriverFeedTracker()
    tracker.observe('TimingData', [timing(10, 1, 2)], true)
    tracker.observe('TimingData', [timing(40, 1)], false)

    const ages = tracker.ages({ TimingData: 0 })
    expect(ages[1]).toEqual({ TimingData: 0 })
    expect(ages[2]).toEqual({ TimingData: 30_000 })
  })

  it('discards earlier state when a full buffer replaces it', () => {
    const tracker = new DriverFeedTracker()
    tracker.observe('TimingData', [timing(10, 1, 2)], true)
    tracker.observe('TimingData', [timing(5, 3)], true)

    expect(Object.keys(tracker.ages({ TimingData: 0 }))).toEqual(['3'])
  })

  it('ignores non-numeric keys and malformed payloads', () => {
    const tracker = new DriverFeedTracker()
    const junk: F1StreamPoint[] = [
      { t: 1, d: null },
      { t: 2, d: { Lines: { _deleted: ['1'], x: {} } } },
      { t: 3, d: { Lines: 'nope' } }
    ]
    expect(() => tracker.observe('TimingData', junk, true)).not.toThrow()
    expect(tracker.ages({ TimingData: 0 })).toEqual({})
  })

  it('clears everything on reset', () => {
    const tracker = new DriverFeedTracker()
    tracker.observe('Position', [position(1, 1)], true)
    tracker.reset()
    expect(tracker.ages({ Position: 0 })).toEqual({})
  })
})

describe('staleDriverFeeds', () => {
  const thresholds = DRIVER_STALE_MS

  it('returns null when nothing is stale or nothing is known', () => {
    expect(staleDriverFeeds(undefined, { TimingData: 0 })).toBeNull()
    expect(staleDriverFeeds({}, { TimingData: 0 })).toBeNull()
    expect(
      staleDriverFeeds({ TimingData: thresholds.TimingData - 1 }, { TimingData: 0 })
    ).toBeNull()
  })

  it('flags a feed once the driver is at or past that feed threshold while the feed itself is fresh', () => {
    const stale = staleDriverFeeds(
      { TimingData: thresholds.TimingData, CarData: 100 },
      { TimingData: 200, CarData: 200 }
    )
    expect(stale).toEqual([{ feed: 'TimingData', ageMs: thresholds.TimingData }])
  })

  it('uses a tighter threshold for the high-rate feeds than for timing', () => {
    expect(thresholds.CarData).toBeLessThan(thresholds.TimingData)
    expect(thresholds.Position).toBeLessThan(thresholds.TimingData)
    const stale = staleDriverFeeds({ CarData: thresholds.CarData }, { CarData: 0 })
    expect(stale?.map((s) => s.feed)).toEqual(['CarData'])
  })

  it('defers to the feed-level stale badge when the whole feed is stale', () => {
    const past = thresholds.TimingData + 5_000
    expect(staleDriverFeeds({ TimingData: past }, { TimingData: past })).toBeNull()
  })

  it('does not flag when the feed-level freshness is unknown', () => {
    expect(staleDriverFeeds({ TimingData: 60_000 }, undefined)).toBeNull()
  })
})

// A mid-race live poll where driver 2 stops updating while everyone else keeps going.
describe('F1LiveProvider per-driver freshness (live)', () => {
  const session = buildSyntheticSession({ durationSec: 200, timingRate: 2, seed: 9 })

  function deltaWith(
    from: number,
    to: number,
    extra: Record<string, F1StreamPoint[]>
  ): F1LiveDataDelta {
    const delta = liveDeltaFor(session, from, to)
    return { ...delta, streams: { ...delta.streams, ...extra } as F1LiveDataDelta['streams'] }
  }

  beforeEach(() => {
    ipc.getLive.mockReset()
    vi.useRealTimers()
  })

  it('exposes per-driver ages on live snapshots, separate from the drivers array', async () => {
    const provider = new F1LiveProvider()
    ipc.getLive.mockResolvedValueOnce(
      deltaWith(-1, 60, { Position: [position(50, 1, 2), position(60, 1)] })
    )
    await provider.loadSession('live')

    const snap = provider.getSnapshotAt(60)
    expect(snap.driverFreshness).toBeDefined()
    expect(snap.driverFreshness?.[1]?.Position).toBeLessThan(1_000)
    // Driver 2's last Position point is 10 s behind the feed head.
    expect(snap.driverFreshness?.[2]?.Position).toBeGreaterThanOrEqual(10_000)
  })

  it('keeps the drivers array identity while freshness changes between polls', async () => {
    const provider = new F1LiveProvider()
    ipc.getLive.mockResolvedValueOnce(deltaWith(-1, 60, { Position: [position(60, 1, 2)] }))
    await provider.loadSession('live')
    const first = provider.getSnapshotAt(60)

    const next = deltaWith(60, 70, { Position: [position(70, 1)] })
    ipc.getLive.mockResolvedValueOnce(next)
    await provider.loadSession('live')
    const second = provider.getSnapshotAt(70)

    expect(second.drivers).toBe(first.drivers)
    expect(second.driverFreshness?.[2]?.Position).toBeGreaterThanOrEqual(10_000)
    expect(second.driverFreshness?.[1]?.Position).toBeLessThan(1_000)
  })

  it('folds in increments after the first poll', async () => {
    const provider = new F1LiveProvider()
    ipc.getLive.mockResolvedValueOnce(deltaWith(-1, 60, { CarData: [carData(60, 1, 2)] }))
    await provider.loadSession('live')

    ipc.getLive.mockResolvedValueOnce(deltaWith(60, 90, { CarData: [carData(90, 1)] }))
    await provider.loadSession('live')

    const snap = provider.getSnapshotAt(90)
    expect(snap.driverFreshness?.[1]?.CarData).toBeLessThan(1_000)
    expect(snap.driverFreshness?.[2]?.CarData).toBeGreaterThanOrEqual(30_000)
  })

  it('is undefined outside a live session — staleness is meaningless in replay', async () => {
    ipc.loadSession.mockResolvedValue({
      ...session,
      streams: { ...session.streams, Position: [position(5, 1)] }
    })
    ipc.loadSessionEnrichment.mockResolvedValue({
      carData: [],
      position: [],
      duration: 1,
      nextCarDataOffset: 0,
      nextPositionOffset: 0,
      done: true
    })
    const provider = new F1LiveProvider()
    await provider.loadSession(session.summary.path)

    expect(provider.getSnapshotAt(10).driverFreshness).toBeUndefined()
  })

  it('forgets the previous live session when the socket generation changes', async () => {
    const provider = new F1LiveProvider()
    ipc.getLive.mockResolvedValueOnce(deltaWith(-1, 60, { Position: [position(60, 1, 2)] }))
    await provider.loadSession('live')

    ipc.getLive.mockResolvedValueOnce({
      ...deltaWith(-1, 30, { Position: [position(30, 3)] }),
      generation: 2
    })
    await provider.loadSession('live')

    const fresh = provider.getSnapshotAt(30).driverFreshness ?? {}
    const withPosition = Object.entries(fresh)
      .filter(([, feeds]) => feeds.Position !== undefined)
      .map(([driver]) => driver)
    expect(withPosition).toEqual(['3'])
  })
})
