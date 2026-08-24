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

import { getLiveReloadCadenceMs, useLiveStore } from '@renderer/store/liveStore'
import { useSessionStore } from '@renderer/store/sessionStore'
import { useSettingsStore } from '@renderer/store/settingsStore'

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

function deferred<T>() {
  let settle: ((value: T) => void) | null = null
  const promise = new Promise<T>((done) => {
    settle = done
  })
  return {
    promise,
    resolve: (value: T) => {
      if (!settle) throw new Error('Deferred promise was not initialized.')
      settle(value)
    }
  }
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

async function connectLiveStore(): Promise<void> {
  const pending = useLiveStore.getState().connect()
  await vi.advanceTimersByTimeAsync(1_500)
  await pending
}

describe('live polling cadence', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    ipc.connectLive.mockReset()
    ipc.disconnectLive.mockReset()
    ipc.loginStatus.mockReset()
    ipc.openLogin.mockReset()
    ipc.onLiveStatus.mockReset()
    ipc.connectLive.mockResolvedValue(LIVE_STATUS)
    ipc.loginStatus.mockResolvedValue(true)
    ipc.onLiveStatus.mockReturnValue(() => undefined)

    useSettingsStore.setState({ performanceMode: false })
    useLiveStore.setState({ status: null, loggedIn: false, busy: false, notice: null })
    useSessionStore.setState({
      providerId: 'f1live',
      currentSession: LIVE_SESSION,
      duration: 30,
      playing: false,
      setProvider: vi.fn().mockResolvedValue(undefined),
      selectSession: vi.fn().mockImplementation(async () => {
        useSessionStore.setState({ providerId: 'f1live', currentSession: LIVE_SESSION, duration: 30 })
      }),
      pause: vi.fn(),
      seek: vi.fn(),
      reloadSession: vi.fn().mockResolvedValue(false)
    })
  })

  afterEach(() => {
    useLiveStore.getState().disconnect()
    useLiveStore.setState({ status: null, busy: false, notice: null })
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('selects the expected live reload cadence for normal and performance modes', () => {
    expect(getLiveReloadCadenceMs(false)).toBe(250)
    expect(getLiveReloadCadenceMs(true)).toBe(1_000)
  })

  it('waits for a live reload to settle before scheduling the next poll', async () => {
    const firstReload = deferred<boolean>()
    const reloadSession = vi.fn().mockReturnValueOnce(firstReload.promise).mockResolvedValue(true)
    const seek = vi.fn()
    useSessionStore.setState({ reloadSession, seek, duration: 30 })

    await connectLiveStore()

    await vi.advanceTimersByTimeAsync(250)
    expect(reloadSession).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(250)
    expect(reloadSession).toHaveBeenCalledTimes(1)

    firstReload.resolve(true)
    await flushMicrotasks()
    expect(seek).toHaveBeenCalledWith(28)

    await vi.advanceTimersByTimeAsync(250)
    expect(reloadSession).toHaveBeenCalledTimes(2)
  })

  it('reads performance mode when scheduling the next live poll', async () => {
    const firstReload = deferred<boolean>()
    const reloadSession = vi.fn().mockReturnValueOnce(firstReload.promise).mockResolvedValue(true)
    useSessionStore.setState({ reloadSession, seek: vi.fn(), duration: 30 })

    await connectLiveStore()

    await vi.advanceTimersByTimeAsync(250)
    expect(reloadSession).toHaveBeenCalledTimes(1)

    useSettingsStore.setState({ performanceMode: true })
    firstReload.resolve(true)
    await flushMicrotasks()

    await vi.advanceTimersByTimeAsync(999)
    expect(reloadSession).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1)
    expect(reloadSession).toHaveBeenCalledTimes(2)
  })
})
