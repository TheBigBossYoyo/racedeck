import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { persist } from '@renderer/store/persist'
import { usePersistStatusStore } from '@renderer/store/persistStatusStore'

const NS = 'test-namespace'

describe('persist corruption handling', () => {
  beforeEach(() => {
    persist.__resetMemory()
    localStorage.clear()
    usePersistStatusStore.setState({ corruptions: [] })
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => vi.restoreAllMocks())

  it('returns null and reports corruption instead of throwing on malformed JSON', async () => {
    localStorage.setItem(`${NS}:broken`, '{not valid json')

    const result = await persist.get(NS, 'broken')

    expect(result).toBeNull()
    expect(usePersistStatusStore.getState().corruptions).toContainEqual(
      expect.objectContaining({ namespace: NS, key: 'broken' })
    )
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Corrupted JSON'))
  })

  it('does not report a duplicate corruption for the same entry on repeated reads', async () => {
    localStorage.setItem(`${NS}:broken`, '{not valid json')

    await persist.get(NS, 'broken')
    await persist.get(NS, 'broken')

    expect(usePersistStatusStore.getState().corruptions).toHaveLength(1)
  })

  it('leaves well-formed entries untouched when scanning a namespace with all()', async () => {
    localStorage.setItem(`${NS}:good`, JSON.stringify({ ok: true }))
    localStorage.setItem(`${NS}:bad`, '{not valid json')

    const all = await persist.all<Record<string, unknown>>(NS)

    expect(all.good).toEqual({ ok: true })
    expect(all.bad).toBeUndefined()
    expect(usePersistStatusStore.getState().corruptions).toContainEqual(
      expect.objectContaining({ namespace: NS, key: 'bad' })
    )
  })

  it('resetCorrupted removes the corrupted entries and clears the warning', async () => {
    localStorage.setItem(`${NS}:broken`, '{not valid json')
    await persist.get(NS, 'broken')
    expect(usePersistStatusStore.getState().corruptions).toHaveLength(1)

    await persist.resetCorrupted()

    expect(usePersistStatusStore.getState().corruptions).toEqual([])
    expect(localStorage.getItem(`${NS}:broken`)).toBeNull()
  })
})
