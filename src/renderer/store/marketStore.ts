import { create } from 'zustand'
import type {
  MarketOutcome,
  MarketWinnerResult,
  MarketHistoryPoint
} from '@shared/market'
import type { Driver } from '@shared/models'
import { hasBridge, bridge } from '@renderer/lib/ipc'

/**
 * marketStore — holds the latest Polymarket win-odds result plus a small cache
 * of per-token price history (for replay-synced odds). It performs no polling of
 * its own; the WinProbability widget drives `refresh()` on an interval while a
 * live session plays. Everything degrades gracefully when the bridge is absent
 * (browser/test) or no market matches.
 */

interface MarketStoreState {
  loading: boolean
  error: string | null
  result: MarketWinnerResult | null
  /** Wall-clock ms of the last successful fetch. */
  fetchedAtMs: number
  /** yesTokenId → ascending price history. */
  historyByToken: Record<string, MarketHistoryPoint[]>
  historyLoading: Record<string, boolean>
  historyErrorByToken: Record<string, string | null>

  refresh: (opts: { query?: string; slug?: string; targetDateMs?: number }) => Promise<void>
  loadHistory: (yesTokenId: string, targetUnix?: number) => Promise<void>
  clear: () => void
}

let marketRequestVersion = 0
let historyRequestVersion = 0

export const useMarketStore = create<MarketStoreState>((set, get) => ({
  loading: false,
  error: null,
  result: null,
  fetchedAtMs: 0,
  historyByToken: {},
  historyLoading: {},
  historyErrorByToken: {},

  refresh: async ({ query, slug, targetDateMs }) => {
    if (!hasBridge()) {
      set({ error: 'Market odds require the desktop app.', loading: false })
      return
    }
    const requestVersion = ++marketRequestVersion
    set({ loading: true, error: null })
    try {
      const result = await bridge().market.winner({ query, slug, targetDateMs })
      if (requestVersion !== marketRequestVersion) return
      set({
        result,
        loading: false,
        error: result.ok ? null : result.error,
        fetchedAtMs: Date.now()
      })
    } catch (e) {
      if (requestVersion !== marketRequestVersion) return
      set({ result: null, loading: false, error: (e as Error).message })
    }
  },

  loadHistory: async (yesTokenId, targetUnix) => {
    if (!hasBridge() || !yesTokenId) return
    if (
      Object.prototype.hasOwnProperty.call(get().historyByToken, yesTokenId) ||
      get().historyLoading[yesTokenId]
    ) return
    const requestVersion = historyRequestVersion
    set((s) => ({
      historyLoading: { ...s.historyLoading, [yesTokenId]: true },
      historyErrorByToken: { ...s.historyErrorByToken, [yesTokenId]: null }
    }))
    try {
      const hasTarget = targetUnix != null && Number.isFinite(targetUnix)
      const res = await bridge().market.history({
        yesTokenId,
        ...(hasTarget
          ? {
              startTs: Math.trunc(targetUnix - 7 * 24 * 60 * 60),
              endTs: Math.trunc(targetUnix + 24 * 60 * 60),
              fidelity: 30
            }
          : { interval: 'max', fidelity: 720 })
      })
      if (requestVersion !== historyRequestVersion) return
      set((s) => ({
        historyByToken: { ...s.historyByToken, [yesTokenId]: res.ok ? res.points : [] },
        historyLoading: { ...s.historyLoading, [yesTokenId]: false },
        historyErrorByToken: {
          ...s.historyErrorByToken,
          [yesTokenId]: res.ok ? null : res.error ?? 'Price history unavailable.'
        }
      }))
    } catch (error) {
      if (requestVersion !== historyRequestVersion) return
      set((s) => ({
        historyLoading: { ...s.historyLoading, [yesTokenId]: false },
        historyErrorByToken: {
          ...s.historyErrorByToken,
          [yesTokenId]: error instanceof Error ? error.message : 'Price history unavailable.'
        }
      }))
    }
  },

  clear: () => {
    marketRequestVersion++
    historyRequestVersion++
    set({
      loading: false,
      result: null,
      error: null,
      historyByToken: {},
      historyLoading: {},
      historyErrorByToken: {},
      fetchedAtMs: 0
    })
  }
}))

// ── Driver ⇄ outcome matching (pure) ────────────────────────────────────────────

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip accents
    .replace(/[^a-z]/g, '')
}

/**
 * Score how well a normalised market name matches a driver. Higher is better;
 * exact surname / full-name are strongest, then first-initial+surname, then a
 * suffix match ("maxverstappen" ends with "verstappen"), then code, then a
 * length-guarded fuzzy contains (so short surnames can't false-match).
 */
function matchScore(key: string, d: Driver): number {
  if (!key) return 0
  const last = norm(d.lastName ?? '')
  const first = norm(d.firstName ?? '')
  const full = norm(d.fullName ?? '')
  const code = norm(d.code ?? '')
  if (last && key === last) return 100
  if (full && key === full) return 100
  if (last && first && key === first[0] + last) return 92
  if (last && key.length > last.length && key.endsWith(last)) return 85
  if (full && (key.endsWith(full) || full.endsWith(key)) && Math.min(key.length, full.length) >= 6)
    return 60
  if (code && key === code) return 55
  if (last && last.length >= 4 && (key.includes(last) || last.includes(key))) return 40
  return 0
}

/**
 * Match market outcomes (usually driver surnames) to the session's drivers.
 * Greedy favourite-first assignment with scoring, so each driver is claimed once
 * by their best outcome and ambiguous/short names don't mis-map. Returns a map
 * driverNumber → outcome and the outcomes that didn't match.
 */
export function matchOutcomesToDrivers(
  outcomes: MarketOutcome[],
  drivers: Driver[]
): { byDriver: Map<number, MarketOutcome>; unmatched: MarketOutcome[] } {
  const byDriver = new Map<number, MarketOutcome>()
  const unmatched: MarketOutcome[] = []
  const taken = new Set<number>()

  for (const o of outcomes) {
    const key = norm(o.name)
    let best: Driver | null = null
    let bestScore = 0
    for (const d of drivers) {
      if (taken.has(d.number)) continue
      const s = matchScore(key, d)
      if (s > bestScore) {
        bestScore = s
        best = d
      }
    }
    if (best && bestScore >= 40) {
      byDriver.set(best.number, o)
      taken.add(best.number)
    } else {
      unmatched.push(o)
    }
  }
  return { byDriver, unmatched }
}

/** Build a Polymarket-friendly search query from the current session name. */
export function marketQueryForSession(session: {
  meetingName: string | null
  countryName: string | null
  year: number | null
}): string {
  const gp =
    session.meetingName?.replace(/grand prix.*/i, 'Grand Prix') ||
    (session.countryName ? `${session.countryName} Grand Prix` : '')
  return gp.trim()
}
