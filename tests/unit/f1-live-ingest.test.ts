import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { F1StreamPoint } from '@shared/f1live'
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
const store = vi.hoisted(() => new Map<string, unknown>())

vi.mock('@renderer/lib/ipc', () => ({
  hasBridge: () => true,
  bridge: () => ({ f1: ipc })
}))
// Applies the real main-process key validator, as the IPC boundary does in production:
// a permissive fake hid an index key that the validator rejects.
vi.mock('@renderer/store/persist', async () => {
  const { toStorageKey } = await import('../../src/main/ipc/validate')
  return {
    persist: {
      get: async (namespace: string, key: string) =>
        store.get(`${namespace}:${toStorageKey(key)}`) ?? null,
      set: async (namespace: string, key: string, value: unknown) => {
        store.set(`${namespace}:${toStorageKey(key)}`, value)
      },
      remove: async (namespace: string, key: string) => {
        store.delete(`${namespace}:${toStorageKey(key)}`)
      },
      all: async (namespace: string) => {
        const out: Record<string, unknown> = {}
        for (const [k, v] of store) {
          if (k.startsWith(`${namespace}:`)) out[k.slice(namespace.length + 1)] = v
        }
        return out
      },
      __resetMemory: () => undefined
    }
  }
})
// Count trace builds made by the provider itself (calls inside f1normalize are not counted).
vi.mock('@renderer/core/providers/f1normalize', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@renderer/core/providers/f1normalize')>()
  return { ...actual, buildTrackPath: vi.fn(actual.buildTrackPath) }
})

import {
  F1LiveProvider,
  TRACK_PATH_CACHE_SCHEMA_VERSION,
  saveBoundedTrackPath
} from '@renderer/core/providers/F1LiveProvider'
import { buildClosedTrackPath, buildTrackPath } from '@renderer/core/providers/f1normalize'
import { TRACK_PATH_INDEX_KEY } from '@renderer/core/providers/f1/trackPathCache'

const NS = 'trackpaths'

interface Internals {
  timingPoints: F1StreamPoint[]
  carDataPoints: F1StreamPoint[]
  ersPoints: { t: number }[]
  ersProcessed: number
  trackPathClosed: boolean
  positionPoints: F1StreamPoint[]
}

const internals = (p: F1LiveProvider): Internals => p as unknown as Internals

async function poll(
  provider: F1LiveProvider,
  session: ReturnType<typeof buildSyntheticSession>,
  from: number,
  to: number,
  tweak?: (delta: ReturnType<typeof liveDeltaFor>) => void
): Promise<void> {
  const delta = liveDeltaFor(session, from, to)
  tweak?.(delta)
  ipc.getLive.mockResolvedValueOnce(delta)
  await provider.loadSession('live')
}

beforeEach(() => {
  store.clear()
  ipc.getLive.mockReset()
  vi.mocked(buildTrackPath).mockClear()
})

describe('live ingest: driver list identity', () => {
  const session = buildSyntheticSession({ durationSec: 120, timingRate: 2, seed: 3 })

  it('keeps the same drivers array across polls that carry no DriverList change', async () => {
    const provider = new F1LiveProvider()
    await poll(provider, session, -1, 30)
    const first = provider.getSnapshotAt(28).drivers
    await poll(provider, session, 30, 31)
    await poll(provider, session, 31, 32)
    expect(provider.getSnapshotAt(30).drivers).toBe(first)
  })

  it('publishes a new array with the new driver when the DriverList changes', async () => {
    const provider = new F1LiveProvider()
    await poll(provider, session, -1, 30)
    const first = provider.getSnapshotAt(28).drivers
    await poll(provider, session, 30, 31, (delta) => {
      delta.streams.DriverList = [
        { t: 30.5, d: { '99': { RacingNumber: '99', Tla: 'NEW', TeamName: 'Team X' } } }
      ]
    })
    const next = provider.getSnapshotAt(30).drivers
    expect(next).not.toBe(first)
    expect(next.map((d) => d.number)).toEqual([...first.map((d) => d.number), 99])
    expect(next.find((d) => d.number === 99)?.code).toBe('NEW')
    // Everyone else is unchanged by the edit.
    expect(next.slice(0, first.length)).toEqual(first)
  })
})

