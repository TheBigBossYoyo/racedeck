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

import {
  F1LiveProvider,
  TRACK_PATH_CACHE_SCHEMA_VERSION
} from '@renderer/core/providers/F1LiveProvider'

const TRACK_PATH_KEY = `trackpaths:v${TRACK_PATH_CACHE_SCHEMA_VERSION}/2026/Test_Grand_Prix`
import { DataProviderManager } from '@renderer/core/DataProviderManager'

const archive: F1SessionData = {
  summary: {
    path: '2026/Test_Grand_Prix/2026-01-01_Race/',
    key: 1,
    year: 2026,
    meetingName: 'Test Grand Prix',
    meetingOfficialName: null,
    name: 'Race',
    type: 'Race',
    number: 1,
    circuitShortName: 'Test',
    countryName: 'Test',
    countryCode: 'TST',
    location: 'Test',
    startDate: null,
    endDate: null,
    gmtOffset: '+00:00:00',
    archiveStatus: 'Complete'
  },
  sessionInfo: {},
  streams: { DriverList: [], TimingData: [], TimingAppData: [] },
  duration: 10
}

function archiveSession(path: string, streams: Partial<F1SessionData['streams']>): F1SessionData {
  return {
    ...archive,
    summary: {
      ...archive.summary,
      path,
      key: path,
      meetingName: path.split('/')[1] ?? archive.summary.meetingName,
      circuitShortName: path.split('/')[1] ?? archive.summary.circuitShortName
    },
    streams: {
      ...archive.streams,
      ...streams
    }
  }
}

function completedLapPoint(lapNumber: number): F1SessionData['streams']['TimingData'][number] {
  return {
    t: lapNumber * 10,
    d: {
      Lines: {
        '1': {
          Position: '1',
          NumberOfLaps: lapNumber,
          LastLapTime: { Value: '1:30.000' }
        }
      }
    }
  }
}

function driverListPoint(): F1SessionData['streams']['DriverList'][number] {
  return { t: 0, d: { '1': { RacingNumber: '1', Tla: 'TST' } } }
}

function positionPoint(
  t: number,
  x: number,
  y: number
): F1SessionData['streams']['Position'][number] {
  return {
    t,
    d: {
      Position: {
        '0': {
          Entries: {
            '1': { X: x, Y: y, Z: 12 }
          }
        }
      }
    }
  }
}

function closedLapPositionPoints(
  startT: number,
  steps = 61
): NonNullable<F1SessionData['streams']['Position']> {
  return Array.from({ length: steps }, (_, index) => {
    const angle = (2 * Math.PI * index) / (steps - 1)
    return positionPoint(startT + index, 6_000 * Math.cos(angle), 6_000 * Math.sin(angle))
  })
}

function exactClosedCachedPath(): { x: number; y: number }[] {
  const path = Array.from({ length: 40 }, (_, index) => ({ x: index * 10, y: index }))
  return [...path, path[0]]
}

