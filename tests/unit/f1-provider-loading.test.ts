import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { F1LiveDataDelta, F1SessionData } from '@shared/f1live'

const ipc = vi.hoisted(() => ({
  loadSession: vi.fn(),
  loadSessionEnrichment: vi.fn(),
  getLive: vi.fn()
}))
const storeMem = vi.hoisted(() => new Map<string, unknown>())

vi.mock('@renderer/lib/ipc', () => ({
  hasBridge: () => true,
  bridge: () => ({ f1: ipc })
}))

// Deterministic Map-backed persistence so the meeting-scoped track-path cache
// can be seeded and inspected directly.
vi.mock('@renderer/store/persist', () => ({
  persist: {
    get: async (namespace: string, key: string) => storeMem.get(`${namespace}:${key}`) ?? null,
    set: async (namespace: string, key: string, value: unknown) => {
      storeMem.set(`${namespace}:${key}`, value)
    },
    remove: async (namespace: string, key: string) => {
      storeMem.delete(`${namespace}:${key}`)
    },
    all: async () => ({}),
    __resetMemory: () => storeMem.clear()
  }
}))

import { F1LiveProvider } from '@renderer/core/providers/F1LiveProvider'
import { DataProviderManager } from '@renderer/core/DataProviderManager'

const archive: F1SessionData = {
  summary: {
    path: '2026/Test_Grand_Prix/2026-01-01_Race/', key: 1, year: 2026,
    meetingName: 'Test Grand Prix', meetingOfficialName: null, name: 'Race', type: 'Race',
    number: 1, circuitShortName: 'Test', countryName: 'Test', countryCode: 'TST', location: 'Test',
    startDate: null, endDate: null, gmtOffset: '+00:00:00', archiveStatus: 'Complete'
  },
  sessionInfo: {},
  streams: { DriverList: [], TimingData: [], TimingAppData: [] },
  duration: 10
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

function liveDelta(generation: number, t: number): F1LiveDataDelta {
  return {
    ...archive,
    summary: { ...archive.summary, path: 'live', liveStreamActive: true },
    streams: { ...archive.streams, TimingData: [{ t, d: { Lines: {} } }] },
    duration: t,
    cursors: { TimingData: 1 },
    generation
  }
}

describe('F1 provider session boundaries', () => {
  beforeEach(() => {
    ipc.loadSession.mockReset().mockResolvedValue(archive)
    ipc.loadSessionEnrichment.mockReset().mockResolvedValue({
      carData: [], position: [], duration: 10,
      nextCarDataOffset: 0, nextPositionOffset: 0, done: true
    })
    ipc.getLive.mockReset()
    storeMem.clear()
  })

  afterEach(async () => {
    // Archive enrichment is intentionally fire-and-forget; let its renderer
    // yields settle before the next test replaces the IPC mock.
    await new Promise((resolve) => setTimeout(resolve, 20))
  })

  it('resets live cursors when switching to an archive session', async () => {
    const provider = new F1LiveProvider()
    const internal = provider as unknown as {
      liveCursors: Record<string, number>
      liveGeneration: number
    }
    internal.liveCursors = { TimingData: 120, CarData: 80 }
    internal.liveGeneration = 7

    await provider.loadSession(archive.summary.path)

    expect(internal.liveCursors).toEqual({})
    expect(internal.liveGeneration).toBe(0)
  })

  it('replaces stale live state when the socket generation changes', async () => {
    const provider = new F1LiveProvider()
    ipc.getLive
      .mockResolvedValueOnce(liveDelta(1, 10))
      .mockResolvedValueOnce(liveDelta(2, 4))

    await provider.loadSession('live')
    await provider.loadSession('live')

    const internal = provider as unknown as { data: F1SessionData }
    expect(internal.data.streams.TimingData?.map((point) => point.t)).toEqual([4])
    expect(internal.data.duration).toBe(4)
  })

  it('exposes the first reconstructed timing frame as the archive start', async () => {
    ipc.loadSession.mockResolvedValue({
      ...archive,
      streams: {
        ...archive.streams,
        DriverList: [{ t: 1, d: { '1': { RacingNumber: '1', Tla: 'TST' } } }],
        TimingData: [{ t: 3.5, d: { Lines: { '1': { Position: '1' } } } }]
      }
    })
    const provider = new F1LiveProvider()

    await provider.loadSession(archive.summary.path)

    expect(provider.getInitialClock()).toBe(3.5)
    expect(provider.getSnapshotAt(provider.getInitialClock()).timing).toHaveLength(1)
  })

  it('publishes position before requesting telemetry', async () => {
    const requested: string[] = []
    ipc.loadSessionEnrichment.mockImplementation((request: { feed: 'position' | 'carData' }) => {
      requested.push(request.feed)
      return Promise.resolve(request.feed === 'position'
        ? {
            carData: [], position: [{ t: 2, d: { Position: [] } }], duration: 2,
            nextCarDataOffset: 0, nextPositionOffset: 1, done: true
          }
        : {
            carData: [{ t: 3, d: { Entries: [] } }], position: [], duration: 3,
            nextCarDataOffset: 1, nextPositionOffset: 0, done: true
          })
    })
    const provider = new F1LiveProvider()
    const states: Array<[number, number]> = []
    const internal = provider as unknown as {
      positionPoints: unknown[]
      carDataPoints: unknown[]
    }
    provider.onUpdate(() => states.push([internal.positionPoints.length, internal.carDataPoints.length]))

    await provider.loadSession(archive.summary.path)
    await vi.waitFor(() => expect(requested).toEqual(['position', 'carData']))
    await vi.waitFor(() => expect(states).toContainEqual([1, 1]))

    expect(states[0]).toEqual([1, 0])
  })

  it('processes only appended points on a continuing live poll', async () => {
    const lapPoint = (t: number, laps: number) => ({
      t,
      d: { Lines: { '1': { Position: '1', NumberOfLaps: laps, LastLapTime: { Value: '1:30.000' } } } }
    })
    const delta1: F1LiveDataDelta = {
      ...archive,
      summary: { ...archive.summary, path: 'live', liveStreamActive: true },
      streams: {
        DriverList: [{ t: 0, d: { '1': { RacingNumber: '1', Tla: 'TST' } } }],
        TimingData: [lapPoint(10, 1)],
        TimingAppData: []
      },
      duration: 10,
      cursors: { TimingData: 1 },
      generation: 1
    }
    const delta2: F1LiveDataDelta = {
      ...delta1,
      streams: { TimingData: [lapPoint(20, 2)] },
      duration: 20,
      cursors: { TimingData: 2 }
    }
    ipc.getLive.mockResolvedValueOnce(delta1).mockResolvedValueOnce(delta2)
    const provider = new F1LiveProvider()
    const internal = provider as unknown as {
      lapBuild: { processedTiming: number }
      cursorT: number
    }

    await provider.loadSession('live')
    provider.getSnapshotAt(10)
    const processedAfterFirst = internal.lapBuild.processedTiming
    const cursorAfterFirst = internal.cursorT

    await provider.loadSession('live')

    expect(processedAfterFirst).toBe(1)
    expect(internal.lapBuild.processedTiming).toBe(2)
    // The forward-merge cursor survives a continuing poll instead of resetting
    // and re-merging the whole session on the next snapshot.
    expect(internal.cursorT).toBe(cursorAfterFirst)
    expect(provider.getDriverLaps(1)).toHaveLength(2)
    expect(provider.getSnapshotAt(20).timing).toHaveLength(1)
  })

  it('records a completed lap when the count and lap time arrive in separate patches', async () => {
    // Patch-only scanning must still read values MERGED from earlier patches:
    // here the lap time lands first, then a later patch bumps NumberOfLaps
    // without repeating the time.
    ipc.loadSession.mockResolvedValue({
      ...archive,
      duration: 20,
      streams: {
        ...archive.streams,
        DriverList: [{ t: 0, d: { '1': { RacingNumber: '1', Tla: 'TST' } } }],
        TimingData: [
          { t: 5, d: { Lines: { '1': { Position: '1', LastLapTime: { Value: '1:29.500' } } } } },
          { t: 10, d: { Lines: { '1': { NumberOfLaps: 1 } } } }
        ]
      }
    })
    const provider = new F1LiveProvider()

    await provider.loadSession(archive.summary.path)

    const laps = provider.getDriverLaps(1)
    expect(laps).toHaveLength(1)
    expect(laps[0].lapNumber).toBe(1)
    expect(laps[0].lapTime).toBeCloseTo(89.5, 3)
  })

  it('streams and preprocesses a partial timing tail before the session is loaded', async () => {
    const lapPoint = (t: number, laps: number) => ({
      t,
      d: { Lines: { '1': { Position: '1', NumberOfLaps: laps, LastLapTime: { Value: '1:31.000' } } } }
    })
    ipc.loadSession.mockResolvedValue({
      ...archive,
      duration: 5,
      partialTiming: true,
      streams: {
        ...archive.streams,
        DriverList: [{ t: 1, d: { '1': { RacingNumber: '1', Tla: 'TST' } } }],
        TimingData: [lapPoint(5, 1)]
      }
    })
    ipc.loadSessionEnrichment.mockImplementation((request: { feed: string }) => {
      if (request.feed === 'timing') {
        return Promise.resolve({
          carData: [], position: [], timing: [lapPoint(15, 2)], duration: 15,
          nextCarDataOffset: 0, nextPositionOffset: 0, nextTimingOffset: 2, done: true
        })
      }
      return Promise.resolve({
        carData: [], position: [], duration: 15,
        nextCarDataOffset: 0, nextPositionOffset: 0, done: true
      })
    })
    const provider = new F1LiveProvider()

    await provider.loadSession(archive.summary.path)

    expect(provider.getDriverLaps(1)).toHaveLength(2)
    expect(provider.getInitialClock()).toBe(5)
    expect(provider.getDuration()).toBeGreaterThanOrEqual(15)
    expect(provider.getSnapshotAt(15).timing[0]?.lapNumber).toBe(2)
  })

  it('publishes the map from a streamed prefix once a full lap closes', async () => {
    // ~3.8 km circular lap (coordinates are ~decimetres) split across chunks.
    const lapChunk = (fromStep: number, toStep: number) =>
      Array.from({ length: toStep - fromStep + 1 }, (_, index) => {
        const angle = (2 * Math.PI * (fromStep + index)) / 60
        return {
          t: fromStep + index,
          d: {
            Position: {
              '0': { Entries: { '1': { X: 6000 * Math.cos(angle), Y: 6000 * Math.sin(angle), Z: 0 } } }
            }
          }
        }
      })
    let tailRequested = false
    let carDataRequested = false
    ipc.loadSessionEnrichment.mockImplementation((request: { feed: string; positionOffset: number }) => {
      if (request.feed !== 'position') {
        carDataRequested = true
        return Promise.resolve({
          carData: [], position: [], duration: 61,
          nextCarDataOffset: 0, nextPositionOffset: 0, done: true
        })
      }
      if (request.positionOffset === 0) {
        return Promise.resolve({
          carData: [], position: lapChunk(0, 60), duration: 60,
          nextCarDataOffset: 0, nextPositionOffset: 61, done: false
        })
      }
      // The tail of the feed never arrives in this test: the map must already
      // be published from the closed-lap prefix alone.
      tailRequested = true
      return new Promise(() => {})
    })
    ipc.loadSession.mockResolvedValue({
      ...archive,
      duration: 61,
      streams: {
        ...archive.streams,
        DriverList: [{ t: 0, d: { '1': { RacingNumber: '1', Tla: 'TST' } } }],
        TimingData: [{ t: 0, d: { Lines: { '1': { Position: '1' } } } }]
      }
    })
    const provider = new F1LiveProvider()

    await provider.loadSession(archive.summary.path)
    await vi.waitFor(() => expect(tailRequested).toBe(true))

    const snapshot = provider.getSnapshotAt(30)
    expect(snapshot.trackPath.length).toBeGreaterThan(50)
    expect(snapshot.availability.positions).toBe(true)
    // Telemetry starts overlapping the position tail once the map is live —
    // it must not wait for the whole Position download.
    await vi.waitFor(() => expect(carDataRequested).toBe(true))
    // Closing a lap persists the circuit outline under the meeting key.
    await vi.waitFor(() =>
      expect(storeMem.get('trackpaths:2026/Test_Grand_Prix')).toBeDefined()
    )
    provider.cancelPendingLoads()
  })

  it('publishes the map from the first chunk when the weekend outline is cached', async () => {
    // A previously-proven outline for this meeting lives in the store.
    const cachedPath = Array.from({ length: 40 }, (_, index) => ({ x: index * 10, y: index }))
    storeMem.set('trackpaths:2026/Test_Grand_Prix', cachedPath)

    let positionChunks = 0
    ipc.loadSessionEnrichment.mockImplementation((request: { feed: string; positionOffset: number }) => {
      if (request.feed !== 'position') {
        return Promise.resolve({
          carData: [], position: [], duration: 5,
          nextCarDataOffset: 0, nextPositionOffset: 0, done: true
        })
      }
      positionChunks += 1
      // A single short prefix — nowhere near a closed lap.
      return Promise.resolve({
        carData: [],
        position: [{ t: 1, d: { Position: { '0': { Entries: { '1': { X: 0, Y: 0, Z: 0 } } } } } }],
        duration: 1,
        nextCarDataOffset: 0, nextPositionOffset: 1, done: true
      })
    })
    ipc.loadSession.mockResolvedValue({
      ...archive,
      duration: 5,
      streams: {
        ...archive.streams,
        DriverList: [{ t: 0, d: { '1': { RacingNumber: '1', Tla: 'TST' } } }],
        TimingData: [{ t: 0, d: { Lines: { '1': { Position: '1' } } } }]
      }
    })
    const provider = new F1LiveProvider()

    await provider.loadSession(archive.summary.path)
    await vi.waitFor(() => expect(positionChunks).toBeGreaterThan(0))

    const snapshot = provider.getSnapshotAt(1)
    // The map is live from the cached outline plus the very first coordinate —
    // no closed lap required.
    expect(snapshot.trackPath).toEqual(cachedPath)
    expect(snapshot.availability.positions).toBe(true)
    provider.cancelPendingLoads()
  })

  it('stops applying enrichment chunks after the load is superseded', async () => {
    ipc.loadSessionEnrichment.mockImplementation((request: { feed: string; positionOffset: number }) => {
      if (request.feed !== 'position') {
        return Promise.resolve({
          carData: [], position: [], duration: 0,
          nextCarDataOffset: 0, nextPositionOffset: 0, done: true
        })
      }
      const offset = request.positionOffset
      return Promise.resolve({
        carData: [], position: [{ t: offset + 1, d: { Position: [] } }], duration: offset + 1,
        nextCarDataOffset: 0, nextPositionOffset: offset + 1, done: false
      })
    })
    const provider = new F1LiveProvider()
    const internal = provider as unknown as { positionPoints: unknown[] }

    await provider.loadSession(archive.summary.path)
    await vi.waitFor(() => expect(internal.positionPoints.length).toBeGreaterThan(0))
    provider.cancelPendingLoads()
    const applied = internal.positionPoints.length

    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(internal.positionPoints.length).toBe(applied)
  })

  it('rejects a core load cancelled by a provider switch', async () => {
    const pending = deferred<F1SessionData>()
    ipc.loadSession.mockReturnValue(pending.promise)
    const provider = new F1LiveProvider()

    const loading = provider.loadSession(archive.summary.path)
    provider.cancelPendingLoads()
    pending.resolve(archive)

    await expect(loading).rejects.toThrow('superseded')
    expect(ipc.loadSessionEnrichment).not.toHaveBeenCalled()

    const pendingLive = deferred<F1LiveDataDelta>()
    ipc.getLive.mockReturnValue(pendingLive.promise)
    const liveProvider = new F1LiveProvider()
    const liveInternal = liveProvider as unknown as {
      liveCursors: Record<string, number>
      liveGeneration: number
    }
    const liveLoading = liveProvider.loadSession('live')
    liveProvider.cancelPendingLoads()
    pendingLive.resolve(liveDelta(9, 5))

    await expect(liveLoading).rejects.toThrow('superseded')
    expect(liveInternal.liveCursors).toEqual({})
    expect(liveInternal.liveGeneration).toBe(0)
  })

  it('cancels pending work when the active provider is selected again', () => {
    const manager = new DataProviderManager()
    manager.setActive('f1live')
    const cancel = vi.spyOn(manager.active, 'cancelPendingLoads')

    manager.setActive('f1live')

    expect(cancel).toHaveBeenCalledOnce()
  })
})
