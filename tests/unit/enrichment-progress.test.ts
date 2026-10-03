import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { F1SessionData, F1StreamPoint } from '@shared/f1live'
import type { EnrichmentProgress } from '@renderer/core/providers/types'
import {
  buildSystemStatus,
  describeEnrichmentProgress,
  type SystemStatusInputs
} from '@renderer/core/engines/SystemStatus'

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

const PATH = '2026/Test_Grand_Prix/2026-01-01_Race/'

function archive(duration: number): F1SessionData {
  return {
    summary: {
      path: PATH,
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
    duration
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function pts(...times: number[]): F1StreamPoint[] {
  return times.map((t) => ({ t, d: { Position: [] } }))
}

type Feed = 'position' | 'carData'
interface Chunk {
  points: F1StreamPoint[]
  next: number
  done: boolean
}

/** Serve scripted chunks per feed; a chunk may be a promise so a test can hold it. */
function scriptEnrichment(script: Record<Feed, Array<Chunk | Promise<Chunk>>>): void {
  const cursor: Record<Feed, number> = { position: 0, carData: 0 }
  ipc.loadSessionEnrichment.mockImplementation(async (req: { feed: Feed }) => {
    const step = script[req.feed][cursor[req.feed]++]
    const chunk = await step
    return {
      carData: req.feed === 'carData' ? chunk.points : [],
      position: req.feed === 'position' ? chunk.points : [],
      duration: chunk.points[chunk.points.length - 1]?.t ?? 0,
      nextCarDataOffset: req.feed === 'carData' ? chunk.next : 0,
      nextPositionOffset: req.feed === 'position' ? chunk.next : 0,
      done: chunk.done
    }
  })
}

async function progressOf(provider: F1LiveProvider): Promise<EnrichmentProgress | null> {
  return provider.getDiagnostics().enrichmentProgress
}

beforeEach(() => {
  ipc.loadSession.mockReset()
  ipc.loadSessionEnrichment.mockReset()
  ipc.getLive.mockReset()
})

afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 20))
})

describe('F1LiveProvider enrichment progress diagnostics', () => {
  it('reports points and session time applied so far, against the known session length', async () => {
    ipc.loadSession.mockResolvedValue(archive(100))
    const holdSecondPosition = deferred<Chunk>()
    scriptEnrichment({
      position: [{ points: pts(20, 40), next: 2, done: false }, holdSecondPosition.promise],
      carData: [{ points: pts(10), next: 1, done: true }]
    })
    const provider = new F1LiveProvider()

    await provider.loadSession(PATH)
    await vi.waitFor(async () => {
      expect((await progressOf(provider))?.position).toMatchObject({
        state: 'loading',
        pointsApplied: 2,
        coveredSeconds: 40
      })
    })
    const mid = await progressOf(provider)
    expect(mid?.totalSeconds).toBe(100)

    holdSecondPosition.resolve({ points: pts(60), next: 3, done: true })
    await vi.waitFor(async () => {
      const done = await progressOf(provider)
      expect(done?.position).toMatchObject({ state: 'done', pointsApplied: 3, coveredSeconds: 60 })
      expect(done?.carData).toMatchObject({ state: 'done', pointsApplied: 1 })
    })
  })

  it('leaves the total unknown rather than inventing one when the session length is not known', async () => {
    ipc.loadSession.mockResolvedValue(archive(0))
    const hold = deferred<Chunk>()
    scriptEnrichment({
      position: [{ points: pts(5), next: 1, done: false }, hold.promise],
      carData: [{ points: pts(5), next: 1, done: true }]
    })
    const provider = new F1LiveProvider()

    await provider.loadSession(PATH)
    await vi.waitFor(async () =>
      expect((await progressOf(provider))?.position.pointsApplied).toBe(1)
    )

    expect((await progressOf(provider))?.totalSeconds).toBeNull()
    hold.resolve({ points: [], next: 1, done: true })
  })

  it('marks a failed feed as failed and keeps loading the other one', async () => {
    ipc.loadSession.mockResolvedValue(archive(100))
    ipc.loadSessionEnrichment.mockImplementation(async (req: { feed: Feed }) => {
      if (req.feed === 'position') throw new Error('position feed offline')
      return {
        carData: pts(30),
        position: [],
        duration: 30,
        nextCarDataOffset: 1,
        nextPositionOffset: 0,
        done: true
      }
    })
    const provider = new F1LiveProvider()

    await provider.loadSession(PATH)
    await vi.waitFor(async () => {
      const progress = await progressOf(provider)
      expect(progress?.position.state).toBe('failed')
      expect(progress?.carData.state).toBe('done')
    })
    expect(provider.getDiagnostics().enrichmentIssue).toContain('position feed offline')
  })

  it('has no progress for a live session (nothing is being enriched)', async () => {
    const provider = new F1LiveProvider()
    ipc.getLive.mockResolvedValueOnce({
      ...archive(10),
      summary: { ...archive(10).summary, path: 'live', liveStreamActive: true },
      cursors: {},
      generation: 1
    })
    await provider.loadSession('live')
    expect(provider.getDiagnostics().enrichmentProgress).toBeNull()
  })

  it('clears progress when pending loads are cancelled', async () => {
    ipc.loadSession.mockResolvedValue(archive(100))
    const hold = deferred<Chunk>()
    scriptEnrichment({
      position: [{ points: pts(5), next: 1, done: false }, hold.promise],
      carData: [{ points: pts(5), next: 1, done: true }]
    })
    const provider = new F1LiveProvider()
    await provider.loadSession(PATH)
    await vi.waitFor(async () =>
      expect((await progressOf(provider))?.position.pointsApplied).toBe(1)
    )

    provider.cancelPendingLoads()

    expect(provider.getDiagnostics().enrichmentProgress).toBeNull()
    hold.resolve({ points: [], next: 1, done: true })
  })
})

