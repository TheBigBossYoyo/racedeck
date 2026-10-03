import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LiveStatus } from '@shared/f1live'

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

import { reconnectDelayMs, useLiveStore } from '@renderer/store/liveStore'
import { useSessionStore } from '@renderer/store/sessionStore'

function status(over: Partial<LiveStatus>): LiveStatus {
  return {
    state: 'connected',
    detail: null,
    sessionName: null,
    messages: 0,
    subscription: false,
    live: false,
    updatedAt: '2026-01-01T00:00:00Z',
    ...over
  }
}

describe('reconnectDelayMs', () => {
  it('grows with attempt number but never exceeds the 30s cap', () => {
    for (let attempt = 0; attempt < 10; attempt++) {
      const delay = reconnectDelayMs(attempt)
      expect(delay).toBeLessThanOrEqual(30_000)
      expect(delay).toBeGreaterThan(0)
    }
  })

  it('doubles the delay per attempt until it reaches the cap', () => {
    // random() = 1 removes the jitter, leaving the exact ceiling.
    vi.spyOn(Math, 'random').mockReturnValue(1)
    const delays = [0, 1, 2, 3, 4, 5, 6].map(reconnectDelayMs)
    expect(delays).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000])
    vi.restoreAllMocks()
  })

  it('caps the ceiling once the exponential term exceeds 30s', () => {
    // 1000 * 2^5 = 32000 > 30000, so this and every later attempt are capped.
    for (let i = 0; i < 20; i++) {
      const delay = reconnectDelayMs(5)
      expect(delay).toBeLessThanOrEqual(30_000)
      expect(delay).toBeGreaterThanOrEqual(15_000) // 50% jitter floor of the 30s cap
    }
  })
})

