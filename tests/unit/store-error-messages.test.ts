import { beforeEach, describe, expect, it, vi } from 'vitest'

const ipc = vi.hoisted(() => ({
  market: { winner: vi.fn(), history: vi.fn() },
  standings: { season: vi.fn() }
}))

vi.mock('@renderer/lib/ipc', () => ({
  hasBridge: () => true,
  bridge: () => ipc
}))

import { useMarketStore } from '@renderer/store/marketStore'
import { useStandingsStore } from '@renderer/store/standingsStore'

describe('market/standings stores surface non-Error rejections honestly', () => {
  beforeEach(() => {
    ipc.market.winner.mockReset()
    ipc.standings.season.mockReset()
    useMarketStore.getState().clear()
    useStandingsStore.getState().clear()
  })

  it('marketStore.refresh keeps the message of an Error', async () => {
    ipc.market.winner.mockRejectedValueOnce(new Error('market down'))
    await useMarketStore.getState().refresh({ query: 'q' })
    expect(useMarketStore.getState().error).toBe('market down')
  })

  it('marketStore.refresh reports a thrown string instead of undefined', async () => {
    ipc.market.winner.mockRejectedValueOnce('string failure')
    await useMarketStore.getState().refresh({ query: 'q' })
    expect(useMarketStore.getState().error).toBe('string failure')
  })

  it('marketStore.refresh never leaves error undefined for an opaque rejection', async () => {
    ipc.market.winner.mockRejectedValueOnce(undefined)
    await useMarketStore.getState().refresh({ query: 'q' })
    const { error } = useMarketStore.getState()
    expect(typeof error).toBe('string')
    expect(error).not.toBe('')
  })

  it('standingsStore.load reports a thrown string instead of undefined', async () => {
    ipc.standings.season.mockRejectedValueOnce('standings string failure')
    await useStandingsStore.getState().load(2026, '2026-07-01')
    expect(useStandingsStore.getState().error).toBe('standings string failure')
  })

  it('standingsStore.load never leaves error undefined for an opaque rejection', async () => {
    ipc.standings.season.mockRejectedValueOnce({ code: 500 })
    await useStandingsStore.getState().load(2026, '2026-07-02')
    const { error } = useStandingsStore.getState()
    expect(typeof error).toBe('string')
    expect(error).not.toBe('')
  })
})