function inputs(overrides: Partial<SystemStatusInputs> = {}): SystemStatusInputs {
  return {
    sessionError: null,
    liveStatus: null,
    loggedIn: true,
    followStatus: 'off',
    followDetail: null,
    drmCapable: false,
    drmReady: false,
    enrichmentIssue: null,
    persistCorruptions: [],
    persistRecoveredBackup: null,
    reconnect: null,
    ...overrides
  }
}

function progress(over: Partial<EnrichmentProgress> = {}): EnrichmentProgress {
  return {
    position: { state: 'loading', pointsApplied: 500, coveredSeconds: 724 },
    carData: { state: 'pending', pointsApplied: 0, coveredSeconds: null },
    totalSeconds: 5530,
    ...over
  }
}

describe('describeEnrichmentProgress', () => {
  it('shows session time covered of the known total for a loading feed', () => {
    expect(describeEnrichmentProgress(progress())).toBe(
      'Enriching telemetry: position 12:04 of 1:32:10, car data queued'
    )
  })

  it('shows only what is known when the total is unknown', () => {
    expect(describeEnrichmentProgress(progress({ totalSeconds: null }))).toBe(
      'Enriching telemetry: position through 12:04, car data queued'
    )
  })

  it('shows the point count when neither a total nor a covered time is known', () => {
    const text = describeEnrichmentProgress(
      progress({
        totalSeconds: null,
        position: { state: 'loading', pointsApplied: 1500, coveredSeconds: null }
      })
    )
    expect(text).toBe('Enriching telemetry: position 1,500 points, car data queued')
  })

  it('says a started feed with nothing applied yet is starting', () => {
    const text = describeEnrichmentProgress(
      progress({ position: { state: 'loading', pointsApplied: 0, coveredSeconds: null } })
    )
    expect(text).toBe('Enriching telemetry: position starting, car data queued')
  })

  it('never reports covered time beyond the known total', () => {
    const text = describeEnrichmentProgress(
      progress({
        position: { state: 'loading', pointsApplied: 9, coveredSeconds: 6000 },
        carData: { state: 'done', pointsApplied: 5, coveredSeconds: 5000 }
      })
    )
    expect(text).toBe('Enriching telemetry: position 1:32:10 of 1:32:10')
  })

  it('omits finished and failed feeds, and returns null when nothing is still loading', () => {
    const active = describeEnrichmentProgress(
      progress({ position: { state: 'failed', pointsApplied: 3, coveredSeconds: 9 } })
    )
    expect(active).toBe('Enriching telemetry: car data queued')
    expect(
      describeEnrichmentProgress(
        progress({
          position: { state: 'done', pointsApplied: 3, coveredSeconds: 9 },
          carData: { state: 'failed', pointsApplied: 0, coveredSeconds: null }
        })
      )
    ).toBeNull()
  })
})

describe('buildSystemStatus enrichment progress', () => {
  it('adds an informational, non-actionable entry while enrichment is running', () => {
    const entries = buildSystemStatus(inputs({ enrichmentProgress: progress() }))
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      category: 'telemetry-enrichment',
      severity: 'info',
      recoveryActionId: null,
      ongoing: true,
      message: 'Enriching telemetry: position 12:04 of 1:32:10, car data queued'
    })
  })

  it('adds nothing once every feed has finished, or when there is no progress', () => {
    const finished = progress({
      position: { state: 'done', pointsApplied: 3, coveredSeconds: 9 },
      carData: { state: 'done', pointsApplied: 3, coveredSeconds: 9 }
    })
    expect(buildSystemStatus(inputs({ enrichmentProgress: finished }))).toEqual([])
    expect(buildSystemStatus(inputs({ enrichmentProgress: null }))).toEqual([])
    expect(buildSystemStatus(inputs())).toEqual([])
  })

  it('keeps the enrichment failure entry separate from the progress entry', () => {
    const entries = buildSystemStatus(
      inputs({ enrichmentIssue: 'position: boom', enrichmentProgress: progress() })
    )
    expect(entries.map((e) => e.ongoing === true)).toEqual([false, true])
  })
})
