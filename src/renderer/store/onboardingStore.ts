import { create } from 'zustand'
import { persist } from '@renderer/store/persist'
import { STORE_NS } from '@shared/ipc-contract'

/**
 * onboardingStore — drives the first-run welcome tour. `hydrate()` opens the
 * tour once (only if it has never been completed/skipped on this device);
 * `dismiss()` persists that it has been seen and closes it. `openTour()`
 * re-opens it on demand (from the command palette), regardless of the flag.
 */

const SEEN_KEY = 'onboardingSeen'

interface OnboardingState {
  open: boolean
  hydrate: () => Promise<void>
  openTour: () => void
  dismiss: () => void
}

export const useOnboardingStore = create<OnboardingState>((set) => ({
  open: false,

  hydrate: async () => {
    try {
      const seen = await persist.get<boolean>(STORE_NS.SETTINGS, SEEN_KEY)
      if (!seen) set({ open: true })
    } catch {
      /* never block startup on the tour */
    }
  },

  openTour: () => set({ open: true }),

  dismiss: () => {
    set({ open: false })
    void persist.set(STORE_NS.SETTINGS, SEEN_KEY, true)
  }
}))
