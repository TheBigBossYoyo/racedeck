import { create } from 'zustand'

export interface PersistCorruption {
  namespace: string
  key: string
  message: string
}

interface PersistStatusState {
  corruptions: PersistCorruption[]
  /** Where the main process kept a config file it could not read, if it had to. */
  recoveredBackup: string | null
  reportCorruption: (namespace: string, key: string, message: string) => void
  reportRecovery: (backupPath: string) => void
  dismissRecovery: () => void
  clearAll: () => void
}

/**
 * Tracks persisted-data JSON that failed to parse (IMPROVEMENT_OPPORTUNITIES.md
 * item #15). `persist.ts` reports into this store instead of only logging, so
 * `StatusBar`'s issue panel can surface the corruption and offer a "Reset to
 * Defaults" recovery action rather than silently falling back forever.
 */
export const usePersistStatusStore = create<PersistStatusState>((set, get) => ({
  corruptions: [],
  recoveredBackup: null,

  reportRecovery: (backupPath) => set({ recoveredBackup: backupPath }),

  dismissRecovery: () => set({ recoveredBackup: null }),

  reportCorruption: (namespace, key, message) => {
    if (get().corruptions.some((c) => c.namespace === namespace && c.key === key)) return
    set((s) => ({ corruptions: [...s.corruptions, { namespace, key, message }] }))
  },

  clearAll: () => set({ corruptions: [] })
}))
