import { afterEach, describe, expect, it } from 'vitest'
import { useRadioNotifyStore } from '../../src/renderer/store/radioNotifyStore'
import type { RaceSnapshot } from '../../src/renderer/core/providers/types'
import type { Driver, TeamRadioClip } from '../../src/shared/models'

function clip(url: string, driverNumber: number): TeamRadioClip {
  return { url, driverNumber, utc: '2026-01-01T00:00:00Z' }
}

function liveSnapshot(sessionId: string, teamRadio: TeamRadioClip[]): RaceSnapshot {
  return {
    session: { id: sessionId, type: 'race' },
    drivers: [{ number: 1, code: 'VER', teamColour: 'FF8000' } as unknown as Driver],
    teamRadio,
    availability: { live: true }
  } as unknown as RaceSnapshot
}

const ingest = (snap: RaceSnapshot): void => useRadioNotifyStore.getState().ingest(snap)
const state = () => useRadioNotifyStore.getState()

afterEach(() => {
  state().reset()
})

describe('radioNotifyStore.reset', () => {
  it('clears the current notice and the queue', () => {
    ingest(liveSnapshot('live', []))
    ingest(liveSnapshot('live', [clip('a.mp3', 1), clip('b.mp3', 1)]))
    expect(state().current).not.toBeNull()
    expect(state().queue).toHaveLength(1)

    state().reset()

    expect(state().current).toBeNull()
    expect(state().queue).toEqual([])
  })

  it('forgets seen clips so the next frame is a silent baseline, not a flood of old radio', () => {
    ingest(liveSnapshot('live', []))
    ingest(liveSnapshot('live', [clip('a.mp3', 1)]))
    state().reset()

    // Same session, same backlog: without a fresh baseline every clip would look new.
    ingest(liveSnapshot('live', [clip('a.mp3', 1), clip('b.mp3', 1)]))
    expect(state().current).toBeNull()

    // ...and a clip that genuinely arrives afterwards still notifies.
    ingest(liveSnapshot('live', [clip('a.mp3', 1), clip('b.mp3', 1), clip('c.mp3', 1)]))
    expect(state().current?.url).toBe('c.mp3')
  })

  it('is idempotent on an already-empty store', () => {
    state().reset()
    state().reset()
    expect(state().current).toBeNull()
    expect(state().queue).toEqual([])
  })
})
