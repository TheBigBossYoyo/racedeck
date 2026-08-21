import { create } from 'zustand'
import type { AiMessage } from '@shared/ai'
import { isAiConfigReady } from '@shared/ai'
import { hasBridge, bridge } from '@renderer/lib/ipc'
import {
  StrategyEngine,
  planRemainingStrategy,
  paceComparison,
  type PitPrediction
} from '@renderer/core/engines/StrategyEngine'
import { analyticsSummary } from '@renderer/core/engines/AnalyticsEngine'
import {
  WinProbabilityEngine,
  winProbabilitySummary
} from '@renderer/core/engines/WinProbabilityEngine'
import type { RaceSnapshot } from '@renderer/core/providers/types'
import {
  buildRaceContext,
  buildBriefingMessages,
  buildQuestionMessages
} from '@renderer/core/engines/StrategyContext'
import { useSessionStore } from './sessionStore'
import { useSettingsStore } from './settingsStore'
import { useMarketStore, matchOutcomesToDrivers } from './marketStore'

export interface ChatTurn {
  id: string
  role: 'user' | 'assistant'
  content: string
  at: number
  error?: boolean
}

interface BriefingState {
  loading: boolean
  text: string
  error: string | null
  at: number | null
  model: string | null
}

interface StrategyStoreState {
  /** The driver the strategy tools focus on (null → leader / first favourite). */
  selectedDriver: number | null
  briefing: BriefingState
  chat: ChatTurn[]
  asking: boolean

  setSelectedDriver: (n: number | null) => void
  /** Resolve the effective driver (explicit selection, else favourite, else leader). */
  effectiveDriver: () => number | null
  /** Deterministic pit-now projection for the effective driver. */
  currentPrediction: () => PitPrediction | null
  generateBriefing: () => Promise<void>
  ask: (question: string) => Promise<void>
  clearChat: () => void
}

const idOf = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

/**
 * De-vigged Polymarket win odds vs the model, when the market overlay is on — so
 * the AI can reason about where the crowd and the model disagree. Public,
 * third-party, opt-in; empty when disabled or no market matched.
 */
function marketSummary(snap: RaceSnapshot): string {
  const settings = useSettingsStore.getState().market
  const result = useMarketStore.getState().result
  if (!settings.enabled || !result?.ok) return ''
  const { byDriver } = matchOutcomesToDrivers(result.outcomes, snap.drivers)
  if (byDriver.size === 0) return ''
  const rows = [...byDriver.entries()]
    .map(([num, o]) => ({
      code: snap.drivers.find((d) => d.number === num)?.code ?? `#${num}`,
      fair: o.fairProbability
    }))
    .sort((a, b) => b.fair - a.fair)
    .slice(0, 6)
  const closed = result.event?.closed
  return (
    `PREDICTION MARKET (Polymarket${closed ? ', settled' : ''}, de-vigged, third-party):\n` +
    rows.map((r) => `  - ${r.code}: ${(r.fair * 100).toFixed(0)}% implied win.`).join('\n')
  )
}

/** Analytics summary + the focus driver's optimal plan and pace battle, for the AI. */
function fullAnalytics(snap: RaceSnapshot, driver: number | null): string {
  const parts = [analyticsSummary(snap)]
  const winModel = WinProbabilityEngine.compute(snap)
  const winSummary = winProbabilitySummary(winModel)
  if (winSummary) parts.push(winSummary)
  const market = marketSummary(snap)
  if (market) parts.push(market)
  if (driver != null) {
    const plan = planRemainingStrategy(snap, driver)
    if (plan.available && plan.recommended) {
      parts.push(
        `OPTIMAL STINT PLAN (${plan.code}, ${plan.lapsRemaining} laps left): ${plan.recommended.label}. ` +
        `Rule: ${plan.ruleLabel}; ${plan.minimumRemainingStops} required stop${plan.minimumRemainingStops === 1 ? '' : 's'} remaining.`
      )
    } else if (plan.reason) {
      parts.push(
        `STINT PLAN (${plan.code}): unavailable — ${plan.reason} ` +
        `Rule: ${plan.ruleLabel}; ${plan.minimumRemainingStops} required stop${plan.minimumRemainingStops === 1 ? '' : 's'} remaining.`
      )
    }
    const battle = paceComparison(snap, driver)
    if (battle.available) {
      const seg: string[] = []
      const fmtRate = (r: number | null | undefined) =>
        r == null ? '—' : `${r > 0 ? 'closing' : 'losing'} ${Math.abs(r).toFixed(2)}s/lap`
      if (battle.ahead) seg.push(`ahead ${battle.ahead.code} +${battle.ahead.gapSec?.toFixed(1) ?? '?'}s (${fmtRate(battle.ahead.deltaPerLap)})`)
      if (battle.behind) seg.push(`behind ${battle.behind.code} +${battle.behind.gapSec?.toFixed(1) ?? '?'}s (${fmtRate(battle.behind.deltaPerLap)})`)
      if (seg.length) parts.push(`PACE BATTLE (${battle.code}): ${seg.join('; ')}.`)
    }
  }
  return parts.filter(Boolean).join('\n')
}