describe('live ingest: stream growth', () => {
  const session = buildSyntheticSession({ durationSec: 120, timingRate: 4, seed: 5 })

  it('appends to its own copy in place and never edits the socket payload', async () => {
    const provider = new F1LiveProvider()
    const firstDelta = liveDeltaFor(session, -1, 20)
    const payloadLength = firstDelta.streams.TimingData.length
    ipc.getLive.mockResolvedValueOnce(firstDelta)
    await provider.loadSession('live')

    await poll(provider, session, 20, 21) // first append: copies once
    const owned = internals(provider).timingPoints
    await poll(provider, session, 21, 22)
    await poll(provider, session, 22, 23)

    expect(internals(provider).timingPoints).toBe(owned)
    expect(owned.length).toBe(session.streams.TimingData.filter((p) => p.t <= 23).length)
    expect(firstDelta.streams.TimingData).toHaveLength(payloadLength)
  })

  it('still surfaces new points in memoised feeds after an in-place append', async () => {
    const provider = new F1LiveProvider()
    await poll(provider, session, -1, 20)
    await poll(provider, session, 20, 21)
    const before = provider.getSnapshotAt(60).raceControl.length
    await poll(provider, session, 21, 90) // brings the race-control message at t=45
    expect(provider.getSnapshotAt(90).raceControl.length).toBeGreaterThan(before)
    expect(provider.getSnapshotAt(90).timing.length).toBe(20)
  })
})

describe('live ingest: ERS retention follows the CarData window', () => {
  const carPoint = (t: number): F1StreamPoint => ({
    t,
    d: {
      Entries: [{ Cars: { '1': { Channels: { '0': 9000, '2': 250, '4': 100, '5': 0, '45': 0 } } } }]
    }
  })

  it('drops ERS estimates older than the oldest retained CarData point', async () => {
    const session = buildSyntheticSession({ durationSec: 30, timingRate: 1, seed: 2 })
    const provider = new F1LiveProvider()
    const first = liveDeltaFor(session, -1, 30)
    first.streams.CarData = Array.from({ length: 20_200 }, (_, i) => carPoint(i * 0.5))
    ipc.getLive.mockResolvedValueOnce(first)
    await provider.loadSession('live')
    const emitted = internals(provider).ersPoints.length
    expect(emitted).toBeGreaterThan(1000)
    expect(internals(provider).ersPoints[0].t).toBe(0)

    const next = liveDeltaFor(session, 30, 31)
    next.streams.CarData = Array.from({ length: 300 }, (_, i) => carPoint(10_100 + i * 0.5))
    ipc.getLive.mockResolvedValueOnce(next)
    await provider.loadSession('live')

    const carData = internals(provider).carDataPoints
    expect(carData).toHaveLength(20_000)
    expect(internals(provider).ersProcessed).toBe(20_000)
    const ers = internals(provider).ersPoints
    expect(ers[0].t).toBeGreaterThanOrEqual(carData[0].t)
    expect(ers[ers.length - 1].t).toBeGreaterThan(10_100)
    expect(ers.length).toBeLessThan(emitted + 300)
  }, 30_000)
})

