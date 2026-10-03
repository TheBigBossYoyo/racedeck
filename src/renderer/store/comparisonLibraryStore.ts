import { create } from 'zustand'
import { STORE_NS } from '@shared/ipc-contract'
import { persist } from './persist'
import { isRecord, writeLogged } from './persistWrite'
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

const finiteOrNull = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null

const stringOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null)

/** Keys with a finite number (or, when `allowNull`, null); anything else is dropped, never guessed. */
function numberRecord(v: unknown, allowNull: boolean): Record<string, number | null> | null {
  if (!isRecord(v)) return null
  const out: Record<string, number | null> = {}
  for (const [key, value] of Object.entries(v)) {
    const n = finiteOrNull(value)
    if (n !== null || (allowNull && value === null)) out[key] = n
  }
  return out
}

/**
 * Rebuild a saved summary from untrusted JSON. The comparison table reads
 * `weather.*`, `teamPaceMs` and `degradationByCompound` unguarded, so an entry
 * missing any of those is dropped rather than left to crash the page.
 */
function sanitizeSummary(value: unknown): ComparisonSummary | null {
  if (!isRecord(value)) return null
  const { sessionId, sessionName, weather } = value
  if (typeof sessionId !== 'string' || typeof sessionName !== 'string') return null
  const degradation = numberRecord(value.degradationByCompound, true)
  const teamPace = numberRecord(value.teamPaceMs, false)
  if (!degradation || !teamPace || !isRecord(weather)) return null
  return {
    sessionId,
    meetingName: stringOrNull(value.meetingName),
    sessionName,
    dateStart: stringOrNull(value.dateStart),
    pitLossMedianSec: finiteOrNull(value.pitLossMedianSec),
    degradationByCompound: degradation as ComparisonSummary['degradationByCompound'],
    topSpeedKmh: finiteOrNull(value.topSpeedKmh),
    teamPaceMs: teamPace as Record<string, number>,
    weather: {
      avgTrackTempC: finiteOrNull(weather.avgTrackTempC),
      avgAirTempC: finiteOrNull(weather.avgAirTempC),
      rainFraction: finiteOrNull(weather.rainFraction)
    }
  }
}

function sanitizeSummaries(raw: unknown): ComparisonSummary[] {
  if (!Array.isArray(raw)) return []
  return raw.map(sanitizeSummary).filter((e): e is ComparisonSummary => e !== null)
}

export const useComparisonLibraryStore = create<ComparisonLibraryState>((set, get) => ({
  entries: [],
  hydrated: false,

  hydrate: async () => {
    const raw = await persist.get<unknown>(STORE_NS.COMPARISON_LIBRARY, K.entries)
    set({ entries: sanitizeSummaries(raw), hydrated: true })
  },

  save: (summary) => {
    const entries = [...get().entries.filter((e) => e.sessionId !== summary.sessionId), summary]
    set({ entries })
    writeLogged(STORE_NS.COMPARISON_LIBRARY, K.entries, entries)
  },

  remove: (sessionId) => {
    const entries = get().entries.filter((e) => e.sessionId !== sessionId)
    set({ entries })
    writeLogged(STORE_NS.COMPARISON_LIBRARY, K.entries, entries)
  }
}))