function resolveDriver(explicit: number | null): number | null {
  const session = useSessionStore.getState()
  const snap = session.snapshot
  if (!snap || snap.timing.length === 0) return null
  const inField = (n: number | null | undefined): n is number =>
    n != null && snap.timing.some((t) => t.driverNumber === n)
  // Explicit strategy selection → focus driver (clicks anywhere) → favourite → leader.
  if (inField(explicit)) return explicit
  if (inField(session.focusDriver)) return session.focusDriver
  const favs = useSettingsStore.getState().favorites
  const fav = snap.timing.find((t) => favs.includes(t.driverNumber))
  if (fav) return fav.driverNumber
  return snap.timing[0]?.driverNumber ?? null
}

export const useStrategyStore = create<StrategyStoreState>((set, get) => ({
  selectedDriver: null,
  briefing: { loading: false, text: '', error: null, at: null, model: null },
  chat: [],
  asking: false,

  setSelectedDriver: (n) => set({ selectedDriver: n }),

  effectiveDriver: () => resolveDriver(get().selectedDriver),

  currentPrediction: () => {
    const snap = useSessionStore.getState().snapshot
    const driver = resolveDriver(get().selectedDriver)
    if (!snap || driver == null) return null
    const laps = useSessionStore.getState().getDriverLaps(driver)
    return StrategyEngine.predictPitStop(snap, driver, laps)
  },

  generateBriefing: async () => {
    const snap = useSessionStore.getState().snapshot
    const ai = useSettingsStore.getState().ai
    const set_ = (patch: Partial<BriefingState>) =>
      set({ briefing: { ...get().briefing, ...patch } })

    if (!snap) return set_({ error: 'No live session data to brief on yet.', loading: false })
    if (!isAiConfigReady(ai)) {
      return set_({
        error: 'Add your AI provider + key in Settings → AI Race Engineer to enable briefings.',
        loading: false
      })
    }
    if (!hasBridge()) {
      return set_({ error: 'AI is only available inside the RaceDeck desktop app.', loading: false })
    }

    const driver = resolveDriver(get().selectedDriver)
    const prediction = get().currentPrediction()
    const code = driver != null ? snap.drivers.find((d) => d.number === driver)?.code ?? null : null
    const analytics = fullAnalytics(snap, driver)
    const context = buildRaceContext(snap, { focusDriver: driver, prediction, analytics })
    const messages = buildBriefingMessages(context, code)

    set_({ loading: true, error: null })
    const res = await bridge().ai.complete({ config: ai, messages, temperature: 0.4 })
    if (res.ok) {
      set_({ loading: false, text: res.text, error: null, at: Date.now(), model: res.model })
    } else {
      set_({ loading: false, error: res.error ?? 'AI request failed.' })
    }
  },

  ask: async (question) => {
    const q = question.trim()
    if (!q || get().asking) return
    const snap = useSessionStore.getState().snapshot
    const ai = useSettingsStore.getState().ai

    const userTurn: ChatTurn = { id: idOf(), role: 'user', content: q, at: Date.now() }
    set({ chat: [...get().chat, userTurn], asking: true })

    const fail = (msg: string) =>
      set({
        chat: [...get().chat, { id: idOf(), role: 'assistant', content: msg, at: Date.now(), error: true }],
        asking: false
      })

    if (!snap) return fail('No live session data to analyse yet.')
    if (!isAiConfigReady(ai)) {
      return fail('Add your AI provider + key in Settings → AI Race Engineer to ask the strategist.')
    }
    if (!hasBridge()) return fail('AI is only available inside the RaceDeck desktop app.')

    const driver = resolveDriver(get().selectedDriver)
    const prediction = get().currentPrediction()
    const analytics = fullAnalytics(snap, driver)
    const context = buildRaceContext(snap, { focusDriver: driver, prediction, analytics })
    const history: AiMessage[] = get()
      .chat.slice(-6, -1) // prior turns, excluding the one we just added
      .map((t) => ({ role: t.role, content: t.content }))
    const messages = buildQuestionMessages(context, q, history)

    const res = await bridge().ai.complete({ config: ai, messages, temperature: 0.5 })
    if (res.ok) {
      set({
        chat: [...get().chat, { id: idOf(), role: 'assistant', content: res.text, at: Date.now() }],
        asking: false
      })
    } else {
      fail(res.error ?? 'AI request failed.')
    }
  },

  clearChat: () => set({ chat: [] })
}))
