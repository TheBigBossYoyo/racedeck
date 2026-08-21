import type { TimingEntry } from '@shared/models'
import type { RaceSnapshot } from '@renderer/core/providers/types'
import { driverRecentPace } from './AnalyticsEngine'

/**
 * WinProbabilityEngine — a deterministic, always-available model for each
 * driver's chance of WINNING, making the PODIUM, and scoring POINTS, evaluated
 * at the current (sync-shifted) race moment.
 *
 * Everything here is an ESTIMATE derived only from real, available data — track
 * position, gaps, laps remaining, recent pace, tyre state and neutralisations.
 * It is never presented as fact, and it degrades gracefully (a quali/practice
 * session or a snapshot without gaps simply yields no projection).
 *
 * Method (pure + unit-tested):
 *  1. Each running driver gets a projected FINAL margin to the leader (seconds):
 *     current gap-to-leader, adjusted by how much fresher/faster pace would
 *     close (or open) it over the remaining laps.
 *  2. Finishing order is treated as noisy: driver i beats driver j with
 *     probability logistic((margin_j − margin_i) / β), where β (seconds) grows
 *     with the laps remaining and inflates under Safety Car / wet running — more
 *     race left ⇒ more upset potential; a few laps to go ⇒ near-certainty.
 *  3. For each driver we combine those pairwise "ahead" probabilities with a
 *     Poisson-binomial distribution over "number of cars finishing ahead", which
 *     yields internally-consistent P(win)=P(0 ahead), P(podium)=P(≤2 ahead),
 *     P(points)=P(points-paying finish) and an expected finishing position.
 */

const BASE_BETA = 0.9 // baseline finishing-time noise (s) with ~0 laps left
const BETA_PER_LAP = 0.18 // extra finishing-time noise per remaining lap
const MAX_GREEN_BETA = 7.5 // cap the base before weather/neutralisation multipliers
const MAX_BETA = 12 // never flatten a classified field into near-random order
const SC_BETA_MULT = 1.45 // neutralisations bunch the field → more variance
const WET_BETA_MULT = 1.35
const MAX_CLOSE_RATE = 1.15 // clamp pace-based catch-up to a sane s/lap
const LAPPED_MARGIN = 240 // synthetic margin (s) for lapped cars
const WIN_FLOOR = 1e-9 // prevents an all-zero win field after normalisation
const UNKNOWN_GAP_QUALITY = 0.42

type Compound = 'SOFT' | 'MEDIUM' | 'HARD' | 'INTERMEDIATE' | 'WET'
type GapSource = 'exact' | 'interval' | 'position' | 'lapped'

const COMPOUND_BASELINE: Record<Compound, number> = {
  SOFT: 0.18,
  MEDIUM: 0.08,
  HARD: 0,
  INTERMEDIATE: 0.06,
  WET: 0.02
}

const COMPOUND_DEGRADATION: Record<Compound, number> = {
  SOFT: 0.018,
  MEDIUM: 0.012,
  HARD: 0.009,
  INTERMEDIATE: 0.014,
  WET: 0.011
}

/** 2026 points tables (no fastest-lap point). Index 0 = P1. */
export const POINTS_RACE = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1]
export const POINTS_SPRINT = [8, 7, 6, 5, 4, 3, 2, 1]

/**
 * Per-remaining-lap probability that a currently-running car fails to finish.
 * ~0.16%/lap ≈ modern F1 reliability (~7% over a 45-lap race). It makes a
 * dominant leader's podium/points honestly < 100% and lets a rival's fragility
 * flow into everyone else's odds, rather than pretending finishing is certain.
 */
const DNF_HAZARD_PER_LAP = 0.0016

/** Chance a running car reaches the flag given the laps left. */
function survivalProbability(lapsRemaining: number): number {
  return Math.pow(1 - DNF_HAZARD_PER_LAP, Math.max(0, lapsRemaining))
}

export type WinProbabilityDataQuality = 'low' | 'medium' | 'high'

