import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useRadioNotifyStore } from '../../src/renderer/store/radioNotifyStore'
import type { RaceSnapshot } from '../../src/renderer/core/providers/types'
import type { Driver, TeamRadioClip } from '../../src/shared/models'

function driver(number: number, code: string): Driver {
  return { number, code, teamColour: 'FF8000' } as unknown as Driver
}

function clip(url: string, driverNumber: number): TeamRadioClip {
  return { url, driverNumber, utc: '2026-01-01T00:00:00Z' }
}

function snapshot(over: {
  sessionId: string
  live: boolean
  teamRadio: TeamRadioClip[]
}): RaceSnapshot {
  return {
    session: { id: over.sessionId, type: 'race' },
    drivers: [driver(1, 'VER'), driver(4, 'NOR')],
    teamRadio: over.teamRadio,
    availability: { live: over.live }
  } as unknown as RaceSnapshot
}

describe('radioNotifyStore', () => {
  beforeEach(() => {
    useRadioNotifyStore.setState({ current: null, queue: [] })
    // First ingest of a fresh id resets internal module state too.
    useRadioNotifyStore
      .getState()
      .ingest(snapshot({ sessionId: '__reset__', live: false, teamRadio: [] }))
  })

  afterEach(() => {
    useRadioNotifyStore.setState({ current: null, queue: [] })
  })

  it('does not notify for clips already present on the first frame of a session', () => {
    useRadioNotifyStore
      .getState()
      .ingest(snapshot({ sessionId: 'race-1', live: true, teamRadio: [clip('a.mp3', 1)] }))
    expect(useRadioNotifyStore.getState().current).toBeNull()
  })

  it('notifies for a clip that arrives after the baseline, in a live session', () => {
    useRadioNotifyStore
      .getState()
      .ingest(snapshot({ sessionId: 'race-1', live: true, teamRadio: [clip('a.mp3', 1)] }))
    useRadioNotifyStore
      .getState()
      .ingest(
        snapshot({
          sessionId: 'race-1',
          live: true,
          teamRadio: [clip('a.mp3', 1), clip('b.mp3', 4)]
        })
      )

    const current = useRadioNotifyStore.getState().current
    expect(current).not.toBeNull()
    expect(current!.url).toBe('b.mp3')
    expect(current!.code).toBe('NOR')
  })

  it('does not notify for new clips in a non-live (replay) snapshot', () => {
    useRadioNotifyStore
      .getState()
      .ingest(snapshot({ sessionId: 'race-1', live: false, teamRadio: [clip('a.mp3', 1)] }))
    useRadioNotifyStore
      .getState()
      .ingest(
        snapshot({
          sessionId: 'race-1',
          live: false,
          teamRadio: [clip('a.mp3', 1), clip('b.mp3', 4)]
        })
      )

    expect(useRadioNotifyStore.getState().current).toBeNull()
  })

  it('queues additional clips and advances on dismiss', () => {
    useRadioNotifyStore
      .getState()
      .ingest(snapshot({ sessionId: 'race-1', live: true, teamRadio: [] }))
    useRadioNotifyStore.getState().ingest(
      snapshot({
        sessionId: 'race-1',
        live: true,
        teamRadio: [clip('a.mp3', 1), clip('b.mp3', 4)]
      })
    )

    expect(useRadioNotifyStore.getState().current?.url).toBe('a.mp3')
    expect(useRadioNotifyStore.getState().queue.map((n) => n.url)).toEqual(['b.mp3'])

    useRadioNotifyStore.getState().dismiss()
    expect(useRadioNotifyStore.getState().current?.url).toBe('b.mp3')
    expect(useRadioNotifyStore.getState().queue).toEqual([])
  })

  it('resets the queue on a session switch instead of carrying stale notices over', () => {
    useRadioNotifyStore
      .getState()
      .ingest(snapshot({ sessionId: 'race-1', live: true, teamRadio: [] }))
    useRadioNotifyStore
      .getState()
      .ingest(snapshot({ sessionId: 'race-1', live: true, teamRadio: [clip('a.mp3', 1)] }))
    expect(useRadioNotifyStore.getState().current).not.toBeNull()

    useRadioNotifyStore
      .getState()
      .ingest(snapshot({ sessionId: 'race-2', live: true, teamRadio: [clip('x.mp3', 1)] }))
    expect(useRadioNotifyStore.getState().current).toBeNull()
  })
})
