import { create } from 'zustand'
import { STORE_NS } from '@shared/ipc-contract'
import { persist } from './persist'
import type { ComparisonSummary } from '@renderer/core/engines/ComparisonSummary'

/**
 * Saved cross-race comparison summaries (APP_IMPROVEMENT_ROADMAP.md P3 item
 * 35). Persists only the plain-data `ComparisonSummary` shape — never a
 * `RaceSnapshot` or media URL — mirroring `layoutStore.savedLayouts`'s
 * single-array persistence.
 */

interface ComparisonLibraryState {
  entries: ComparisonSummary[]
  hydrated: boolean

  hydrate: () => Promise<void>
  save: (summary: ComparisonSummary) => void
  remove: (sessionId: string) => void
}

const K = { entries: 'entries' }

function isComparisonSummaryArray(v: unknown): v is ComparisonSummary[] {
  return (
    Array.isArray(v) &&
    v.every((e) => e && typeof e === 'object' && typeof e.sessionId === 'string')
  )
}

export const useComparisonLibraryStore = create<ComparisonLibraryState>((set, get) => ({
  entries: [],
  hydrated: false,

  hydrate: async () => {
    const raw = await persist.get<unknown>(STORE_NS.COMPARISON_LIBRARY, K.entries)
    set({ entries: isComparisonSummaryArray(raw) ? raw : [], hydrated: true })
  },

  save: (summary) => {
    const entries = [...get().entries.filter((e) => e.sessionId !== summary.sessionId), summary]
    set({ entries })
    void persist.set(STORE_NS.COMPARISON_LIBRARY, K.entries, entries)
  },

  remove: (sessionId) => {
    const entries = get().entries.filter((e) => e.sessionId !== sessionId)
    set({ entries })
    void persist.set(STORE_NS.COMPARISON_LIBRARY, K.entries, entries)
  }
}))
