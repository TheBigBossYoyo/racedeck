import type { TyreCompound } from '@shared/models'
import type { RaceSnapshot } from '@renderer/core/model/snapshot'
import { compoundModel, driverRecentPace } from '../AnalyticsEngine'
import { raceRulesForSession, remainingStopRequirement } from '../PitCycleModel'
import { circuitPitLoss } from './PitLoss'
import { snapshotWithKnownLaps } from './StintLaps'

const MIN_OPENING_STINT_PLAN_AGE = 4
const MIN_OPENING_STINT_STOP_AGE = 8

// ── Optimal remaining stint strategy ────────────────────────────────────────────

const DRY_COMPOUNDS: TyreCompound[] = ['SOFT', 'MEDIUM', 'HARD']

export interface StintSegment {
  compound: TyreCompound
  /** First lap of this stint (1-indexed). */
  startLap: number
  laps: number
  /** Tyre age at the start of the stint. */
  startAge: number
}

export interface StrategyPlan {
  stops: number
  segments: StintSegment[]
  /** Projected time (s) for the remaining laps under this plan. */
  finishTimeSec: number
  /** Seconds slower than the best plan. */
  deltaSec: number
  label: string
  /** Whether the plan (plus tyres already used) satisfies the 2-compound rule. */
  usesTwoCompounds: boolean
}

export interface RemainingStrategy {
  available: boolean
  reason: string | null
  driverNumber: number
  code: string
  lapsRemaining: number
  currentCompound: TyreCompound | null
  currentAge: number | null
  usedCompounds: TyreCompound[]
  minimumTotalStops: number
  minimumRemainingStops: number
  ruleLabel: string
  /** Confidence behind the stop-count read itself (from `remainingStopRequirement`); null before it's known. */
  stopConfidence: 'high' | 'medium' | null
  recommended: StrategyPlan | null
  alternatives: StrategyPlan[]
  isEstimate: true
}

function planLabel(plan: StrategyPlan): string {
  if (plan.stops === 0) {
    const c = plan.segments[0]?.compound ?? '—'
    return `No further stop · ${c} to the flag`
  }
  const stints = plan.segments.slice(1) // stints that begin with a pit
  const parts = stints.map((s) => `box L${s.startLap - 1} → ${s.compound}`)
  return `${plan.stops}-stop · ${parts.join(' · ')}`
}

/**
 * Optimal remaining stint plan for a driver: searches 0/1/2-stop options over a
 * pace + degradation model calibrated from THIS event's real laps, enforces the
 * dry two-compound rule, and ranks by projected finish time. All estimates.
 */
