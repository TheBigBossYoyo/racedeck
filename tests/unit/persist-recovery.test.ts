import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RaceDeckApi } from '@shared/ipc-contract'
import { persist } from '@renderer/store/persist'
import { usePersistStatusStore } from '@renderer/store/persistStatusStore'

// tests/unit/setup.ts imports `persist` before any test file's vi.mock can
// register, so the bridge is faked on `window` (what hasBridge() reads) instead.
const recovery = vi.fn()

function installBridge(): void {
  ;(window as Window).racedeck = { store: { recovery } } as unknown as RaceDeckApi
}

describe('persist.checkRecovery', () => {
  beforeEach(() => {
    recovery.mockReset()
    installBridge()
    usePersistStatusStore.setState({ corruptions: [], recoveredBackup: null })
  })

  afterEach(() => {
    delete (window as Partial<Window>).racedeck
    vi.restoreAllMocks()
  })

  it('surfaces a config file the main process had to set aside', async () => {
    recovery.mockResolvedValue({ backupPath: 'C:\\data\\racedeck.corrupt-1.json' })

    await persist.checkRecovery()

    expect(usePersistStatusStore.getState().recoveredBackup).toBe(
      'C:\\data\\racedeck.corrupt-1.json'
    )
  })

  it('stays quiet when nothing was recovered', async () => {
    recovery.mockResolvedValue(null)

    await persist.checkRecovery()

    expect(recovery).toHaveBeenCalledTimes(1)
    expect(usePersistStatusStore.getState().recoveredBackup).toBeNull()
  })

  it('does nothing outside the desktop shell', async () => {
    delete (window as Partial<Window>).racedeck

    await persist.checkRecovery()

    expect(recovery).not.toHaveBeenCalled()
    expect(usePersistStatusStore.getState().recoveredBackup).toBeNull()
  })

  it('logs and carries on if the check itself fails, so boot is never blocked', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    recovery.mockRejectedValue(new Error('ipc down'))

    await expect(persist.checkRecovery()).resolves.toBeUndefined()

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('ipc down'))
    expect(usePersistStatusStore.getState().recoveredBackup).toBeNull()
  })
})

describe('usePersistStatusStore recovery notice', () => {
  it('can be dismissed without touching tracked corruptions', () => {
    usePersistStatusStore.setState({
      corruptions: [{ namespace: 'a', key: 'b', message: 'm' }],
      recoveredBackup: 'x.json'
    })

    usePersistStatusStore.getState().dismissRecovery()

    const s = usePersistStatusStore.getState()
    expect(s.recoveredBackup).toBeNull()
    expect(s.corruptions).toHaveLength(1)
  })
})
