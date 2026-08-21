import type { TimingEntry, TyreCompound } from '@shared/models'
import type { RaceSnapshot } from '@renderer/core/providers/types'
import { driverRecentPace } from './AnalyticsEngine'

/**
 * BattleEngine — a whole-field read of the on-track fights RIGHT NOW.
 *
 * For every pair of cars running nose-to-tail within a small window it works out
 * who's attacking, how fast the gap is moving, whether the attacker is within
 * Overtake Mode range (2026's overtaking aid — the within-1s ERS boost that
 * replaced DRS), who has the fresher tyre, and a plain-language verdict. It also
 * spots overtake "trains" (3+ cars nose-to-tail). Pure + deterministic +
 * unit-tested; everything is an estimate derived from real timing + recent-pace
 * data, never invented.
 */

const OVERTAKE_RANGE = 1.0 // within 1.0s ⇒ Overtake Mode (2026 overtaking boost) available
const DEFAULT_BATTLE_RANGE = 2.0 // treat cars within this many seconds as fighting
const CLOSING_EPS = 0.03 // s/lap below which the gap is "stable"
const FRESH_EDGE_LAPS = 4 // tyre-age gap (laps) that counts as a real advantage

export type BattleVerdict = 'PASS LIKELY' | 'OVERTAKE' | 'CLOSING' | 'HOLDING'

export interface Battle {
  id: string
  /** Trailing car (the one applying pressure). */
  attacker: number
  attackerCode: string
  /** Leading car (defending position). */
  defender: number
  defenderCode: string
  /** The position being contested (the defender's position). */
  forPosition: number
  /** Interval between them (s). */
  interval: number
  /** Attacker within Overtake Mode range (≤1s) — 2026's overtaking boost. */
  inOvertakeRange: boolean
  /** Gap-change rate (s/lap); positive = attacker closing. Null if pace unknown. */
  closingPerLap: number | null
  /** Laps to erase the gap at the current rate (only when closing). */
  lapsToPass: number | null
  attackerCompound: TyreCompound | null
  defenderCompound: TyreCompound | null
  /** Defender age − attacker age (laps); positive = attacker on fresher rubber. */
  tyreEdge: number | null
  isTeammates: boolean
  verdict: BattleVerdict
  /** 0..1 heat of the fight (proximity blended with closing rate). */
  intensity: number
  isEstimate: true
}

export interface BattleReport {
  battles: Battle[]
  /** Groups of 3+ cars nose-to-tail within overtake range (driver numbers, front→back). */
  trains: number[][]
  rangeSec: number
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n))
}

function isRacing(t: TimingEntry): boolean {
  return !t.inPit && !t.retired && t.status !== 'RETIRED' && t.status !== 'DNF' && t.status !== 'DSQ'
}

function numInterval(v: number | '+1 LAP' | null): number | null {
  return typeof v === 'number' ? v : null
}

/** All active battles + overtake trains for the current snapshot. */
export function computeBattles(
  snapshot: RaceSnapshot,
  opts: { rangeSec?: number; favorites?: number[] } = {}
): BattleReport {
  const rangeSec = opts.rangeSec ?? DEFAULT_BATTLE_RANGE
  const codeOf = (n: number) => snapshot.drivers.find((d) => d.number === n)?.code ?? `#${n}`
  const teamOf = (n: number) => snapshot.drivers.find((d) => d.number === n)?.teamName ?? null

  const ordered = [...snapshot.timing]
    .filter((t) => t.position != null)
    .sort((a, b) => (a.position as number) - (b.position as number))

  const battles: Battle[] = []
  const paceCache = new Map<number, number | null>()
  const paceOf = (n: number) => {
    if (!paceCache.has(n)) paceCache.set(n, driverRecentPace(snapshot, n))
    return paceCache.get(n) ?? null
  }

  for (let i = 1; i < ordered.length; i++) {
    const defender = ordered[i - 1]
    const attacker = ordered[i]
    if (!isRacing(defender) || !isRacing(attacker)) continue
    const interval = numInterval(attacker.intervalAhead)
    if (interval == null || interval > rangeSec) continue

    const aPace = paceOf(attacker.driverNumber)
    const dPace = paceOf(defender.driverNumber)
    const closingPerLap = aPace != null && dPace != null ? dPace - aPace : null
    const closing = closingPerLap != null && closingPerLap > CLOSING_EPS
    const inOvertakeRange = interval <= OVERTAKE_RANGE
    const tyreEdge =
      attacker.stintAge != null && defender.stintAge != null
        ? defender.stintAge - attacker.stintAge
        : null
    const fresher = tyreEdge != null && tyreEdge >= FRESH_EDGE_LAPS

    let verdict: BattleVerdict
    if (inOvertakeRange && closing && (fresher || (closingPerLap ?? 0) > 0.15)) verdict = 'PASS LIKELY'
    else if (inOvertakeRange) verdict = 'OVERTAKE'
    else if (closing) verdict = 'CLOSING'
    else verdict = 'HOLDING'

    const proximity = clamp01(1 - interval / rangeSec)
    const closeHeat = clamp01((closingPerLap ?? 0) / 0.4)
    const intensity = clamp01(proximity * 0.6 + closeHeat * 0.4)

    battles.push({
      id: `${defender.driverNumber}-${attacker.driverNumber}`,
      attacker: attacker.driverNumber,
      attackerCode: codeOf(attacker.driverNumber),
      defender: defender.driverNumber,
      defenderCode: codeOf(defender.driverNumber),
      forPosition: defender.position as number,
      interval,
      inOvertakeRange,
      closingPerLap,
      lapsToPass: closing && closingPerLap ? interval / closingPerLap : null,
      attackerCompound: attacker.compound,
      defenderCompound: defender.compound,
      tyreEdge,
      isTeammates: !!teamOf(attacker.driverNumber) && teamOf(attacker.driverNumber) === teamOf(defender.driverNumber),
      verdict,
      intensity,
      isEstimate: true
    })
  }

  return { battles, trains: detectTrains(ordered), rangeSec }
}

/** Runs of 3+ cars each within overtake range of the car ahead (front→back). */
export function detectTrains(orderedTiming: TimingEntry[]): number[][] {
  const trains: number[][] = []
  let run: number[] = []
  for (let i = 0; i < orderedTiming.length; i++) {
    const t = orderedTiming[i]
    const gap = numInterval(t.intervalAhead)
    const connected = i > 0 && gap != null && gap <= OVERTAKE_RANGE && isRacing(t) && isRacing(orderedTiming[i - 1])
    if (connected) {
      if (run.length === 0) run.push(orderedTiming[i - 1].driverNumber)
      run.push(t.driverNumber)
    } else {
      if (run.length >= 3) trains.push(run)
      run = []
    }
  }
  if (run.length >= 3) trains.push(run)
  return trains
}
