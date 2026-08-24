import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSessionStore } from '@renderer/store/sessionStore'
import { useSyncStore } from '@renderer/store/syncStore'
import { seekToRadioClip } from '@renderer/lib/seekToRadioClip'

/**
 * APP_IMPROVEMENT_ROADMAP.md P2 item 23: clicking a radio clip seeks replay
 * to its broadcast moment, using the same data-time→video-time conversion
 * TransportBar's bookmark markers use (offset-preserving, unlike the
 * calibration-oriented `alignData`).
 */
describe('seekToRadioClip', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does nothing without a session start time', () => {
    const seek = vi.fn()
    useSessionStore.setState({ snapshot: null, duration: 3600, seek })
    seekToRadioClip('2026-01-01T14:05:00Z')
    expect(seek).not.toHaveBeenCalled()
  })

  it('seeks to the clip offset from session start, offset-preserving at zero offset', () => {
    const seek = vi.fn()
    useSessionStore.setState({
      snapshot: { session: { dateStart: '2026-01-01T14:00:00Z' } } as any,
      duration: 3600,
      seek
    })
    useSyncStore.setState({ sync: { ...useSyncStore.getState().sync, offsetSeconds: 0 } })

    seekToRadioClip('2026-01-01T14:05:00Z')

    expect(seek).toHaveBeenCalledWith(300)
  })

  it('clamps to the reachable data range', () => {
    const seek = vi.fn()
    useSessionStore.setState({
      snapshot: { session: { dateStart: '2026-01-01T14:00:00Z' } } as any,
      duration: 120,
      seek
    })
    useSyncStore.setState({ sync: { ...useSyncStore.getState().sync, offsetSeconds: 0 } })

    // 10 minutes after start, but the session is only 120s long.
    seekToRadioClip('2026-01-01T14:10:00Z')

    expect(seek).toHaveBeenCalledWith(120)
  })

  it('ignores a clip broadcast before the session started', () => {
    const seek = vi.fn()
    useSessionStore.setState({
      snapshot: { session: { dateStart: '2026-01-01T14:00:00Z' } } as any,
      duration: 3600,
      seek
    })
    useSyncStore.setState({ sync: { ...useSyncStore.getState().sync, offsetSeconds: 0 } })

    seekToRadioClip('2026-01-01T13:59:00Z')

    expect(seek).not.toHaveBeenCalled()
  })
})