describe('live ingest: circuit outline attempts', () => {
  /** A session whose only Position feed loops the circuit every 90 s. */
  const lapSession = (() => {
    const s = buildSyntheticSession({ durationSec: 400, timingRate: 1, seed: 9 })
    s.streams.Position = buildCircularPositions([1, 2, 3], 400)
    return s
  })()
  /** A feed that never closes: the car just keeps driving away. */
  const openSession = (() => {
    const s = buildSyntheticSession({ durationSec: 400, timingRate: 1, seed: 9 })
    s.streams.Position = Array.from({ length: 401 }, (_, t) => ({
      t,
      d: { Position: { '0': { Entries: { '1': { X: 100 + t * 300, Y: 50, Z: 1 } } } } }
    }))
    return s
  })()

  it('retraces an unclosed outline once per ~10 s of session time, not once per poll', async () => {
    const provider = new F1LiveProvider()
    await poll(provider, openSession, -1, 40)
    const afterFirst = vi.mocked(buildTrackPath).mock.calls.length
    for (let t = 40; t < 100; t++) await poll(provider, openSession, t, t + 1)
    // 60 one-second polls -> at most one attempt per 10 s window (plus rounding).
    expect(vi.mocked(buildTrackPath).mock.calls.length - afterFirst).toBeLessThanOrEqual(7)
    expect(vi.mocked(buildTrackPath).mock.calls.length - afterFirst).toBeGreaterThanOrEqual(5)
  })

  it('adopts exactly the outline an unthrottled attempt at that moment would have', async () => {
    const provider = new F1LiveProvider()
    await poll(provider, lapSession, -1, 40)
    let adoptedAt = -1
    let pointsThen: F1StreamPoint[] = []
    for (let t = 40; t < 200 && adoptedAt < 0; t++) {
      await poll(provider, lapSession, t, t + 1)
      if (internals(provider).trackPathClosed) {
        adoptedAt = t + 1
        pointsThen = internals(provider).positionPoints.slice()
      }
    }
    expect(adoptedAt).toBeGreaterThan(0)

    // The first moment ANY poll could have closed the loop, ignoring the throttle.
    let firstClosable = -1
    for (let t = 40; t <= adoptedAt; t++) {
      const prefix = lapSession.streams.Position.filter((p) => p.t <= t)
      if (buildClosedTrackPath(prefix)) {
        firstClosable = t
        break
      }
    }
    expect(firstClosable).toBeGreaterThan(0)
    expect(adoptedAt - firstClosable).toBeLessThanOrEqual(10)
    expect(provider.getSnapshotAt(adoptedAt).trackPath).toEqual(buildClosedTrackPath(pointsThen))
  })

  it('never re-attempts once the outline is closed', async () => {
    const provider = new F1LiveProvider()
    await poll(provider, lapSession, -1, 200)
    expect(internals(provider).trackPathClosed).toBe(true)
    vi.mocked(buildTrackPath).mockClear()
    for (let t = 200; t < 260; t++) await poll(provider, lapSession, t, t + 1)
    expect(vi.mocked(buildTrackPath)).not.toHaveBeenCalled()
  })
})

describe('circuit outline cache bounds', () => {
  const outline = [{ x: 0, y: 0 }]
  const key = (n: number): string => `v${TRACK_PATH_CACHE_SCHEMA_VERSION}/2026/Meeting_${n}`
  const stored = (): string[] =>
    [...store.keys()].filter(
      (k) => k.startsWith(`${NS}:`) && !k.endsWith(`:${TRACK_PATH_INDEX_KEY}`)
    )

  it('keeps at most 40 outlines, evicting the oldest first', async () => {
    for (let n = 0; n < 45; n++) await saveBoundedTrackPath(key(n), outline)
    const kept = stored()
    expect(kept).toHaveLength(40)
    expect(kept).not.toContain(`${NS}:${key(0)}`)
    expect(kept).not.toContain(`${NS}:${key(4)}`)
    expect(kept).toContain(`${NS}:${key(5)}`)
    expect(kept).toContain(`${NS}:${key(44)}`)
  })

  it('treats a rewritten weekend as the most recent', async () => {
    for (let n = 0; n < 40; n++) await saveBoundedTrackPath(key(n), outline)
    await saveBoundedTrackPath(key(0), outline)
    await saveBoundedTrackPath(key(40), outline)
    const kept = stored()
    expect(kept).toContain(`${NS}:${key(0)}`)
    expect(kept).not.toContain(`${NS}:${key(1)}`)
  })

  it('clears entries from older cache schemas, which can never be read again', async () => {
    store.set(`${NS}:v2/2026/Old_Meeting`, outline)
    store.set(`${NS}:v1/2025/Older_Meeting`, outline)
    await saveBoundedTrackPath(key(1), outline)
    expect(stored()).toEqual([`${NS}:${key(1)}`])
  })

  it('serializes overlapping writes without losing an entry', async () => {
    await Promise.all([1, 2, 3].map((n) => saveBoundedTrackPath(key(n), outline)))
    expect(stored().sort()).toEqual([1, 2, 3].map((n) => `${NS}:${key(n)}`).sort())
  })
})