export function planRemainingStrategy(
  snapshot: RaceSnapshot,
  driverNumber: number,
  greenPitLoss = circuitPitLoss(snapshot).seconds
): RemainingStrategy {
  const liveSnapshot = snapshotWithKnownLaps(snapshot)
  const code = snapshot.drivers.find((d) => d.number === driverNumber)?.code ?? `#${driverNumber}`
  let base: RemainingStrategy = {
    available: false,
    reason: null,
    driverNumber,
    code,
    lapsRemaining: 0,
    currentCompound: null,
    currentAge: null,
    usedCompounds: [],
    minimumTotalStops: 0,
    minimumRemainingStops: 0,
    ruleLabel: 'No race tyre rule',
    stopConfidence: null,
    recommended: null,
    alternatives: [],
    isEstimate: true
  }

  if (liveSnapshot.session.type !== 'race')
    return { ...base, reason: 'Stint planning applies to races.' }
  const total = liveSnapshot.totalLaps
  const cur = liveSnapshot.currentLap
  if (total == null || cur == null) return { ...base, reason: 'Race lap count unknown.' }
  const lapsRemaining = Math.max(0, total - cur)
  if (lapsRemaining < 2)
    return { ...base, lapsRemaining, reason: 'Too few laps remaining to plan.' }
  if (liveSnapshot.weather?.rainfall) {
    return {
      ...base,
      lapsRemaining,
      reason: 'Wet conditions — the dry stint model does not apply.'
    }
  }

  const entry = liveSnapshot.timing.find((t) => t.driverNumber === driverNumber)
  if (!entry) return { ...base, lapsRemaining, reason: 'Driver not in the current classification.' }
  const currentCompound = entry?.compound ?? null
  const currentAge = entry?.stintAge ?? 0
  const rules = raceRulesForSession(liveSnapshot.session)
  const stopState = remainingStopRequirement(liveSnapshot, entry)
  const openingStint = stopState.completedStops === 0
  const completedStops = stopState.completedStops
  const minimumTotalStops = stopState.minimumTotalStops
  const minimumRemainingStops = stopState.requiredStopsRemaining
  const ruleLabel = stopState.ruleLabel
  // Every later `{...base, ...}` return picks this up automatically.
  base = { ...base, stopConfidence: stopState.confidence }
  if (openingStint && currentAge < MIN_OPENING_STINT_PLAN_AGE) {
    return {
      ...base,
      lapsRemaining,
      currentCompound,
      currentAge,
      minimumTotalStops,
      minimumRemainingStops,
      ruleLabel,
      reason: 'Opening stint is still too fresh to rank pit windows yet.'
    }
  }

  const model = compoundModel(liveSnapshot)
  if (model.size === 0) {
    return {
      ...base,
      lapsRemaining,
      currentCompound,
      currentAge,
      minimumTotalStops,
      minimumRemainingStops,
      ruleLabel,
      reason: 'Not enough clean-lap data to model the compounds yet.'
    }
  }

  const used = new Set<TyreCompound>()
  for (const st of liveSnapshot.stints) {
    if (st.driverNumber === driverNumber && st.lapStart <= cur) used.add(st.tyre.compound)
  }
  if (currentCompound) used.add(currentCompound)

  // Personalise the model with the driver's recent pace vs the field.
  const dRecent = driverRecentPace(liveSnapshot, driverNumber)
  const curModel = currentCompound ? model.get(currentCompound) : null
  const offset = dRecent != null && curModel ? dRecent - curModel.pace : 0
  const canMakeOpeningStop = (lapsIntoCurrentStint: number) =>
    !openingStint || currentAge + lapsIntoCurrentStint >= MIN_OPENING_STINT_STOP_AGE

  const stintTime = (compound: TyreCompound, laps: number, startAge: number): number => {
    const m = model.get(compound)
    if (laps <= 0) return 0
    if (!m) return Infinity
    const pace = m.pace + offset
    // Σ (pace + deg*(startAge + i)) for i in [0, laps)
    return laps * pace + m.deg * (startAge * laps + (laps * (laps - 1)) / 2)
  }

  const candidates = DRY_COMPOUNDS.filter((c) => model.has(c))
  const usesRequiredCompounds = (compounds: TyreCompound[]) =>
    stopState.wetTyreUsed ||
    !rules.requiresTwoDryCompounds ||
    new Set([...used, ...compounds]).size >= 2

  const makePlan = (segments: StintSegment[], stops: number): StrategyPlan => {
    const finishTimeSec =
      segments.reduce((a, s) => a + stintTime(s.compound, s.laps, s.startAge), 0) +
      stops * greenPitLoss
    const plan: StrategyPlan = {
      stops,
      segments,
      finishTimeSec,
      deltaSec: 0,
      label: '',
      usesTwoCompounds: usesRequiredCompounds(segments.map((s) => s.compound))
    }
    plan.label = planLabel(plan)
    return plan
  }

  const plans: StrategyPlan[] = []

  // 0-stop
  if (currentCompound) {
    plans.push(
      makePlan(
        [
          {
            compound: currentCompound,
            startLap: cur + 1,
            laps: lapsRemaining,
            startAge: currentAge
          }
        ],
        0
      )
    )
  }

  // 1-stop — try every remaining pit lap × candidate compound.
  for (let pitLap = cur + 1; pitLap <= total - 1; pitLap++) {
    const seg1Laps = pitLap - cur
    const seg2Laps = total - pitLap
    if (currentCompound && !canMakeOpeningStop(seg1Laps)) continue
    for (const c of candidates) {
      const segments: StintSegment[] = []
      if (currentCompound && seg1Laps > 0) {
        segments.push({
          compound: currentCompound,
          startLap: cur + 1,
          laps: seg1Laps,
          startAge: currentAge
        })
      }
      segments.push({ compound: c, startLap: pitLap + 1, laps: seg2Laps, startAge: 0 })
      plans.push(makePlan(segments, 1))
    }
  }

  // 2-stop — coarse search so it stays cheap.
  const step = Math.max(2, Math.round(lapsRemaining / 6))
  for (let p1 = cur + step; p1 <= total - step; p1 += step) {
    if (currentCompound && !canMakeOpeningStop(p1 - cur)) continue
    for (let p2 = p1 + step; p2 <= total - 1; p2 += step) {
      for (const c1 of candidates) {
        for (const c2 of candidates) {
          const segments: StintSegment[] = []
          if (currentCompound) {
            segments.push({
              compound: currentCompound,
              startLap: cur + 1,
              laps: p1 - cur,
              startAge: currentAge
            })
          }
          segments.push({ compound: c1, startLap: p1 + 1, laps: p2 - p1, startAge: 0 })
          segments.push({ compound: c2, startLap: p2 + 1, laps: total - p2, startAge: 0 })
          plans.push(makePlan(segments, 2))
        }
      }
    }
  }

  // Rank only plans that satisfy both the event's minimum-stop and compound rules.
  const legal = plans.filter(
    (plan) => completedStops + plan.stops >= minimumTotalStops && plan.usesTwoCompounds
  )
  const pool = legal.sort((a, b) => a.finishTimeSec - b.finishTimeSec)
  const best = pool[0]
  if (!best) {
    return {
      ...base,
      lapsRemaining,
      currentCompound,
      currentAge,
      usedCompounds: [...used],
      minimumTotalStops,
      minimumRemainingStops,
      ruleLabel,
      reason: `No legal plan found for ${ruleLabel.toLowerCase()}.`
    }
  }

  // De-duplicate near-identical plans (same stops + compounds + ~pit windows).
  const seen = new Set<string>()
  const ranked: StrategyPlan[] = []
  for (const p of pool) {
    const sig =
      `${p.stops}:` +
      p.segments.map((s) => s.compound).join('') +
      ':' +
      p.segments
        .slice(1)
        .map((s) => Math.round(s.startLap / 3))
        .join(',')
    if (seen.has(sig)) continue
    seen.add(sig)
    ranked.push(p)
    if (ranked.length >= 4) break
  }
  for (const p of ranked) p.deltaSec = p.finishTimeSec - best.finishTimeSec

  return {
    ...base,
    available: true,
    lapsRemaining,
    currentCompound,
    currentAge,
    usedCompounds: [...used],
    minimumTotalStops,
    minimumRemainingStops,
    ruleLabel,
    recommended: ranked[0] ?? null,
    alternatives: ranked.slice(1)
  }
}
