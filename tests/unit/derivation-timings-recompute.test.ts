import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionInfo } from '@shared/models'
import type { RaceSnapshot } from '@renderer/core/providers/types'
import {
  getDerivationTimingStats,
  resetDerivationTimings
} from '@renderer/core/engines/DerivationTimings'
import { dataManager, useSessionStore } from '@renderer/store/sessionStore'
import { useAlertStore } from '@renderer/store/alertStore'
import { useRaceStoryStore } from '@renderer/store/raceStoryStore'
import { useEngineerNotesStore } from '@renderer/store/engineerNotesStore'
import { useRadioNotifyStore } from '@renderer/store/radioNotifyStore'

const SESSION = { id: 'timing-test', provider: 'demo' } as unknown as SessionInfo
const SNAPSHOT = { currentLap: 1 } as unknown as RaceSnapshot

describe('recompute derivation timing', () => {
  const originals = {
    alert: useAlertStore.getState().ingest,
    story: useRaceStoryStore.getState().ingest,
    notes: useEngineerNotesStore.getState().ingest,
    radio: useRadioNotifyStore.getState().ingest
  }
  let ingests: ReturnType<typeof vi.fn>[]

  beforeEach(() => {
    resetDerivationTimings()
    ingests = [vi.fn(() => []), vi.fn(), vi.fn(), vi.fn()]
    useAlertStore.setState({ ingest: ingests[0] as never })
    useRaceStoryStore.setState({ ingest: ingests[1] as never })
    useEngineerNotesStore.setState({ ingest: ingests[2] as never })
    useRadioNotifyStore.setState({ ingest: ingests[3] as never })
    vi.spyOn(dataManager, 'getSnapshotAt').mockReturnValue(SNAPSHOT)
    useSessionStore.setState({ currentSession: SESSION, duration: 100, clock: 10, error: null })
  })

  afterEach(() => {
    useAlertStore.setState({ ingest: originals.alert })
    useRaceStoryStore.setState({ ingest: originals.story })
    useEngineerNotesStore.setState({ ingest: originals.notes })
    useRadioNotifyStore.setState({ ingest: originals.radio })
    useSessionStore.setState({ currentSession: null, snapshot: null, error: null })
    vi.restoreAllMocks()
    resetDerivationTimings()
  })

  it('has no stats before any recompute', () => {
    const stats = getDerivationTimingStats()
    expect(stats.snapshotBuild).toBeNull()
    expect(stats.fanOut).toBeNull()
  })

  it('records exactly one build and one fan-out sample per publish', () => {
    useSessionStore.getState().recompute()
    let stats = getDerivationTimingStats()
    expect(stats.snapshotBuild?.count).toBe(1)
    expect(stats.fanOut?.count).toBe(1)
    expect(useSessionStore.getState().snapshot).toBe(SNAPSHOT)
    for (const ingest of ingests) expect(ingest).toHaveBeenCalledTimes(1)

    useSessionStore.getState().recompute()
    useSessionStore.getState().recompute()
    stats = getDerivationTimingStats()
    expect(stats.snapshotBuild?.count).toBe(3)
    expect(stats.fanOut?.count).toBe(3)
  })

  it('splits the duration between build and fan-out using the timer', () => {
    // startedAt, builtAt, fan-out end.
    const now = vi
      .spyOn(performance, 'now')
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(104)
      .mockReturnValueOnce(115)
    useSessionStore.getState().recompute()
    now.mockRestore()
    const stats = getDerivationTimingStats()
    expect(stats.snapshotBuild).toEqual({ count: 1, p50: 4, p95: 4, max: 4 })
    expect(stats.fanOut).toEqual({ count: 1, p50: 11, p95: 11, max: 11 })
  })

  it('records nothing when there is no session', () => {
    useSessionStore.setState({ currentSession: null })
    useSessionStore.getState().recompute()
    expect(getDerivationTimingStats().snapshotBuild).toBeNull()
  })

  it('records nothing for a recompute that failed to build a snapshot', () => {
    vi.spyOn(dataManager, 'getSnapshotAt').mockImplementation(() => {
      throw new Error('boom')
    })
    useSessionStore.getState().recompute()
    expect(useSessionStore.getState().error).toBe('boom')
    expect(getDerivationTimingStats().snapshotBuild).toBeNull()
    expect(getDerivationTimingStats().fanOut).toBeNull()
  })

  it('does not put timing into the store state, so reading it cannot re-render', () => {
    const listener = vi.fn()
    const unsubscribe = useSessionStore.subscribe(listener)
    useSessionStore.getState().recompute()
    listener.mockClear()
    getDerivationTimingStats()
    unsubscribe()
    expect(listener).not.toHaveBeenCalled()
    expect(Object.keys(useSessionStore.getState())).not.toContain('derivationTimings')
  })
})