describe('live reconnect backoff', () => {
  let onStatus: (s: LiveStatus) => void

  beforeAll(() => {
    ipc.onLiveStatus.mockReturnValue(() => undefined)
    ipc.loginStatus.mockResolvedValue(false)
    useLiveStore.getState().init()
    onStatus = ipc.onLiveStatus.mock.calls[0][0]
  })

  beforeEach(async () => {
    vi.useFakeTimers()
    ipc.connectLive.mockReset()
    ipc.disconnectLive.mockReset()
    ipc.connectLive.mockResolvedValue(status({ state: 'connected', live: false }))
    useSessionStore.setState({ pause: vi.fn() })
    // A real connect() call, not a raw setState, so it resets the module-level
    // "was this disconnect intentional" flag the same way production code does
    // before each test simulates a later unexpected drop.
    await useLiveStore.getState().connect()
    useLiveStore.setState({ notice: null, reconnect: null })
    ipc.connectLive.mockClear()
  })

  afterEach(() => {
    useLiveStore.getState().disconnect()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('schedules an auto-reconnect with a live countdown after an unexpected close', async () => {
    onStatus(status({ state: 'closed', detail: 'closed (1006)' }))

    expect(useLiveStore.getState().reconnect).toMatchObject({ attempt: 1 })
    const initialRemaining = useLiveStore.getState().reconnect?.remainingMs ?? 0
    expect(initialRemaining).toBeGreaterThan(0)

    await vi.advanceTimersByTimeAsync(1_000)
    const afterOneTick = useLiveStore.getState().reconnect?.remainingMs ?? 0
    expect(afterOneTick).toBeLessThan(initialRemaining)

    await vi.advanceTimersByTimeAsync(30_000)
    expect(ipc.connectLive).toHaveBeenCalledTimes(1)
    expect(useLiveStore.getState().reconnect).toBeNull()
  })

  it('does not schedule an auto-reconnect after an intentional disconnect', async () => {
    useLiveStore.getState().disconnect()
    onStatus(status({ state: 'closed', detail: 'disconnected' }))

    expect(useLiveStore.getState().reconnect).toBeNull()

    await vi.advanceTimersByTimeAsync(30_000)
    expect(ipc.connectLive).not.toHaveBeenCalled()
  })

  // Deliberately changed: this used to assert an IMMEDIATE reset on 'connected'. That
  // status fires at handshake completion, before any data, so a server that handshakes
  // and then drops produced an unbounded ~1s retry loop. The counter now survives
  // 'connected' and resets only after the connection has stayed up for a stability window.
  it('cancels the pending countdown when a connection is established', async () => {
    onStatus(status({ state: 'closed', detail: 'closed (1006)' }))
    expect(useLiveStore.getState().reconnect).toMatchObject({ attempt: 1 })

    onStatus(status({ state: 'connected', live: false }))
    expect(useLiveStore.getState().reconnect).toBeNull()
  })

  it('keeps growing the delay while a connection flaps (connected, then dropped inside the stability window)', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(1)

    onStatus(status({ state: 'closed', detail: 'closed (1006)' }))
    expect(useLiveStore.getState().reconnect).toEqual({ attempt: 1, remainingMs: 1_000 })

    const expectedDelays = [2_000, 4_000, 8_000, 16_000]
    for (const expected of expectedDelays) {
      const wait = useLiveStore.getState().reconnect!.remainingMs
      await vi.advanceTimersByTimeAsync(wait) // retry fires; the handshake succeeds
      onStatus(status({ state: 'connected', live: false }))
      await vi.advanceTimersByTimeAsync(3_000) // ...and the server drops it again
      onStatus(status({ state: 'closed', detail: 'closed (1006)' }))
      expect(useLiveStore.getState().reconnect?.remainingMs).toBe(expected)
    }
  })

  it('resets the backoff to attempt 1 once a connection has stayed up past the stability window', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(1)

    onStatus(status({ state: 'closed', detail: 'closed (1006)' }))
    await vi.advanceTimersByTimeAsync(1_000)
    onStatus(status({ state: 'connected', live: false }))
    onStatus(status({ state: 'closed', detail: 'closed (1006)' }))
    expect(useLiveStore.getState().reconnect).toMatchObject({ attempt: 2 })
    await vi.advanceTimersByTimeAsync(2_000)

    onStatus(status({ state: 'connected', live: false }))
    // Periodic 'connected' republishes while streaming must not restart the window.
    await vi.advanceTimersByTimeAsync(6_000)
    onStatus(status({ state: 'connected', live: false, messages: 25 }))
    await vi.advanceTimersByTimeAsync(4_000)

    onStatus(status({ state: 'closed', detail: 'closed after a long stable run' }))
    expect(useLiveStore.getState().reconnect).toEqual({ attempt: 1, remainingMs: 1_000 })
  })

  it('a drop just inside the stability window does not reset the counter', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(1)

    onStatus(status({ state: 'closed', detail: 'closed (1006)' }))
    await vi.advanceTimersByTimeAsync(1_000)
    onStatus(status({ state: 'connected', live: false }))
    await vi.advanceTimersByTimeAsync(9_000)
    onStatus(status({ state: 'closed', detail: 'closed (1006)' }))
    expect(useLiveStore.getState().reconnect).toMatchObject({ attempt: 2 })
  })

  it('does not reset the counter behind the back of an intentional disconnect', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(1)
    onStatus(status({ state: 'closed', detail: 'closed (1006)' }))
    await vi.advanceTimersByTimeAsync(1_000)
    onStatus(status({ state: 'connected', live: false }))
    useLiveStore.getState().disconnect()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(useLiveStore.getState().reconnect).toBeNull()
    expect(ipc.connectLive).toHaveBeenCalledTimes(1)
  })

  it('a connect() disconnected mid-flight still clears busy, so the user can connect again', async () => {
    let settle!: (s: LiveStatus) => void
    ipc.connectLive.mockReturnValueOnce(
      new Promise<LiveStatus>((resolve) => {
        settle = resolve
      })
    )
    const pending = useLiveStore.getState().connect()
    expect(useLiveStore.getState().busy).toBe(true)

    useLiveStore.getState().disconnect()
    settle(status({ state: 'closed', detail: 'disconnected' }))
    await pending
    expect(useLiveStore.getState().busy).toBe(false)

    ipc.connectLive.mockResolvedValue(status({ state: 'connected' }))
    await useLiveStore.getState().connect()
    expect(ipc.connectLive).toHaveBeenCalledTimes(2)
    expect(useLiveStore.getState().status?.state).toBe('connected')
  })

  it('backs off further after each consecutive failed auto-retry', async () => {
    // random() = 1 removes the jitter so the countdown equals the exact ceiling.
    vi.spyOn(Math, 'random').mockReturnValue(1)
    ipc.connectLive.mockRejectedValue(new Error('offline'))

    onStatus(status({ state: 'closed', detail: 'closed (1006)' }))
    expect(useLiveStore.getState().reconnect).toEqual({ attempt: 1, remainingMs: 1_000 })

    // The retry itself fails: the next wait must double, not restart at 1s.
    await vi.advanceTimersByTimeAsync(1_000)
    expect(ipc.connectLive).toHaveBeenCalledTimes(1)
    expect(useLiveStore.getState().reconnect).toEqual({ attempt: 2, remainingMs: 2_000 })

    await vi.advanceTimersByTimeAsync(2_000)
    expect(ipc.connectLive).toHaveBeenCalledTimes(2)
    expect(useLiveStore.getState().reconnect).toEqual({ attempt: 3, remainingMs: 4_000 })
  })

  it('restarts the backoff from the base delay after a manual reconnect', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(1)
    ipc.connectLive.mockRejectedValue(new Error('offline'))

    onStatus(status({ state: 'closed', detail: 'closed (1006)' }))
    await vi.advanceTimersByTimeAsync(1_000)
    expect(useLiveStore.getState().reconnect).toMatchObject({ attempt: 2 })

    // The user clicks Reconnect and it fails too — a fresh sequence, not attempt 3.
    await useLiveStore.getState().connect()
    expect(useLiveStore.getState().reconnect).toEqual({ attempt: 1, remainingMs: 1_000 })
  })

  it('lets a manual reconnect cancel a pending auto-retry immediately', async () => {
    onStatus(status({ state: 'closed', detail: 'closed (1006)' }))
    expect(useLiveStore.getState().reconnect).not.toBeNull()

    const pending = useLiveStore.getState().connect()
    expect(useLiveStore.getState().reconnect).toBeNull()
    await pending

    expect(ipc.connectLive).toHaveBeenCalledTimes(1)
    // Advancing well past the original backoff window must not fire a second,
    // now-orphaned auto-reconnect on top of the manual one.
    await vi.advanceTimersByTimeAsync(30_000)
    expect(ipc.connectLive).toHaveBeenCalledTimes(1)
  })
})
