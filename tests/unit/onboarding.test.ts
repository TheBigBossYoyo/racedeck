import { describe, it, expect, beforeEach } from 'vitest'
import { persist } from '@renderer/store/persist'
import { STORE_NS } from '@shared/ipc-contract'
import { useOnboardingStore } from '@renderer/store/onboardingStore'

describe('onboardingStore', () => {
  beforeEach(() => {
    persist.__resetMemory()
    try {
      localStorage.clear()
    } catch {
      /* no localStorage in this environment */
    }
    useOnboardingStore.setState({ open: false })
  })

  it('opens the welcome tour on first run', async () => {
    await useOnboardingStore.getState().hydrate()
    expect(useOnboardingStore.getState().open).toBe(true)
  })

  it('does not reopen once it has been dismissed', async () => {
    useOnboardingStore.getState().openTour()
    useOnboardingStore.getState().dismiss()
    expect(useOnboardingStore.getState().open).toBe(false)
    await new Promise((resolve) => setTimeout(resolve, 0))

    useOnboardingStore.setState({ open: false })
    await useOnboardingStore.getState().hydrate()
    expect(useOnboardingStore.getState().open).toBe(false)
  })

  it('force-opens on demand regardless of the seen flag', async () => {
    await persist.set(STORE_NS.SETTINGS, 'onboardingSeen', true)
    useOnboardingStore.getState().openTour()
    expect(useOnboardingStore.getState().open).toBe(true)
  })
})
