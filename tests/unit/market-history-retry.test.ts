import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RaceDeckApi } from '@shared/ipc-contract'
import { useMarketStore } from '@renderer/store/marketStore'

const history = vi.fn()

describe('marketStore.loadHistory does not re-request a failed token on every call', () => {
  beforeEach(() => {
    history.mockReset()
    ;(window as Window).racedeck = { market: { history } } as unknown as RaceDeckApi
    useMarketStore.getState().clear()
  })

  afterEach(() => {
    delete (window as Partial<Window>).racedeck
  })

  it('makes one request when the IPC call throws, and records the error', async () => {
    history.mockRejectedValue(new Error('ipc down'))
    const { loadHistory } = useMarketStore.getState()

    await loadHistory('tok-1', 1_700_000_000)
    await loadHistory('tok-1', 1_700_000_001)
    await loadHistory('tok-1', 1_700_000_002)

    expect(history).toHaveBeenCalledTimes(1)
    expect(useMarketStore.getState().historyErrorByToken['tok-1']).toBe('ipc down')
    expect(useMarketStore.getState().historyLoading['tok-1']).toBe(false)
  })

  it('behaves the same for a resolved-but-failed result (already deduped)', async () => {
    history.mockResolvedValue({ ok: false, error: 'upstream 500', yesTokenId: 'tok-2', points: [] })
    const { loadHistory } = useMarketStore.getState()

    await loadHistory('tok-2')
    await loadHistory('tok-2')

    expect(history).toHaveBeenCalledTimes(1)
  })

  it('clear() re-arms a failed token so the user can retry', async () => {
    history.mockRejectedValue(new Error('ipc down'))
    await useMarketStore.getState().loadHistory('tok-3')

    useMarketStore.getState().clear()
    await useMarketStore.getState().loadHistory('tok-3')

    expect(history).toHaveBeenCalledTimes(2)
  })
})

describe('marketStore.loadHistory retries a failed token after a cooldown', () => {
  const COOLDOWN_MS = 30_000

  beforeEach(() => {
    vi.useFakeTimers()
    history.mockReset()
    ;(window as Window).racedeck = { market: { history } } as unknown as RaceDeckApi
    useMarketStore.getState().clear()
  })

  afterEach(() => {
    vi.useRealTimers()
    delete (window as Partial<Window>).racedeck
  })

  it('does not re-request inside the cooldown, then retries exactly once after it', async () => {
    history.mockRejectedValue(new Error('ipc down'))
    const { loadHistory } = useMarketStore.getState()

    await loadHistory('tok-a')
    for (let i = 0; i < 20; i++) {
      vi.advanceTimersByTime(1_000)
      await loadHistory('tok-a')
    }
    expect(history).toHaveBeenCalledTimes(1) // 20 s elapsed

    vi.advanceTimersByTime(COOLDOWN_MS - 20_000 - 1)
    await loadHistory('tok-a')
    expect(history).toHaveBeenCalledTimes(1) // 1 ms short

    vi.advanceTimersByTime(1)
    await loadHistory('tok-a')
    expect(history).toHaveBeenCalledTimes(2)

    // The retry failed too, so a fresh cooldown starts; many calls make no more requests.
    for (let i = 0; i < 10; i++) await loadHistory('tok-a')
    expect(history).toHaveBeenCalledTimes(2)
  })

  it('applies to resolved-but-failed results and recovers when the retry succeeds', async () => {
    history.mockResolvedValueOnce({ ok: false, error: 'upstream 500', yesTokenId: 'tok-b', points: [] })
    await useMarketStore.getState().loadHistory('tok-b')
    expect(useMarketStore.getState().historyErrorByToken['tok-b']).toBe('upstream 500')

    const points = [{ t: 1, p: 0.4 }]
    history.mockResolvedValueOnce({ ok: true, yesTokenId: 'tok-b', points })
    vi.advanceTimersByTime(COOLDOWN_MS)
    await useMarketStore.getState().loadHistory('tok-b')

    const s = useMarketStore.getState()
    expect(s.historyByToken['tok-b']).toEqual(points)
    expect(s.historyErrorByToken['tok-b']).toBeNull()
    expect(s.historyLoading['tok-b']).toBe(false)

    // Now a successful token: never re-requested, however long we wait.
    vi.advanceTimersByTime(10 * COOLDOWN_MS)
    await useMarketStore.getState().loadHistory('tok-b')
    expect(history).toHaveBeenCalledTimes(2)
  })

  it('never re-requests a successful token, and never while a request is in flight', async () => {
    history.mockResolvedValue({ ok: true, yesTokenId: 'tok-c', points: [] })
    await useMarketStore.getState().loadHistory('tok-c')
    vi.advanceTimersByTime(10 * COOLDOWN_MS)
    await useMarketStore.getState().loadHistory('tok-c')
    expect(history).toHaveBeenCalledTimes(1)

    let release!: (v: unknown) => void
    history.mockReset()
    history.mockRejectedValueOnce(new Error('down'))
    await useMarketStore.getState().loadHistory('tok-d')
    vi.advanceTimersByTime(COOLDOWN_MS)
    history.mockReturnValueOnce(new Promise((r) => (release = r)))
    const first = useMarketStore.getState().loadHistory('tok-d')
    void useMarketStore.getState().loadHistory('tok-d')
    void useMarketStore.getState().loadHistory('tok-d')
    expect(history).toHaveBeenCalledTimes(2) // original failure + the single in-flight retry
    release({ ok: true, yesTokenId: 'tok-d', points: [] })
    await first
  })

  it('clear() still re-arms immediately, with no cooldown', async () => {
    history.mockRejectedValue(new Error('ipc down'))
    await useMarketStore.getState().loadHistory('tok-e')
    useMarketStore.getState().clear()
    await useMarketStore.getState().loadHistory('tok-e')
    expect(history).toHaveBeenCalledTimes(2)
  })
})