function legacyOpenCachedPath(): { x: number; y: number }[] {
  return Array.from({ length: 40 }, (_, index) => ({ x: index * 10, y: index }))
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
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
      carData: [],
      position: [],
      duration: 10,
      nextCarDataOffset: 0,
      nextPositionOffset: 0,
      done: true
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
    ipc.getLive.mockResolvedValueOnce(liveDelta(1, 10)).mockResolvedValueOnce(liveDelta(2, 4))

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
      return Promise.resolve(
        request.feed === 'position'
          ? {
              carData: [],
              position: [{ t: 2, d: { Position: [] } }],
              duration: 2,
              nextCarDataOffset: 0,
              nextPositionOffset: 1,
              done: true
            }
          : {
              carData: [{ t: 3, d: { Entries: [] } }],
              position: [],
              duration: 3,
              nextCarDataOffset: 1,
              nextPositionOffset: 0,
              done: true
            }
      )
    })
    const provider = new F1LiveProvider()
    const states: Array<[number, number]> = []
    const internal = provider as unknown as {
      positionPoints: unknown[]
      carDataPoints: unknown[]
    }
    provider.onUpdate(() =>
      states.push([internal.positionPoints.length, internal.carDataPoints.length])
    )

    await provider.loadSession(archive.summary.path)
    await vi.waitFor(() => expect(requested).toEqual(['position', 'carData']))
    await vi.waitFor(() => expect(states).toContainEqual([1, 1]))

    expect(states[0]).toEqual([1, 0])
  })

  it('processes only appended points on a continuing live poll', async () => {
    const lapPoint = (t: number, laps: number) => ({
      t,
      d: {
        Lines: { '1': { Position: '1', NumberOfLaps: laps, LastLapTime: { Value: '1:30.000' } } }
      }
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
      d: {
        Lines: { '1': { Position: '1', NumberOfLaps: laps, LastLapTime: { Value: '1:31.000' } } }
      }
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
          carData: [],
          position: [],
          timing: [lapPoint(15, 2)],
          duration: 15,
          nextCarDataOffset: 0,
          nextPositionOffset: 0,
          nextTimingOffset: 2,
          done: true
        })
      }
      return Promise.resolve({
        carData: [],
        position: [],
        duration: 15,
        nextCarDataOffset: 0,
        nextPositionOffset: 0,
        done: true
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
              '0': {
                Entries: { '1': { X: 6000 * Math.cos(angle), Y: 6000 * Math.sin(angle), Z: 0 } }
              }
            }
          }
        }
      })
    let tailRequested = false
    let carDataRequested = false
    ipc.loadSessionEnrichment.mockImplementation(
      (request: { feed: string; positionOffset: number }) => {
        if (request.feed !== 'position') {
          carDataRequested = true
          return Promise.resolve({
            carData: [],
            position: [],
            duration: 61,
            nextCarDataOffset: 0,
            nextPositionOffset: 0,
            done: true
          })
        }
        if (request.positionOffset === 0) {
          return Promise.resolve({
            carData: [],
            position: lapChunk(0, 60),
            duration: 60,
            nextCarDataOffset: 0,
            nextPositionOffset: 61,
            done: false
          })
        }
        // The tail of the feed never arrives in this test: the map must already
        // be published from the closed-lap prefix alone.
        tailRequested = true
        return new Promise(() => {})
      }
    )
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
    await vi.waitFor(() => expect(storeMem.get(TRACK_PATH_KEY)).toBeDefined())
    provider.cancelPendingLoads()
  })

  it('publishes the map from the first chunk when the weekend outline is cached', async () => {
    // A previously-proven outline for this meeting lives in the store.
    const cachedPath = exactClosedCachedPath()
    storeMem.set(TRACK_PATH_KEY, cachedPath)

    let positionChunks = 0
    ipc.loadSessionEnrichment.mockImplementation(
      (request: { feed: string; positionOffset: number }) => {
        if (request.feed !== 'position') {
          return Promise.resolve({
            carData: [],
            position: [],
            duration: 5,
            nextCarDataOffset: 0,
            nextPositionOffset: 0,
            done: true
          })
        }
        positionChunks += 1
        // A single short prefix — nowhere near a closed lap.
        return Promise.resolve({
          carData: [],
          // A real coordinate: (0,0,0) is the feed's "car not on track" sentinel
          // and is deliberately ignored.
          position: [
            { t: 1, d: { Position: { '0': { Entries: { '1': { X: 120, Y: 340, Z: 12 } } } } } }
          ],
          duration: 1,
          nextCarDataOffset: 0,
          nextPositionOffset: 1,
          done: true
        })
      }
    )
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

  it('rejects a legacy open cached outline until Position enrichment rebuilds an exact closure', async () => {
    storeMem.set(TRACK_PATH_KEY, legacyOpenCachedPath())

    let positionChunks = 0
    ipc.loadSessionEnrichment.mockImplementation(
      (request: { feed: string; positionOffset: number }) => {
        if (request.feed !== 'position') {
          return Promise.resolve({
            carData: [],
            position: [],
            duration: 5,
            nextCarDataOffset: 0,
            nextPositionOffset: 0,
            done: true
          })
        }
        positionChunks += 1
        if (request.positionOffset === 0) {
          return Promise.resolve({
            carData: [],
            position: [positionPoint(1, 120, 340)],
            duration: 1,
            nextCarDataOffset: 0,
            nextPositionOffset: 1,
            done: false
          })
        }
        return Promise.resolve({
          carData: [],
          position: [],
          duration: 1,
          nextCarDataOffset: 0,
          nextPositionOffset: request.positionOffset,
          done: false
        })
      }
    )
    ipc.loadSession.mockResolvedValue({
      ...archive,
      duration: 5,
      streams: {
        ...archive.streams,
        DriverList: [driverListPoint()],
        TimingData: [{ t: 0, d: { Lines: { '1': { Position: '1' } } } }]
      }
    })
    const provider = new F1LiveProvider()

    await provider.loadSession(archive.summary.path)
    await vi.waitFor(() => expect(positionChunks).toBeGreaterThan(0))

    const snapshot = provider.getSnapshotAt(1)
    expect(snapshot.trackPath).toEqual([])
    expect(snapshot.positions[0]).toMatchObject({ driverNumber: 1, x: null, y: null, z: null })
    expect(snapshot.availability.positions).toBe(false)
    provider.cancelPendingLoads()
  })

  it('clears the prior session track outline at a fresh-session boundary', async () => {
    const cachedPath = exactClosedCachedPath()
    const nextSession = archiveSession('2026/Other_Grand_Prix/2026-01-02_Race/', {})
    storeMem.set(TRACK_PATH_KEY, cachedPath)
    ipc.loadSession.mockResolvedValueOnce(archive).mockResolvedValueOnce(nextSession)
    const provider = new F1LiveProvider()

    await provider.loadSession(archive.summary.path)
    expect(provider.getSnapshotAt(0).trackPath).toEqual(cachedPath)

    await provider.loadSession(nextSession.summary.path)

    expect(provider.getSnapshotAt(0).trackPath).toEqual([])
  })

  it('does not reuse stale pit-lap indexes across fresh sessions with equal-length pit feeds', async () => {
    const sessionOne = archiveSession('2026/First_Grand_Prix/2026-01-03_Race/', {
      DriverList: [driverListPoint()],
      TimingData: [1, 2, 3, 4, 5].map(completedLapPoint),
      PitLaneTimeCollection: [{ t: 15, d: { PitTimes: { '1': { Duration: 20, Lap: 1 } } } }]
    })
    const sessionTwo = archiveSession('2026/Second_Grand_Prix/2026-01-04_Race/', {
      DriverList: [driverListPoint()],
      TimingData: [1, 2, 3, 4, 5].map(completedLapPoint),
      PitLaneTimeCollection: [{ t: 45, d: { PitTimes: { '1': { Duration: 20, Lap: 4 } } } }]
    })
    ipc.loadSession.mockResolvedValueOnce(sessionOne).mockResolvedValueOnce(sessionTwo)
    const provider = new F1LiveProvider()

    await provider.loadSession(sessionOne.summary.path)
    const firstLaps = provider.getDriverLaps(1)
    expect(firstLaps.find((lap) => lap.lapNumber === 1)?.isPitInLap).toBe(true)
    expect(firstLaps.find((lap) => lap.lapNumber === 2)?.isPitOutLap).toBe(true)

    await provider.loadSession(sessionTwo.summary.path)
    const secondLaps = provider.getDriverLaps(1)

    expect(secondLaps.find((lap) => lap.lapNumber === 1)?.isPitInLap).toBe(false)
    expect(secondLaps.find((lap) => lap.lapNumber === 2)?.isPitOutLap).toBe(false)
    expect(secondLaps.find((lap) => lap.lapNumber === 4)?.isPitInLap).toBe(true)
    expect(secondLaps.find((lap) => lap.lapNumber === 5)?.isPitOutLap).toBe(true)
  })

  it('keeps partial live Position coordinates hidden until an outline publication gate opens', async () => {
    ipc.getLive.mockResolvedValueOnce({
      ...archive,
      summary: {
        ...archive.summary,
        path: 'live',
        feedPath: archive.summary.path,
        liveStreamActive: true,
        archiveStatus: 'Generating'
      },
      streams: {
        ...archive.streams,
        DriverList: [driverListPoint()],
        TimingData: [{ t: 1, d: { Lines: { '1': { Position: '1' } } } }],
        Position: [positionPoint(1, 120, 340)]
      },
      duration: 1,
      cursors: { TimingData: 1, Position: 1 },
      generation: 1
    })
    const provider = new F1LiveProvider()

    await provider.loadSession('live')

    const snapshot = provider.getSnapshotAt(1)
    expect(snapshot.trackPath).toEqual([])
    expect(snapshot.positions[0]).toMatchObject({ driverNumber: 1, x: null, y: null, z: null })
    expect(snapshot.availability.positions).toBe(false)
  })

  it('keeps the complete-archive open fallback for inline Position data', async () => {
    const inlineArchive = archiveSession(archive.summary.path, {
      DriverList: [driverListPoint()],
      TimingData: [{ t: 1, d: { Lines: { '1': { Position: '1' } } } }],
      Position: [positionPoint(1, 120, 340)]
    })
    ipc.loadSession.mockResolvedValueOnce(inlineArchive)
    const provider = new F1LiveProvider()

    await provider.loadSession(inlineArchive.summary.path)

    const snapshot = provider.getSnapshotAt(1)
    expect(snapshot.positions[0]).toMatchObject({ driverNumber: 1, x: 120, y: 340, z: 12 })
    expect(snapshot.availability.positions).toBe(true)
  })

  it('keeps session-level map availability before the first Position timestamp once the outline is published', async () => {
    const publishedOutlineArchive = archiveSession('2026/Outline_Grand_Prix/2026-01-05_Race/', {
      DriverList: [driverListPoint()],
      TimingData: [{ t: 9, d: { Lines: { '1': { Position: '1' } } } }],
      Position: closedLapPositionPoints(144)
    })
    ipc.loadSession.mockResolvedValueOnce(publishedOutlineArchive)
    const provider = new F1LiveProvider()

    await provider.loadSession(publishedOutlineArchive.summary.path)

    const snapshot = provider.getSnapshotAt(9)
    expect(snapshot.trackPath.length).toBeGreaterThan(50)
    expect(snapshot.positions[0]).toMatchObject({ driverNumber: 1, x: null, y: null, z: null })
    expect(snapshot.availability.positions).toBe(true)
  })

  it('stops applying enrichment chunks after the load is superseded', async () => {
    ipc.loadSessionEnrichment.mockImplementation(
      (request: { feed: string; positionOffset: number }) => {
        if (request.feed !== 'position') {
          return Promise.resolve({
            carData: [],
            position: [],
            duration: 0,
            nextCarDataOffset: 0,
            nextPositionOffset: 0,
            done: true
          })
        }
        const offset = request.positionOffset
        return Promise.resolve({
          carData: [],
          position: [{ t: offset + 1, d: { Position: [] } }],
          duration: offset + 1,
          nextCarDataOffset: 0,
          nextPositionOffset: offset + 1,
          done: false
        })
      }
    )
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

// APP_IMPROVEMENT_ROADMAP.md P0 item 5: stale-feed detection. Wall-clock, so
// only meaningful for a LIVE session; fake timers give deterministic elapsed
// time between polls without a real setTimeout.
describe('F1 provider stale-feed detection', () => {
  beforeEach(() => {
    ipc.loadSession.mockReset().mockResolvedValue(archive)
    ipc.loadSessionEnrichment.mockReset().mockResolvedValue({
      carData: [],
      position: [],
      duration: 10,
      nextCarDataOffset: 0,
      nextPositionOffset: 0,
      done: true
    })
    ipc.getLive.mockReset()
    storeMem.clear()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('reports near-zero freshness for a topic that just received data on a live session', async () => {
    ipc.getLive.mockResolvedValueOnce(liveDelta(1, 10))
    const provider = new F1LiveProvider()

    await provider.loadSession('live')
    const snapshot = provider.getSnapshotAt(provider.getDuration())

    expect(snapshot.feedFreshness?.TimingData).toBe(0)
  })

  it("grows a topic's reported staleness as wall-clock time passes without new data", async () => {
    ipc.getLive.mockResolvedValueOnce(liveDelta(1, 10))
    const provider = new F1LiveProvider()

    await provider.loadSession('live')
    vi.advanceTimersByTime(6_000)
    const snapshot = provider.getSnapshotAt(provider.getDuration())

    expect(snapshot.feedFreshness?.TimingData).toBe(6_000)
  })

  it('only resets freshness for topics that actually received new points on a continuing poll', async () => {
    const delta1: F1LiveDataDelta = {
      ...archive,
      summary: { ...archive.summary, path: 'live', liveStreamActive: true },
      streams: {
        DriverList: [{ t: 0, d: {} }],
        TimingData: [{ t: 10, d: { Lines: {} } }],
        Position: [{ t: 10, d: { Position: [] } }]
      },
      duration: 10,
      cursors: { TimingData: 1, Position: 1 },
      generation: 1
    }
    // Second poll only advances TimingData; Position stays put.
    const delta2: F1LiveDataDelta = {
      ...delta1,
      streams: { TimingData: [{ t: 20, d: { Lines: {} } }] },
      duration: 20,
      cursors: { TimingData: 2, Position: 1 }
    }
    ipc.getLive.mockResolvedValueOnce(delta1).mockResolvedValueOnce(delta2)
    const provider = new F1LiveProvider()

    await provider.loadSession('live')
    vi.advanceTimersByTime(4_000)
    await provider.loadSession('live')

    const snapshot = provider.getSnapshotAt(provider.getDuration())
    expect(snapshot.feedFreshness?.TimingData).toBe(0)
    expect(snapshot.feedFreshness?.Position).toBe(4_000)
  })

  it('omits feed freshness entirely for a replay/archive session', async () => {
    const provider = new F1LiveProvider()

    await provider.loadSession(archive.summary.path)
    const snapshot = provider.getSnapshotAt(0)

    expect(snapshot.feedFreshness).toBeUndefined()
  })

  it('clears stale live freshness state when switching to a replay session', async () => {
    ipc.getLive.mockResolvedValueOnce(liveDelta(1, 10))
    const provider = new F1LiveProvider()
    await provider.loadSession('live')

    await provider.loadSession(archive.summary.path)

    const internal = provider as unknown as { feedLastWallClockMs: Record<string, number> }
    expect(internal.feedLastWallClockMs).toEqual({})
  })
})

describe('F1 provider live track outline', () => {
  /** A live delta whose Position stream traces `steps` of a circle of `radius`. */
  function liveWithArc(
    generation: number,
    steps: number,
    radius = 5_000,
    ofSteps = 60
  ): F1LiveDataDelta {
    const position = Array.from({ length: steps }, (_, i) => {
      const angle = (2 * Math.PI * i) / ofSteps
      return {
        t: i,
        d: {
          Position: {
            '0': {
              Entries: {
                '1': { Status: 'OnTrack', X: radius * Math.cos(angle), Y: radius * Math.sin(angle) }
              }
            }
          }
        }
      }
    })
    return {
      ...archive,
      summary: {
        ...archive.summary,
        path: 'live',
        feedPath: '2026/Test_Grand_Prix/2026-01-01_Race/',
        liveStreamActive: true
      },
      streams: {
        ...archive.streams,
        DriverList: [{ t: 0, d: { '1': { RacingNumber: '1', Tla: 'TST' } } }],
        TimingData: [{ t: 0, d: { Lines: { '1': { Position: '1' } } } }],
        Position: position
      },
      duration: steps,
      cursors: { Position: position.length },
      generation
    }
  }

  beforeEach(() => {
    ipc.loadSession.mockReset().mockResolvedValue(archive)
    ipc.loadSessionEnrichment.mockReset().mockResolvedValue({
      carData: [],
      position: [],
      duration: 10,
      nextCarDataOffset: 0,
      nextPositionOffset: 0,
      done: true
    })
    ipc.getLive.mockReset()
    storeMem.clear()
  })

  it('shows no outline until a car has demonstrably closed a lap', async () => {
    // A third of a lap in. Drawing this as "the circuit" is what made the live
    // map look broken: an arbitrary arc of whatever one car had driven so far.
    ipc.getLive.mockResolvedValue(liveWithArc(1, 20))
    const provider = new F1LiveProvider()
    await provider.loadSession('live')

    expect(provider.getSnapshotAt(19).trackPath).toEqual([])
    // …and nothing partial is written to the weekend's outline cache.
    expect(storeMem.get(TRACK_PATH_KEY)).toBeUndefined()
  })

  it('adopts and caches the outline once the lap closes', async () => {
    ipc.getLive.mockResolvedValue(liveWithArc(1, 61))
    const provider = new F1LiveProvider()
    await provider.loadSession('live')

    expect(provider.getSnapshotAt(60).trackPath.length).toBeGreaterThan(20)
    expect(storeMem.get(TRACK_PATH_KEY)).toBeDefined()
  })

  it('keeps a cached outline instead of replacing it with a partial live trace', async () => {
    // THE LIVE MAP BUG: every poll re-derived the outline from whatever Position
    // data had arrived, so the weekend's proven outline — loaded moments earlier
    // — was overwritten by a fragment on the very next poll.
    const cached = exactClosedCachedPath()
    storeMem.set(TRACK_PATH_KEY, cached)
    ipc.getLive.mockResolvedValue(liveWithArc(1, 15))

    const provider = new F1LiveProvider()
    await provider.loadSession('live')
    expect(provider.getSnapshotAt(14).trackPath).toEqual(cached)

    // A second poll on the same connection, carrying a little more of the arc.
    ipc.getLive.mockResolvedValue(liveWithArc(1, 25))
    await provider.loadSession('live')
    expect(provider.getSnapshotAt(24).trackPath).toEqual(cached)
    expect(storeMem.get(TRACK_PATH_KEY)).toEqual(cached)
  })

  it('treats an entry under the unversioned (pre-schema) key as a miss, not a read of stale-shaped data', async () => {
    // APP_IMPROVEMENT_ROADMAP.md P2 item 32: a cache-shape change must
    // invalidate old entries instead of silently misreading them.
    storeMem.set('trackpaths:2026/Test_Grand_Prix', exactClosedCachedPath())
    ipc.getLive.mockResolvedValue(liveWithArc(1, 20))

    const provider = new F1LiveProvider()
    await provider.loadSession('live')

    expect(provider.getSnapshotAt(19).trackPath).toEqual([])
    expect(provider.getDiagnostics().trackPathCacheStatus).toBe('miss')
  })
})
