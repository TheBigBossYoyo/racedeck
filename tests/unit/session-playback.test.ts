import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionInfo } from '@shared/models'
import { useSessionStore } from '@renderer/store/sessionStore'
import { useSettingsStore } from '@renderer/store/settingsStore'

const LIVE_SESSION: SessionInfo = {
  id: 'live',
  meetingId: null,
  name: 'Practice 1',
  type: 'practice',
  meetingName: 'Belgian Grand Prix',
  circuitName: 'Spa-Francorchamps',
  circuitShortName: 'Spa',
  countryName: 'Belgium',
  countryCode: 'BEL',
  location: 'Spa',
  dateStart: '2026-07-17T11:30:00Z',
  dateEnd: '2026-07-17T12:30:00Z',
  gmtOffset: '02:00:00',
  year: 2026,
  totalLaps: null,
  provider: 'f1live'
}

const originalRecompute = useSessionStore.getState().recompute

describe('session playback at the data boundary', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useSettingsStore.setState({ performanceMode: false })
    useSessionStore.getState().pause()
    useSessionStore.setState({
      providerId: 'f1live',
      currentSession: LIVE_SESSION,
      duration: 100,
      clock: 100,
      playing: false,
      recompute: vi.fn()
    })
  })

  afterEach(() => {
    useSessionStore.getState().pause()
    useSessionStore.setState({
      providerId: 'demo',
      currentSession: null,
      duration: 0,
      clock: 0,
      playing: false,
      recompute: originalRecompute
    })
    useSettingsStore.setState({ performanceMode: false })
    vi.useRealTimers()
  })

  it('applies a performance-mode cadence change during active playback', () => {
    useSessionStore.setState({ clock: 50 })
    const recompute = vi.mocked(useSessionStore.getState().recompute)
    useSessionStore.getState().play()
    vi.advanceTimersByTime(250)
    expect(recompute).toHaveBeenCalledTimes(1)

    recompute.mockClear()
    useSettingsStore.getState().setPerformanceMode(true)
    vi.advanceTimersByTime(599)
    expect(recompute).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(recompute).toHaveBeenCalledTimes(1)
  })

  it('keeps a live session playing while it waits for the feed edge to grow', () => {
    useSessionStore.getState().play()
    vi.advanceTimersByTime(300)
    expect(useSessionStore.getState().playing).toBe(true)
    expect(useSessionStore.getState().clock).toBe(100)
  })

  it('still pauses a replay at its final data boundary', () => {
    useSessionStore.setState({
      providerId: 'f1live',
      currentSession: { ...LIVE_SESSION, id: '2026/belgium/practice-1' }
    })
    useSessionStore.getState().play()
    vi.advanceTimersByTime(300)
    expect(useSessionStore.getState().playing).toBe(false)
    expect(useSessionStore.getState().clock).toBe(100)
  })
})
