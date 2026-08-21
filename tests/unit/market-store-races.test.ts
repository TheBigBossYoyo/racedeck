import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MarketWinnerResult } from '@shared/market'

const ipc = vi.hoisted(() => ({
  winner: vi.fn(),
  history: vi.fn()
}))

vi.mock('@renderer/lib/ipc', () => ({
  hasBridge: () => true,
  bridge: () => ({ market: ipc })
}))

import { useMarketStore } from '@renderer/store/marketStore'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function result(slug: string): MarketWinnerResult {
  return {
    ok: true,
    error: null,
    event: { slug, title: slug, closed: false, active: true, endDate: null, volume: null },
    outcomes: [],
    fetchedAt: '2026-07-16T00:00:00.000Z',
    latencyMs: 1
  }
}

describe('market store request freshness', () => {
  beforeEach(() => {
    ipc.winner.mockReset()
    ipc.history.mockReset()
    useMarketStore.getState().clear()
  })

  it('lets a newer refresh supersede an older in-flight request', async () => {
    const older = deferred<MarketWinnerResult>()
    const newer = deferred<MarketWinnerResult>()
    ipc.winner.mockImplementationOnce(() => older.promise).mockImplementationOnce(() => newer.promise)

    const olderLoad = useMarketStore.getState().refresh({ query: 'older', targetDateMs: 1 })
    const newerLoad = useMarketStore.getState().refresh({ query: 'newer', targetDateMs: 2 })
    newer.resolve(result('newer'))
    await newerLoad
    older.resolve(result('older'))
    await olderLoad

    expect(useMarketStore.getState().result?.event?.slug).toBe('newer')
    expect(useMarketStore.getState().loading).toBe(false)
  })

  it('does not let a pending refresh repopulate cleared state', async () => {
    const pending = deferred<MarketWinnerResult>()
    ipc.winner.mockImplementationOnce(() => pending.promise)

    const load = useMarketStore.getState().refresh({ query: 'old session' })
    useMarketStore.getState().clear()
    pending.resolve(result('old-session'))
    await load

    expect(useMarketStore.getState().result).toBeNull()
    expect(useMarketStore.getState().loading).toBe(false)
  })

  it('requests an absolute replay window and caches an empty closed-market response', async () => {
    ipc.history.mockResolvedValue({ ok: true, error: null, yesTokenId: 'yes-1', points: [] })
    const target = 1_720_278_000

    await useMarketStore.getState().loadHistory('yes-1', target)
    await useMarketStore.getState().loadHistory('yes-1', target + 60)

    expect(ipc.history).toHaveBeenCalledTimes(1)
    expect(ipc.history).toHaveBeenCalledWith({
      yesTokenId: 'yes-1',
      startTs: target - 7 * 24 * 60 * 60,
      endTs: target + 24 * 60 * 60,
      fidelity: 30
    })
  })
})
