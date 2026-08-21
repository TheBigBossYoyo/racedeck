import { create } from 'zustand'
import type { SeasonChampionship } from '@shared/standings'
import { hasBridge, bridge } from '@renderer/lib/ipc'

/**
 * standingsStore — holds the championship baseline (pre-round standings) for the
 * current session, fetched once from public Jolpica data via the main process.
 * The live projection is computed in the widget from this baseline plus the
 * synced race classification, so the store performs no polling. Degrades
 * gracefully with no bridge (browser/test) or when the API is unavailable.
 */

interface StandingsStoreState {
  loading: boolean
  error: string | null
  championship: SeasonChampionship | null
  /** Cache key of the last successful/attempted fetch (`year:date`). */
  key: string | null
  load: (year: number | null, sessionDate: string | null) => Promise<void>
  clear: () => void
}

let requestVersion = 0

export const useStandingsStore = create<StandingsStoreState>((set, get) => ({
  loading: false,
  error: null,
  championship: null,
  key: null,

  load: async (year, sessionDate) => {
    if (year == null || !Number.isFinite(year)) {
      set({ championship: null, error: null, loading: false, key: null })
      return
    }
    const key = `${year}:${sessionDate ?? ''}`
    // Already have (or are fetching) this season/round baseline.
    if (get().key === key && (get().championship != null || get().loading)) return
    if (!hasBridge()) {
      set({ error: 'Championship standings require the desktop app.', loading: false, key })
      return
    }
    const version = ++requestVersion
    set({ loading: true, error: null, key, championship: null })
    try {
      const result = await bridge().standings.season({ year, sessionDate })
      if (version !== requestVersion) return
      set({
        championship: result.ok ? result.championship : null,
        error: result.ok ? null : result.error,
        loading: false
      })
    } catch (e) {
      if (version !== requestVersion) return
      set({ championship: null, error: (e as Error).message, loading: false })
    }
  },

  clear: () => {
    requestVersion++
    set({ loading: false, error: null, championship: null, key: null })
  }
}))