export interface WinChance {
  driverNumber: number
  code: string
  teamName: string | null
  teamColour: string | null
  position: number | null
  /** Projected final margin to the projected winner (s); 0 for the projected winner. */
  projectedMargin: number
  winPct: number
  podiumPct: number
  pointsPct: number
  /** Expected championship points from the full finishing distribution (DNF ⇒ 0). */
  expectedPoints: number
  /** Probability of not finishing (retirement), given laps remaining. */
  dnfPct: number
  /** Expected finishing position (1 = win); DNFs weighted toward the back. */
  expectedFinish: number
  /** Positive when the model rates them above their current track position. */
  positionEdge: number | null
  /** Driver-specific evidence confidence (0..100). */
  confidencePct: number
  dataQuality: WinProbabilityDataQuality
  /** Concise UI-ready reasons behind the rating. */
  factors: string[]
}

export interface WinProbabilityModel {
  available: boolean
  reason: string | null
  lapsRemaining: number | null
  /** Fraction of the race completed (0..1), when derivable. */
  raceProgress: number | null
  neutralized: boolean
  /** Uncertainty scale used (s) — surfaced for transparency. */
  beta: number
  confidencePct: number
  dataQuality: WinProbabilityDataQuality
  chances: WinChance[]
  isEstimate: true
}

function numericGap(e: TimingEntry): number | null {
  if (e.position === 1) return 0
  if (typeof e.gapToLeader === 'number') return e.gapToLeader
  return null
}

function isOut(status: TimingEntry['status']): boolean {
  return status === 'RETIRED' || status === 'DNF' || status === 'DNS' || status === 'DSQ'
}

