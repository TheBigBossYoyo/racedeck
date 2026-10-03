import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LiveStatus } from '@shared/f1live'
import type { SessionInfo } from '@shared/models'

const ipc = vi.hoisted(() => ({
  connectLive: vi.fn(),
  disconnectLive: vi.fn(),
  loginStatus: vi.fn(),
  openLogin: vi.fn(),
  onLiveStatus: vi.fn()
}))

vi.mock('@renderer/lib/ipc', () => ({
  hasBridge: () => true,
  bridge: () => ({ f1: ipc })
}))

import { useLiveStore } from '@renderer/store/liveStore'
import { asProgrammaticSeek, dataManager, useSessionStore } from '@renderer/store/sessionStore'

const LIVE_STATUS: LiveStatus = {
  state: 'connected',
  detail: 'full live data',
  sessionName: 'Race',
  messages: 10,
  subscription: true,
  live: true,
  updatedAt: '2026-01-01T00:00:00Z'
}

const LIVE_SESSION: SessionInfo = {
  id: 'live',
  meetingId: 'meeting-live',
  name: 'Race',
  type: 'race',
  meetingName: 'Test Grand Prix',
  circuitName: 'Test Circuit',
  circuitShortName: 'Test',
  countryName: 'Test',
  countryCode: 'TST',
  location: 'Test',
  dateStart: '2026-01-01T00:00:00Z',
  dateEnd: '2026-01-01T02:00:00Z',
  gmtOffset: '+00:00:00',
  year: 2026,
  totalLaps: 50,
  provider: 'f1live'
}

describe('a live poll publishes one snapshot', () => {
  // Zero until a poll extends it: an empty session skips the bookmark pre-pass,
  // which would otherwise need a real provider snapshot.
  let duration = 0
  const originalRecompute = useSessionStore.getState().recompute
  let recompute: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers()
    duration = 0
    ipc.connectLive.mockReset().mockResolvedValue(LIVE_STATUS)
    ipc.loginStatus.mockReset().mockResolvedValue(true)
    ipc.onLiveStatus.mockReset().mockReturnValue(() => undefined)
    ipc.disconnectLive.mockReset()

    vi.spyOn(dataManager, 'listSessions').mockResolvedValue([])
    vi.spyOn(dataManager, 'loadSession').mockImplementation(async () => LIVE_SESSION)
    vi.spyOn(dataManager, 'getDuration').mockImplementation(() => duration)
    vi.spyOn(dataManager, 'getInitialClock').mockReturnValue(0)
    vi.spyOn(dataManager, 'getTimeline').mockReturnValue(null)

    recompute = vi.fn()
    useSessionStore.setState({ recompute, recentSeeks: [], error: null })
    useLiveStore.setState({ status: null, busy: false, notice: null })
  })

  afterEach(() => {
    useLiveStore.getState().disconnect()
    useSessionStore.setState({ recompute: originalRecompute, recentSeeks: [] })
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  async function goLive(): Promise<void> {
    const pending = useLiveStore.getState().connect()
    await vi.advanceTimersByTimeAsync(1_500)
    await pending
  }

  it('recomputes exactly once per poll and moves the playhead to the edge', async () => {
    await goLive()
    recompute.mockClear()

    duration = 130
    await vi.advanceTimersByTimeAsync(250)

    expect(useSessionStore.getState().duration).toBe(130)
    expect(useSessionStore.getState().clock).toBe(128)
    expect(recompute).toHaveBeenCalledTimes(1)

    duration = 131
    await vi.advanceTimersByTimeAsync(250)
    expect(recompute).toHaveBeenCalledTimes(2)
  })

  it('does not record the live-edge follow in recentSeeks', async () => {
    await goLive()
    duration = 130
    await vi.advanceTimersByTimeAsync(750)
    expect(useSessionStore.getState().clock).toBe(128)
    expect(useSessionStore.getState().recentSeeks).toEqual([])

    // A real user seek still is.
    useSessionStore.getState().seek(40)
    expect(useSessionStore.getState().recentSeeks).toEqual([40])
  })

  it('still recomputes when reloadSession is called without deferring', async () => {
    await goLive()
    useLiveStore.getState().disconnect() // no poll interference
    recompute.mockClear()
    duration = 150
    await useSessionStore.getState().reloadSession()
    expect(recompute).toHaveBeenCalledTimes(1)
  })

  it('skips the recompute only when the caller asked to defer it', async () => {
    await goLive()
    useLiveStore.getState().disconnect()
    recompute.mockClear()
    duration = 150
    await useSessionStore.getState().reloadSession({ deferPublish: true })
    expect(recompute).not.toHaveBeenCalled()
    expect(useSessionStore.getState().duration).toBe(150)
  })

  describe('overlapping reloads', () => {
    /** Hold the provider's reload open so a second caller can join it. */
    function gateLoad(): { release: () => void } {
      let release!: () => void
      const gate = new Promise<void>((r) => {
        release = r
      })
      vi.spyOn(dataManager, 'loadSession').mockImplementation(async () => {
        await gate
        return LIVE_SESSION
      })
      return { release }
    }

    it('a non-deferred caller joining an in-flight deferred reload still gets its publish', async () => {
      await goLive()
      useLiveStore.getState().disconnect()
      recompute.mockClear()
      duration = 150
      const gate = gateLoad()
      const poll = useSessionStore.getState().reloadSession({ deferPublish: true })
      const joiner = useSessionStore.getState().reloadSession()
      gate.release()
      expect(await poll).toBe(true)
      expect(await joiner).toBe(true)
      expect(recompute).toHaveBeenCalledTimes(1)
    })

    it('two deferred callers publish nothing (the poll path keeps its single publish)', async () => {
      await goLive()
      useLiveStore.getState().disconnect()
      recompute.mockClear()
      duration = 150
      const gate = gateLoad()
      const a = useSessionStore.getState().reloadSession({ deferPublish: true })
      const b = useSessionStore.getState().reloadSession({ deferPublish: true })
      gate.release()
      await Promise.all([a, b])
      expect(recompute).not.toHaveBeenCalled()
    })

    it('a joiner does not leak its publish request into the next, independent deferred reload', async () => {
      await goLive()
      useLiveStore.getState().disconnect()
      duration = 150
      const gate = gateLoad()
      const first = useSessionStore.getState().reloadSession({ deferPublish: true })
      void useSessionStore.getState().reloadSession()
      gate.release()
      await first
      recompute.mockClear()

      vi.spyOn(dataManager, 'loadSession').mockImplementation(async () => LIVE_SESSION)
      await useSessionStore.getState().reloadSession({ deferPublish: true })
      expect(recompute).not.toHaveBeenCalled()
    })

    it('a non-deferred reload publishes once even when a deferred caller joins it', async () => {
      await goLive()
      useLiveStore.getState().disconnect()
      recompute.mockClear()
      duration = 150
      const gate = gateLoad()
      const a = useSessionStore.getState().reloadSession()
      const b = useSessionStore.getState().reloadSession({ deferPublish: true })
      gate.release()
      await Promise.all([a, b])
      expect(recompute).toHaveBeenCalledTimes(1)
    })
  })

  it('restores normal seek recording after a programmatic seek, even if it throws', () => {
    useSessionStore.setState({ duration: 500, recentSeeks: [] })
    expect(() =>
      asProgrammaticSeek(() => {
        useSessionStore.getState().seek(10)
        throw new Error('boom')
      })
    ).toThrow('boom')
    expect(useSessionStore.getState().recentSeeks).toEqual([])
    useSessionStore.getState().seek(20)
    expect(useSessionStore.getState().recentSeeks).toEqual([20])
  })
})
