import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { F1SessionData } from '@shared/f1live'
import { buildSyntheticSession } from './fixtures/f1SyntheticSession'

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

const DURATION = 900
const SESSION = buildSyntheticSession({ durationSec: DURATION, timingRate: 3, seed: 7 })

interface Internals {
  checkpoints: { t: number }[]
  checkpointIntervalSec: number
  maxCheckpoints: number
  playhead: { timing: unknown; app: unknown; cursorT: number }
  wholeSession: { cursorT: number }
}

async function loadProvider(checkpointIntervalSec?: number): Promise<F1LiveProvider> {
  // A private copy per provider: the point is that replaying never edits the feed.
  ipc.loadSession.mockResolvedValue(structuredClone(SESSION))
  const provider = new F1LiveProvider()
  if (checkpointIntervalSec != null) {
    ;(provider as unknown as Internals).checkpointIntervalSec = checkpointIntervalSec
  }
  await provider.loadSession(SESSION.summary.path)
  return provider
}

/** Deterministic pseudo-random walk over the whole session, back and forth. */
function seekSequence(count: number): number[] {
  let a = 12345
  const rand = (): number => {
    a = (Math.imul(a, 1664525) + 1013904223) >>> 0
    return a / 4294967296
  }
  const out: number[] = [0, DURATION, 100, 30, 30, 899.5, 61, 60, 59.9, 120]
  for (let i = 0; i < count; i++) out.push(rand() * DURATION)
  return out
}

describe('replay cursor: checkpoints and the whole-session cursor', () => {
  beforeEach(() => {
    ipc.loadSession.mockReset()
    ipc.loadSessionEnrichment.mockReset().mockResolvedValue({
      carData: [],
      position: [],
      duration: DURATION,
      nextCarDataOffset: 0,
      nextPositionOffset: 0,
      done: true
    })
  })

  it.each([5, 60])(
    'gives the same snapshot as a forward-only replay for any seek order (interval %ss)',
    async (interval) => {
      const seeking = await loadProvider(interval)
      for (const t of seekSequence(60)) {
        const reference = await loadProvider() // fresh: only ever moves forward from 0
        expect(seeking.getSnapshotAt(t)).toEqual(reference.getSnapshotAt(t))
      }
      // Checkpoints were actually exercised, not skipped.
      expect((seeking as unknown as Internals).checkpoints.length).toBeGreaterThan(0)
    },
    60_000
  )

  it('leaves the merged state identical to a from-scratch merge after backward seeks', async () => {
    const seeking = await loadProvider(10)
    seeking.getSnapshotAt(800)
    seeking.getSnapshotAt(95)
    seeking.getSnapshotAt(400)
    seeking.getSnapshotAt(399)

    const fresh = await loadProvider()
    fresh.getSnapshotAt(399)
    const a = (seeking as unknown as Internals).playhead
    const b = (fresh as unknown as Internals).playhead
    expect(a.timing).toEqual(b.timing)
    expect(a.app).toEqual(b.app)
  })

  it('does not show the future at the start of a replay', async () => {
    // The first timing point used to be rewritten by every later patch, so the
    // opening frame already carried the session's final lap counts.
    const provider = await loadProvider()
    const first = SESSION.streams.TimingData[1]
    const early = provider.getSnapshotAt(first.t)
    const driverOne = early.timing.find((e) => e.driverNumber === 1)
    expect(driverOne?.lapNumber).toBe(0)
  })

  it('never edits the feed it replays', async () => {
    const before = structuredClone(SESSION)
    const provider = await loadProvider()
    provider.getSnapshotAt(DURATION)
    provider.getSnapshotAt(10)
    const internals = provider as unknown as { timingPoints: unknown }
    expect(internals.timingPoints).toEqual(before.streams.TimingData)
  })

  it('keeps whole-session reads off the playhead cursor', async () => {
    const provider = await loadProvider(30)
    provider.getSnapshotAt(300)
    const cursorBefore = (provider as unknown as Internals).playhead.cursorT

    const full = provider.getSnapshotAt(DURATION)
    const internals = provider as unknown as Internals
    expect(internals.playhead.cursorT).toBe(cursorBefore)
    expect(internals.wholeSession.cursorT).toBe(DURATION)
    expect(full.clock).toBe(DURATION)

    // The playhead carries on from where it was, not from a reset.
    const next = provider.getSnapshotAt(300.25)
    expect(next.clock).toBe(300.25)
    expect(internals.playhead.cursorT).toBe(300.25)
  })

  it('answers whole-session reads identically however the playhead has moved', async () => {
    const provider = await loadProvider(30)
    const reference = await loadProvider()
    const expected = reference.getSnapshotAt(DURATION)
    provider.getSnapshotAt(500)
    expect(provider.getSnapshotAt(DURATION)).toEqual(expected)
    provider.getSnapshotAt(20)
    expect(provider.getSnapshotAt(DURATION)).toEqual(expected)
  })

  it('bounds the number of checkpoints it keeps', async () => {
    const provider = await loadProvider(1)
    ;(provider as unknown as Internals).maxCheckpoints = 25
    provider.getSnapshotAt(DURATION)
    const internals = provider as unknown as Internals
    expect(internals.checkpoints.length).toBe(25)
    // Past the cap a seek still lands on the right state.
    const reference = await loadProvider()
    expect(provider.getSnapshotAt(700)).toEqual(reference.getSnapshotAt(700))
    provider.getSnapshotAt(400)
    expect(provider.getSnapshotAt(410)).toEqual(
      (await loadProvider()).getSnapshotAt(410)
    )
  })

  it('drops checkpoints when a fresh session replaces the feeds', async () => {
    const provider = await loadProvider(10)
    provider.getSnapshotAt(DURATION)
    expect((provider as unknown as Internals).checkpoints.length).toBeGreaterThan(0)
    const other: F1SessionData = structuredClone(SESSION)
    other.summary.path = '2026/Other_Grand_Prix/2026-01-02_Race/'
    ipc.loadSession.mockResolvedValue(other)
    await provider.loadSession(other.summary.path)
    expect((provider as unknown as Internals).checkpoints).toEqual([])
  })
})