function logistic(x: number): number {
  if (x >= 0) {
    const z = Math.exp(-x)
    return 1 / (1 + z)
  }
  const z = Math.exp(x)
  return z / (1 + z)
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function average(values: number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function textLooksLapped(value: unknown): boolean {
  return typeof value === 'string' && /\blap\b/i.test(value)
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string' || textLooksLapped(value)) return null
  const match = value.trim().match(/-?\d+(?:\.\d+)?/)
  if (match == null) return null
  const parsed = Number(match[0])
  return Number.isFinite(parsed) ? parsed : null
}

function looksLapped(entry: TimingEntry): boolean {
  return textLooksLapped(entry.gapToLeader) || textLooksLapped(entry.intervalAhead)
}

function intervalToAhead(entry: TimingEntry): number | null {
  return typeof entry.intervalAhead === 'number' ? entry.intervalAhead : null
}

function recentPaceFor(snapshot: RaceSnapshot, entry: TimingEntry): number | null {
  return driverRecentPace(snapshot, entry.driverNumber)
}

function paceSampleCount(snapshot: RaceSnapshot, entry: TimingEntry): number {
  return clamp(
    snapshot.laps.filter(
      (lap) =>
        lap.driverNumber === entry.driverNumber &&
        lap.lapTime != null &&
        lap.lapTime > 0 &&
        !lap.isPitInLap &&
        !lap.isPitOutLap
    ).length,
    0,
    8
  )
}

function timePenaltySeconds(entry: TimingEntry): number {
  if (!entry.penalty || /grid|place/i.test(entry.penalty)) return 0
  return Math.max(0, toNumber(entry.penalty) ?? 0)
}

function normalizeCompound(raw: string): Compound | null {
  const value = raw.toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (value.includes('INTER')) return 'INTERMEDIATE'
  if (value.includes('WET')) return 'WET'
  if (value.includes('SOFT')) return 'SOFT'
  if (value.includes('MED')) return 'MEDIUM'
  if (value.includes('HARD')) return 'HARD'
  if (value === 'C5' || value === 'C4') return 'SOFT'
  if (value === 'C3') return 'MEDIUM'
  if (value === 'C2' || value === 'C1') return 'HARD'
  return null
}

function tyreCompound(entry: TimingEntry): Compound | null {
  return entry.compound ? normalizeCompound(entry.compound) : null
}

function stintAgeLaps(entry: TimingEntry): number | null {
  return entry.stintAge != null ? Math.max(0, entry.stintAge) : null
}

function tyreStateScore(compound: Compound | null, ageLaps: number | null): number | null {
  if (compound == null && ageLaps == null) return null

  const baseline = compound != null ? COMPOUND_BASELINE[compound] : 0.04
  const degradation = compound != null ? COMPOUND_DEGRADATION[compound] : 0.01
  const agePenalty = Math.max(0, (ageLaps ?? 0) - 3) * degradation
  return clamp(baseline - agePenalty, -0.45, 0.35)
}

function qualityBand(score: number): WinProbabilityDataQuality {
  if (score >= 0.75) return 'high'
  if (score >= 0.5) return 'medium'
  return 'low'
}

function formatSigned(value: number, digits = 2): string {
  return `${value > 0 ? '+' : ''}${value.toFixed(digits)}`
}

function formatPenalty(seconds: number): string {
  const rounded = Math.round(seconds)
  return Number.isFinite(seconds) && Math.abs(seconds - rounded) < 1e-6
    ? `${rounded}`
    : seconds.toFixed(1)
}

function compoundLabel(compound: Compound | null): string {
  if (compound == null) return 'Tyre'
  if (compound === 'INTERMEDIATE') return 'Inter'
  return `${compound[0]}${compound.slice(1).toLowerCase()}`
}

function fallbackGapStep(raceProgress: number, neutralized: boolean): number {
  return neutralized ? 1 : 1.5 + 1.6 * raceProgress
}

function positionGap(a: TimingEntry | null, b: TimingEntry | null): number {
  if (a == null || b == null) return 1
  const aPos = a.position ?? 0
  const bPos = b.position ?? aPos + 1
  return Math.max(1, bPos - aPos)
}

interface GapEstimate {
  margin: number
  quality: number
  source: GapSource
}

function resolveGapEstimates(
  entries: TimingEntry[],
  raceProgress: number,
  neutralized: boolean
): Map<number, GapEstimate> {
  const sorted = [...entries].sort(
    (a, b) => (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER)
  )
  const estimates = new Map<number, GapEstimate>()

  for (const entry of sorted) {
    const gap = numericGap(entry)
    if (gap != null) {
      const rankDistance = Math.max(0, (entry.position ?? 1) - 1)
      const positionalFloor = fallbackGapStep(raceProgress, neutralized) * rankDistance
      const contradictory = gap + 0.5 < positionalFloor
      estimates.set(entry.driverNumber, {
        margin: Math.max(0, gap, positionalFloor),
        quality: contradictory ? UNKNOWN_GAP_QUALITY : 1,
        source: contradictory ? 'position' : 'exact'
      })
      continue
    }
    if (looksLapped(entry)) {
      estimates.set(entry.driverNumber, {
        margin: LAPPED_MARGIN + (entry.position ?? sorted.length + 20),
        quality: 0.2,
        source: 'lapped'
      })
    }
  }

  let changed = true
  while (changed) {
    changed = false
    for (let index = 0; index < sorted.length; index++) {
      const entry = sorted[index]
      if (estimates.has(entry.driverNumber)) continue

      const ahead = index > 0 ? sorted[index - 1] : null
      const aheadEstimate = ahead != null ? estimates.get(ahead.driverNumber) : undefined
      const toAhead = intervalToAhead(entry)
      if (aheadEstimate != null && toAhead != null) {
        estimates.set(entry.driverNumber, {
          margin: aheadEstimate.margin + Math.max(0.05, toAhead),
          quality: Math.min(0.78, aheadEstimate.quality),
          source: 'interval'
        })
        changed = true
        continue
      }

      const behind = index + 1 < sorted.length ? sorted[index + 1] : null
      const behindEstimate = behind != null ? estimates.get(behind.driverNumber) : undefined
      const behindToAhead = behind != null ? intervalToAhead(behind) : null
      if (behindEstimate != null && behindToAhead != null) {
        estimates.set(entry.driverNumber, {
          margin: Math.max(0, behindEstimate.margin - Math.max(0.05, behindToAhead)),
          quality: Math.min(0.72, behindEstimate.quality),
          source: 'interval'
        })
        changed = true
      }
    }
  }

  const knownSteps: number[] = []
  for (let index = 1; index < sorted.length; index++) {
    const ahead = sorted[index - 1]
    const current = sorted[index]
    const aheadEstimate = estimates.get(ahead.driverNumber)
    const currentEstimate = estimates.get(current.driverNumber)
    if (aheadEstimate == null || currentEstimate == null) continue
    const steps = positionGap(ahead, current)
    const delta = currentEstimate.margin - aheadEstimate.margin
    if (delta > 0) knownSteps.push(delta / steps)
  }
  const gapStep = average(knownSteps) ?? fallbackGapStep(raceProgress, neutralized)

  for (let index = 0; index < sorted.length; index++) {
    const entry = sorted[index]
    if (estimates.has(entry.driverNumber)) continue

    let aboveIndex = index - 1
    while (aboveIndex >= 0 && !estimates.has(sorted[aboveIndex].driverNumber)) aboveIndex--
    let belowIndex = index + 1
    while (belowIndex < sorted.length && !estimates.has(sorted[belowIndex].driverNumber)) belowIndex++

    const above = aboveIndex >= 0 ? sorted[aboveIndex] : null
    const below = belowIndex < sorted.length ? sorted[belowIndex] : null
    const aboveEstimate = above != null ? estimates.get(above.driverNumber) ?? null : null
    const belowEstimate = below != null ? estimates.get(below.driverNumber) ?? null : null

    let margin: number
    let quality = UNKNOWN_GAP_QUALITY

    if (aboveEstimate != null && belowEstimate != null) {
      const totalSteps = positionGap(above, below)
      const stepsFromAbove = positionGap(above, entry)
      const share = clamp(stepsFromAbove / totalSteps, 0, 1)
      margin = aboveEstimate.margin + (belowEstimate.margin - aboveEstimate.margin) * share
      quality = 0.55
    } else if (aboveEstimate != null && above != null) {
      margin = aboveEstimate.margin + gapStep * positionGap(above, entry)
      quality = 0.48
    } else if (belowEstimate != null && below != null) {
      margin = Math.max(0, belowEstimate.margin - gapStep * positionGap(entry, below))
      quality = 0.48
    } else {
      margin = gapStep * Math.max(0, (entry.position ?? index + 1) - 1)
    }

    estimates.set(entry.driverNumber, { margin, quality, source: 'position' })
  }

  return estimates
}

/**
 * Poisson-binomial pmf for the count of successes given independent
 * probabilities `probs`. Returns an array pmf[k] = P(exactly k). O(n²), n≤~20.
 */
export function poissonBinomialPmf(probs: number[]): number[] {
  const pmf = [1]
  for (const p of probs) {
    const q = Math.min(1, Math.max(0, p))
    // Convolve current pmf with Bernoulli(q).
    for (let k = pmf.length; k > 0; k--) {
      pmf[k] = (pmf[k] ?? 0) * (1 - q) + pmf[k - 1] * q
    }
    pmf[0] = pmf[0] * (1 - q)
  }
  return pmf
}

export const WinProbabilityEngine = {
  betaFor(snapshot: RaceSnapshot, lapsRemaining: number | null): number {
    const raceProgress =
      snapshot.totalLaps != null && snapshot.currentLap != null && snapshot.totalLaps > 0
        ? clamp(snapshot.currentLap / snapshot.totalLaps, 0, 1)
        : 0.5
    let beta = BASE_BETA + BETA_PER_LAP * Math.max(0, lapsRemaining ?? 12)
    beta *= 1.2 - 0.2 * raceProgress
    beta = Math.min(MAX_GREEN_BETA, beta)
    if (snapshot.trackStatus === 'SAFETY_CAR' || snapshot.trackStatus === 'VSC') beta *= SC_BETA_MULT
    if (snapshot.weather?.rainfall) beta *= WET_BETA_MULT
    return clamp(beta, 0.35, MAX_BETA)
  },

  /** Full win/podium/points model for the current snapshot. */
  compute(snapshot: RaceSnapshot): WinProbabilityModel {
    const neutralized =
      snapshot.trackStatus === 'SAFETY_CAR' || snapshot.trackStatus === 'VSC'
    const lapsRemaining =
      snapshot.totalLaps != null && snapshot.currentLap != null
        ? Math.max(0, snapshot.totalLaps - snapshot.currentLap)
        : null
    const raceProgress =
      snapshot.totalLaps != null && snapshot.currentLap != null && snapshot.totalLaps > 0
        ? Math.min(1, snapshot.currentLap / snapshot.totalLaps)
        : null
    const beta = this.betaFor(snapshot, lapsRemaining)

    const base: WinProbabilityModel = {
      available: false,
      reason: null,
      lapsRemaining,
      raceProgress,
      neutralized,
      beta,
      confidencePct: 0,
      dataQuality: 'low',
      chances: [],
      isEstimate: true
    }

    const isSprint = snapshot.session.type === 'sprint'
    if (snapshot.session.type !== 'race' && !isSprint) {
      return { ...base, reason: 'Win projection applies to races and sprints.' }
    }
    const pointsTable = isSprint ? POINTS_SPRINT : POINTS_RACE
    const pointsPlaces = pointsTable.length

    const effLapsRemaining = lapsRemaining ?? 12
    const survival = survivalProbability(effLapsRemaining)
    const progress = clamp(raceProgress ?? 0.45, 0.02, 1)
    const projectionLaps = effLapsRemaining * (0.25 + 0.75 * progress)
    const tyreProjectionLaps = Math.min(effLapsRemaining, 4 + 8 * progress)

    interface Cand {
      entry: TimingEntry
      currentGap: number
      gapQuality: number
      gapSource: GapSource
      paceClosePerLap: number
      paceConfidence: number
      tyreDeltaPerLap: number
      tyreConfidence: number
      penaltySeconds: number
      margin: number
      confidence: number
    }
    const runners = snapshot.timing
      .filter((entry) => !isOut(entry.status) && !entry.retired)
      .sort((a, b) => (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER))

    if (runners.length === 0) {
      return { ...base, reason: 'No classified runners to project yet.' }
    }

    const leaderEntry = runners[0]
    const leaderPace = recentPaceFor(snapshot, leaderEntry)
    const leaderTyreScore = tyreStateScore(tyreCompound(leaderEntry), stintAgeLaps(leaderEntry))
    const gapEstimates = resolveGapEstimates(runners, progress, neutralized)

    const provisional: Cand[] = runners.map((entry) => {
      const gapEstimate =
        gapEstimates.get(entry.driverNumber) ?? ({ margin: 0, quality: UNKNOWN_GAP_QUALITY, source: 'position' } as const)
      const pace = recentPaceFor(snapshot, entry)
      const samples = paceSampleCount(snapshot, entry)
      const rawPaceConfidence =
        leaderPace != null && pace != null ? 1 - Math.exp(-clamp(samples, 0, 8) / 2.4) : 0
      const paceConfidence =
        rawPaceConfidence * (0.55 + 0.45 * progress) * (0.25 + 0.75 * gapEstimate.quality) * (neutralized ? 0.8 : 1)
      const paceClosePerLap =
        leaderPace != null && pace != null
          ? clamp(leaderPace - pace, -MAX_CLOSE_RATE, MAX_CLOSE_RATE)
          : 0
      const paceEffect = -paceClosePerLap * projectionLaps * paceConfidence

      const compound = tyreCompound(entry)
      const ageLaps = stintAgeLaps(entry)
      const tyreScore = tyreStateScore(compound, ageLaps)
      const rawTyreConfidence = tyreScore != null ? (compound != null && ageLaps != null ? 1 : 0.55) : 0
      const tyreConfidence =
        rawTyreConfidence * (0.45 + 0.55 * progress) * (0.55 + 0.45 * (1 - Math.min(1, rawPaceConfidence)))
      const tyreDeltaPerLap =
        leaderTyreScore != null && tyreScore != null
          ? clamp(tyreScore - leaderTyreScore, -0.45, 0.45)
          : 0
      const tyreEffect = -tyreDeltaPerLap * tyreProjectionLaps * tyreConfidence

      const penalty = timePenaltySeconds(entry)
      const confidence = clamp(
        0.08 +
          0.34 * gapEstimate.quality +
          0.22 * rawPaceConfidence +
          0.1 * rawTyreConfidence +
          0.18 * progress +
          (leaderPace != null ? 0.05 : 0) -
          (neutralized ? 0.08 : 0),
        0.05,
        0.99
      )

      return {
        entry,
        currentGap: gapEstimate.margin,
        gapQuality: gapEstimate.quality,
        gapSource: gapEstimate.source,
        paceClosePerLap,
        paceConfidence,
        tyreDeltaPerLap,
        tyreConfidence,
        penaltySeconds: penalty,
        margin: gapEstimate.margin + paceEffect + tyreEffect + penalty,
        confidence
      }
    })

    const minMargin = Math.min(...provisional.map((candidate) => candidate.margin))
    const field: Cand[] = provisional.map((candidate) => ({
      ...candidate,
      margin: Math.max(0, candidate.margin - minMargin)
    }))

    const meta = new Map(snapshot.drivers.map((d) => [d.number, d]))
    const fieldSize = field.length
    const avgGapQuality = average(field.map((candidate) => candidate.gapQuality)) ?? UNKNOWN_GAP_QUALITY
    const avgPaceConfidence = average(field.map((candidate) => candidate.paceConfidence)) ?? 0
    const avgTyreConfidence = average(field.map((candidate) => candidate.tyreConfidence)) ?? 0
    const modelConfidence = clamp(
      0.12 +
        0.38 * avgGapQuality +
        0.22 * avgPaceConfidence +
        0.1 * avgTyreConfidence +
        0.18 * progress -
        (neutralized ? 0.08 : 0),
      0.05,
      0.99
    )
    const modelConfidencePct = modelConfidence * 100
    const modelDataQuality = qualityBand(modelConfidence)

    // Raw marginal probabilities from the pairwise Poisson-binomial model, all
    // CONDITIONED on this car finishing (its own DNF is applied afterwards).
    const raw = field.map((c) => {
      // P(rival finishes AHEAD of c) = P(rival survives) × P(quicker to the flag).
      // A retiring rival can't finish ahead, so their fragility helps c.
      const aheadProbs = field
        .filter((o) => o.entry.driverNumber !== c.entry.driverNumber)
        .map((o) => {
          const pairQuality = (c.gapQuality + o.gapQuality) / 2
          const pairConfidence = (c.confidence + o.confidence) / 2
          const pairBeta = Math.max(
            0.35,
            beta * (1 + 0.55 * (1 - pairQuality) + 0.35 * (1 - pairConfidence))
          )
          return survival * logistic((c.margin - o.margin) / pairBeta)
        })
      const pmf = poissonBinomialPmf(aheadProbs)
      const cumul = (k: number) => pmf.slice(0, k + 1).reduce((a, b) => a + (b ?? 0), 0)
      // Expected points: Σ P(finish exactly Pk | finishes) × table[Pk], scaled by
      // this car's own survival (a DNF scores nothing).
      let expectedPoints = 0
      for (let k = 0; k < pointsTable.length; k++) expectedPoints += (pmf[k] ?? 0) * pointsTable[k]
      const finishGivenSurvive = 1 + aheadProbs.reduce((a, b) => a + b, 0)
      const floorWeight =
        WIN_FLOOR * Math.exp(-Math.max(0, c.margin) / 30) * (0.45 + 0.55 * c.gapQuality)
      return {
        cand: c,
        // All scaled by c's survival — finishing is a prerequisite for any result.
        win: Math.max(survival * (pmf[0] ?? 0), floorWeight),
        podium: survival * cumul(2),
        points: survival * cumul(pointsPlaces - 1),
        expectedPoints: survival * expectedPoints,
        // Expected classified position: weight a DNF toward the back of the field.
        expectedFinish: survival * finishGivenSurvive + (1 - survival) * fieldSize
      }
    })

    // Exactly one driver wins, so normalise win chances to sum to 100%.
    const winSum = raw.reduce((a, r) => a + r.win, 0) || 1
    const chances: WinChance[] = raw.map((r) => {
      const d = meta.get(r.cand.entry.driverNumber)
      const pos = r.cand.entry.position ?? null
      const winPct = (r.win / winSum) * 100
      // Keep the marginals monotonic for display (win ≤ podium ≤ points).
      const podiumPct = Math.min(100, Math.max(r.podium * 100, winPct))
      const pointsPct = Math.min(100, Math.max(r.points * 100, podiumPct))
      const factors: string[] = []

      if (r.cand.penaltySeconds > 0) factors.push(`+${formatPenalty(r.cand.penaltySeconds)}s penalty`)
      if (pos === 1) factors.push('Track leader')

      if (Math.abs(r.cand.paceClosePerLap) >= 0.05 && r.cand.paceConfidence >= 0.2) {
        factors.push(`Pace ${formatSigned(r.cand.paceClosePerLap)}s/lap`)
      }

      if (Math.abs(r.cand.tyreDeltaPerLap) >= 0.04 && r.cand.tyreConfidence >= 0.2) {
        const compound = tyreCompound(r.cand.entry)
        const age = stintAgeLaps(r.cand.entry)
        const ageText = age != null ? ` ${age}L` : ''
        factors.push(`${compoundLabel(compound)}${ageText} tyre ${r.cand.tyreDeltaPerLap > 0 ? 'edge' : 'drag'}`)
      }

      if (r.cand.gapSource !== 'exact') {
        factors.push(r.cand.gapSource === 'interval' ? 'Gap partly inferred' : 'Gap estimated')
      } else if (pos !== 1) {
        factors.push(`+${r.cand.currentGap.toFixed(1)}s on track`)
      }

      const confidencePct = r.cand.confidence * 100
      return {
        driverNumber: r.cand.entry.driverNumber,
        code: d?.code ?? `#${r.cand.entry.driverNumber}`,
        teamName: d?.teamName ?? null,
        teamColour: d?.teamColour ?? null,
        position: pos,
        projectedMargin: r.cand.margin,
        winPct,
        podiumPct,
        pointsPct,
        expectedPoints: r.expectedPoints,
        dnfPct: (1 - survival) * 100,
        expectedFinish: r.expectedFinish,
        positionEdge: pos != null ? pos - r.expectedFinish : null,
        confidencePct,
        dataQuality: qualityBand(r.cand.confidence),
        factors: factors.slice(0, 3)
      }
    })

    chances.sort((a, b) => b.winPct - a.winPct || a.expectedFinish - b.expectedFinish)
    return {
      ...base,
      available: true,
      confidencePct: modelConfidencePct,
      dataQuality: modelDataQuality,
      chances
    }
  }
} as const

/** Compact text summary of the top win chances for the AI Race Engineer. */
export function winProbabilitySummary(model: WinProbabilityModel, topN = 6): string {
  if (!model.available || model.chances.length === 0) return ''
  const lines: string[] = []
  lines.push(
    `WIN PROBABILITY MODEL (estimate; ${
      `${model.dataQuality} confidence ${model.confidencePct.toFixed(0)}%${
        model.lapsRemaining != null ? `, ${model.lapsRemaining} laps left` : ', laps unknown'
      }` +
      `${model.neutralized ? ', track neutralized' : ''}`
    }):`
  )
  for (const c of model.chances.slice(0, topN)) {
    lines.push(
      `  - ${c.code} (P${c.position ?? '—'}): win ${c.winPct.toFixed(0)}%, podium ${c.podiumPct.toFixed(
        0
      )}%, points ${c.pointsPct.toFixed(0)}%, xPts ${c.expectedPoints.toFixed(1)}${
        c.dnfPct >= 1 ? `, DNF risk ${c.dnfPct.toFixed(0)}%` : ''
      }${c.factors.length > 0 ? `, ${c.factors[0]}` : ''}.`
    )
  }
  return lines.join('\n')
}
