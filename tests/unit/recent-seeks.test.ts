import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSessionStore } from '@renderer/store/sessionStore'

/**
 * APP_IMPROVEMENT_ROADMAP.md P2 item 26: `sessionStore.recentSeeks` tracks
 * explicit seek targets so the command palette can offer "resume where I was."
 */

const originalRecompute = useSessionStore.getState().recompute

describe('sessionStore recentSeeks', () => {
  beforeEach(() => {
    useSessionStore.setState({ duration: 3600, clock: 0, recentSeeks: [], recompute: vi.fn() })
  })

  afterEach(() => {
    useSessionStore.setState({ recentSeeks: [], recompute: originalRecompute })
  })

  it('records a seek target newest-first', () => {
    useSessionStore.getState().seek(100)
    useSessionStore.getState().seek(200)
    expect(useSessionStore.getState().recentSeeks).toEqual([200, 100])
  })

  it('deduplicates a repeated clamped target instead of listing it twice', () => {
    useSessionStore.getState().seek(100)
    useSessionStore.getState().seek(100)
    expect(useSessionStore.getState().recentSeeks).toEqual([100])
  })

  it('caps the list at 8 entries', () => {
    for (let i = 0; i < 12; i++) useSessionStore.getState().seek(i * 10)
    expect(useSessionStore.getState().recentSeeks).toHaveLength(8)
    // Newest (110) first.
    expect(useSessionStore.getState().recentSeeks[0]).toBe(110)
  })

  it('records the clamped clock, not the raw requested value', () => {
    useSessionStore.getState().seek(9999)
    expect(useSessionStore.getState().recentSeeks).toEqual([3600])
  })
})
