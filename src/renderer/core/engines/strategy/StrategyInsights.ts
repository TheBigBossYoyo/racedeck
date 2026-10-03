import type { LapSample, TimingEntry } from '@shared/models'
import type { RaceSnapshot } from '@renderer/core/model/snapshot'
import { estimateFuelCoefficient } from '../FuelModel'
import { classifyCloseTraffic } from '../PitCycleModel'
import { predictPitStop } from './PitPrediction'
import { analysePitLane } from './PitLoss'
import { currentStintLaps, degradationTrend, knownLapsAtSnapshot } from './StintLaps'
import { OVERTAKE_RANGE, undercutDelta } from './Undercut'

export type InsightKind =
  | 'undercut'
  | 'overcut'
  | 'pit-window'
  | 'safety-car'
  | 'degradation'
  | 'battle'
  | 'rejoin'
  | 'teammate'

export interface StrategyInsight {
  id: string
  kind: InsightKind
  title: string
  detail: string
  confidence: 'low' | 'medium' | 'high'
  driverNumbers: number[]
  /**
   * True for a projection (the default — a visible reminder that the number is
   * modelled). False only where the insight rests on data F1 actually measured,
   * such as a pit-lane transit time, so the UI can stop calling it an estimate.
   */
  isEstimate: boolean
}

