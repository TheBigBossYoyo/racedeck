import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AlertEvent } from '@renderer/core/engines/AlertEngine'
import type { RaceSnapshot } from '@renderer/core/providers/types'

const engineOutput = vi.hoisted(() => ({ next: [] as AlertEvent[] }))

vi.mock('@renderer/core/engines/AlertEngine', () => ({
  AlertEngine: class {
    setConfig(): void {}
    reset(): void {}
    ingest(): AlertEvent[] {
      return engineOutput.next
    }
  }
}))

import { useAlertStore } from '@renderer/store/alertStore'

function alert(id: string): AlertEvent {
  return {
    id,
    type: 'pit_stop' as AlertEvent['type'],
    title: id,
    detail: '',
    severity: 'info',
    driverNumbers: [],
    at: '2026-01-01T00:00:00.000Z',
    seenAt: 0
  }
}

const snapshot = {} as RaceSnapshot
const ids = (list: AlertEvent[]) => list.map((a) => a.id)

/** Engine output is chronological (oldest first); the store list is newest first. */
function feed(events: AlertEvent[]): { returned: AlertEvent[]; engineArray: AlertEvent[] } {
  const engineArray = Object.freeze([...events]) as AlertEvent[]
  engineOutput.next = engineArray
  return { returned: useAlertStore.getState().ingest(snapshot), engineArray }
}

describe('alertStore ingest ordering and immutability', () => {
  beforeEach(() => {
    useAlertStore.setState({ alerts: [], muted: false, unseen: 0 })
  })

  it('stores fresh alerts newest first when unmuted', () => {
    feed([alert('a'), alert('b'), alert('c')])
    expect(ids(useAlertStore.getState().alerts)).toEqual(['c', 'b', 'a'])
  })

  it('stores fresh alerts in the SAME newest-first order when muted', () => {
    useAlertStore.getState().setMuted(true)
    feed([alert('a'), alert('b'), alert('c')])
    expect(ids(useAlertStore.getState().alerts)).toEqual(['c', 'b', 'a'])
  })

  it('returns the same (engine, chronological) order whether muted or not', () => {
    const unmuted = feed([alert('a'), alert('b'), alert('c')]).returned
    useAlertStore.setState({ alerts: [], unseen: 0 })
    useAlertStore.getState().setMuted(true)
    const muted = feed([alert('a'), alert('b'), alert('c')]).returned
    expect(ids(unmuted)).toEqual(['a', 'b', 'c'])
    expect(ids(muted)).toEqual(['a', 'b', 'c'])
  })

  it('does not mutate the array the engine returned (muted path)', () => {
    useAlertStore.getState().setMuted(true)
    // A frozen array makes an in-place reverse() throw, and we also assert order.
    const { engineArray } = feed([alert('a'), alert('b')])
    expect(ids(engineArray)).toEqual(['a', 'b'])
  })

  it('does not mutate the array the engine returned (unmuted path)', () => {
    const { engineArray } = feed([alert('a'), alert('b')])
    expect(ids(engineArray)).toEqual(['a', 'b'])
  })

  it('only bumps the unseen counter when unmuted', () => {
    feed([alert('a'), alert('b')])
    expect(useAlertStore.getState().unseen).toBe(2)
    useAlertStore.getState().setMuted(true)
    feed([alert('c')])
    expect(useAlertStore.getState().unseen).toBe(2)
  })

  it('prepends across ingests and caps the list at 60', () => {
    feed([alert('a'), alert('b')])
    feed([alert('c')])
    expect(ids(useAlertStore.getState().alerts)).toEqual(['c', 'b', 'a'])

    const many = Array.from({ length: 70 }, (_, i) => alert(`n${i}`))
    feed(many)
    const stored = useAlertStore.getState().alerts
    expect(stored).toHaveLength(60)
    expect(stored[0].id).toBe('n69')
  })

  it('returns an empty array untouched and leaves state alone', () => {
    const { returned } = feed([])
    expect(returned).toEqual([])
    expect(useAlertStore.getState().alerts).toEqual([])
  })
})