/** Generate the most relevant insights for the current snapshot. */
export function generateInsights(
  snapshot: RaceSnapshot,
  lapsByDriver: (n: number) => LapSample[],
  favorites: number[] = []
): StrategyInsight[] {
  const insights: StrategyInsight[] = []
  const timing = snapshot.timing
  const nameOf = (n: number) => snapshot.drivers.find((d) => d.number === n)?.code ?? `#${n}`

  // Safety car opportunity — a "cheap stop" window.
  if (snapshot.trackStatus === 'SAFETY_CAR' || snapshot.trackStatus === 'VSC') {
    const label = snapshot.trackStatus === 'VSC' ? 'Virtual Safety Car' : 'Safety Car'
    insights.push({
      id: 'sc-window',
      kind: 'safety-car',
      title: `${label} pit window open`,
      detail: `Track is neutralized — a stop now costs far less than usual (~40-60% of green-flag loss). Cars yet to stop have a cheap-stop opportunity. Estimate only.`,
      confidence: 'high',
      driverNumbers: [],
      isEstimate: true
    })
  }

  // Measured pit-lane transits (F1's PitLaneTimeCollection). This is REAL
  // measured time, not a model — so it can call out a genuinely slow stop
  // against the field's own median for this pit lane. Note the feed's Duration
  // is total pit-lane transit, NOT time lost versus staying out, so it is
  // reported and compared as measured, never substituted for the pit-loss model.
  const pitLane = analysePitLane(snapshot.pitLaneTimes ?? [], snapshot.raceControl)
  if (pitLane) {
    const worst = pitLane.slow.find(
      (p) => favorites.length === 0 || favorites.includes(p.driverNumber)
    )
    if (worst) {
      const penaltyNote =
        worst.penaltySec > 0
          ? ` A ${worst.penaltySec}s time penalty served at this stop has already been deducted.`
          : ''
      insights.push({
        id: `slow-stop-${worst.driverNumber}-${worst.lap ?? 0}`,
        kind: 'pit-window',
        title: `${nameOf(worst.driverNumber)}: slow stop — +${worst.lostSec.toFixed(1)}s`,
        detail: `Measured ${worst.duration.toFixed(1)}s in the pit lane${worst.lap != null ? ` on lap ${worst.lap}` : ''} against this pit lane's median of ${pitLane.medianSec.toFixed(1)}s across ${pitLane.sampleSize} stops — about ${worst.lostSec.toFixed(1)}s dropped versus a clean stop.${penaltyNote} Measured from F1's timing, not an estimate.`,
        confidence: 'high',
        driverNumbers: [worst.driverNumber],
        isEstimate: false
      })
    }
  }

  // Close battles (interval within overtake range) → undercut/overcut framing.
  for (let i = 1; i < timing.length; i++) {
    const car = timing[i]
    const ahead = timing[i - 1]
    const interval = typeof car.intervalAhead === 'number' ? car.intervalAhead : null
    if (interval == null || interval > OVERTAKE_RANGE + 0.6) continue
    const relevant =
      favorites.length === 0 ||
      favorites.includes(car.driverNumber) ||
      favorites.includes(ahead.driverNumber)
    if (!relevant) continue

    const net = undercutDelta(interval)
    const isUndercut = net > 0
    insights.push({
      id: `battle-${car.driverNumber}-${ahead.driverNumber}`,
      kind: isUndercut ? 'undercut' : 'battle',
      title: `${nameOf(car.driverNumber)} vs ${nameOf(ahead.driverNumber)} — ${interval.toFixed(2)}s`,
      detail: isUndercut
        ? `${nameOf(car.driverNumber)} is within undercut range of ${nameOf(ahead.driverNumber)}. A fresh-tyre stop could net ~${net.toFixed(1)}s. Estimate only.`
        : `${nameOf(car.driverNumber)} is attacking ${nameOf(ahead.driverNumber)} (overtake range). Track position battle — overcut may be safer than pitting. Estimate only.`,
      confidence: interval < OVERTAKE_RANGE ? 'high' : 'medium',
      driverNumbers: [car.driverNumber, ahead.driverNumber],
      isEstimate: true
    })
    if (insights.length >= 6) break
  }

  // Degradation warnings for favorites (or top runners if none).
  // The fuel fit is a whole-snapshot computation, so derive it once here
  // rather than per driver inside the loop.
  const fuelCoeff = estimateFuelCoefficient(snapshot)
  const watch = favorites.length ? favorites : timing.slice(0, 3).map((t) => t.driverNumber)
  for (const num of watch) {
    const entry = timing.find((t) => t.driverNumber === num)
    const slope = degradationTrend(
      currentStintLaps(entry, knownLapsAtSnapshot(snapshot, lapsByDriver(num))),
      6,
      fuelCoeff
    )
    const inCloseTraffic = entry != null && classifyCloseTraffic(snapshot, entry).isCloseTraffic
    if (!inCloseTraffic && slope != null && slope > 0.12) {
      insights.push({
        id: `deg-${num}`,
        kind: 'degradation',
        title: `${nameOf(num)} tyres dropping off`,
        detail: `Recent pace trend ~+${slope.toFixed(2)}s/lap on ${entry?.compound ?? 'current'} tyres. Pit window approaching. Estimate only.`,
        confidence: slope > 0.2 ? 'high' : 'medium',
        driverNumbers: [num],
        isEstimate: true
      })
    }
  }

  // Teammate battles — intra-team fights are the sharpest strategy signal.
  const teamOf = (n: number) => snapshot.drivers.find((d) => d.number === n)?.teamName ?? null
  const seenTeams = new Set<string>()
  for (const t of timing) {
    const team = teamOf(t.driverNumber)
    if (!team || seenTeams.has(team)) continue
    const mate = pickTeammate(timing, t.driverNumber, teamOf)
    if (mate == null) continue
    seenTeams.add(team)
    const a = timing.find((x) => x.driverNumber === t.driverNumber)
    const b = timing.find((x) => x.driverNumber === mate)
    if (!a || !b || a.position == null || b.position == null) continue
    const [lead, chase] = a.position < b.position ? [a, b] : [b, a]
    const gA = typeof lead.gapToLeader === 'number' ? lead.gapToLeader : null
    const gB = typeof chase.gapToLeader === 'number' ? chase.gapToLeader : null
    const split = gA != null && gB != null ? gB - gA : null
    const relevant =
      favorites.length === 0 ||
      favorites.includes(a.driverNumber) ||
      favorites.includes(b.driverNumber)
    if (!relevant || split == null || split > 4) continue
    insights.push({
      id: `mate-${team}`,
      kind: 'teammate',
      title: `${team}: ${nameOf(lead.driverNumber)} vs ${nameOf(chase.driverNumber)} — ${split.toFixed(1)}s`,
      detail: `Teammates split by ${split.toFixed(1)}s (P${lead.position} vs P${chase.position}). Watch for a strategic split or team orders — the trailing car may get the undercut call. Estimate only.`,
      confidence: split < 1.5 ? 'high' : 'medium',
      driverNumbers: [lead.driverNumber, chase.driverNumber],
      isEstimate: true
    })
    if (insights.length >= 10) break
  }

  return insights.slice(0, 8)
}

/** "Pit now?" assistant for one driver → a labeled recommendation. */
export function pitNowAssistant(
  snapshot: RaceSnapshot,
  driverNumber: number,
  laps: LapSample[]
): StrategyInsight {
  const p = predictPitStop(snapshot, driverNumber, laps)
  const entry = snapshot.timing.find((t) => t.driverNumber === driverNumber)
  const detail = p.available
    ? `${p.rationale.join(' ')} (${entry?.compound ?? 'current'}, stint age ${entry?.stintAge ?? '—'} laps.) Estimate only.`
    : `${p.reason ?? 'Insufficient data for a projection.'} Estimate only.`
  return {
    id: `pit-now-${driverNumber}`,
    kind: 'pit-window',
    title: `${p.code}: ${p.verdict}`,
    detail,
    confidence: p.confidence,
    driverNumbers: [driverNumber],
    isEstimate: true
  }
}

export function pickTeammate(
  timing: TimingEntry[],
  driverNumber: number,
  teamOf: (n: number) => string | null
): number | null {
  const team = teamOf(driverNumber)
  if (!team) return null
  const mate = timing.find(
    (t) => t.driverNumber !== driverNumber && teamOf(t.driverNumber) === team
  )
  return mate?.driverNumber ?? null
}
