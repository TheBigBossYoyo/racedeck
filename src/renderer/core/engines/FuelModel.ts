import type { LapSample } from '@shared/models'
import type { RaceSnapshot } from '@renderer/core/model/snapshot'

/**
 * FuelModel — a labelled ESTIMATE that removes the fuel-load effect from lap
 * times so pace comparisons across a race are honest.
 *
 * A Formula 1 car starts a race ~100kg heavier than it finishes and each ~10kg
 * costs roughly 0.3s/lap, so an early lap is slower than a late lap for reasons
 * that have nothing to do with the driver, car or tyre. Left uncorrected this
 * flatters late-race pace and, worse, MASKS tyre degradation (fuel burn makes
 * later laps faster, cancelling the slow-down from a worn tyre). Correcting for
 * it makes team pace, compound pace and — most of all — degradation slopes far
 * more truthful.
 *
 * The correction normalises every lap to a common end-of-race (near-empty)
 * reference. The coefficient (seconds gained per lap of fuel burned) is either
 * fitted from this event's own laps when a clean signal exists, or falls back to
 * a physical default; it is always honestly flagged. It is DELIBERATELY a no-op
 * outside race/sprint sessions (qualifying already runs low fuel; practice fuel
 * loads are unknowable) and whenever the race distance is unknown.
 *
 * Pure and unit-tested; consumed by `AnalyticsEngine` (and through it the
 * strategy, battle and win-probability engines).
 */

/** Physical default ≈ 1.7 kg/lap × ~0.032 s/kg — used when data is too sparse. */
const DEFAULT_S_PER_FUEL_LAP = 0.055
/** Plausibility band; a fitted value outside it is rejected for the default. */
const MIN_COEFF = 0.02
const MAX_COEFF = 0.1
/** Minimum qualifying laps (across the field) before trusting a data fit. */
const MIN_FIT_LAPS = 14
/** Only fresh-tyre laps enter the fit, so tyre degradation can't bias it. */
const MAX_TYRE_AGE_FOR_FIT = 6

export interface FuelCoefficient {
  /** Seconds of lap time added per lap-of-fuel still aboard (always ≥ 0). */
  sPerLap: number
  /** `measured` = fitted from this event's laps; `estimated` = physical default. */
  confidence: 'measured' | 'estimated'
  /** Race distance used as the correction reference; null ⇒ correction is a no-op. */
  totalLaps: number | null
}

function isFuelRelevant(snapshot: RaceSnapshot): boolean {
  const type = snapshot.session.type
  return type === 'race' || type === 'sprint'
}

function isCleanLap(l: LapSample): boolean {
  return l.lapTime != null && l.lapTime > 0 && !l.isPitOutLap && !l.isPitInLap
}

/** Per-driver map of lapNumber → tyre age (laps on the set), from the stints. */
function tyreAgeByLap(snapshot: RaceSnapshot): Map<number, Map<number, number>> {
  const out = new Map<number, Map<number, number>>()
  for (const st of snapshot.stints) {
    const end = st.lapEnd ?? snapshot.currentLap ?? st.lapStart + 60
    let byLap = out.get(st.driverNumber)
    if (!byLap) {
      byLap = new Map()
      out.set(st.driverNumber, byLap)
    }
    for (let lap = st.lapStart; lap <= end; lap++) {
      byLap.set(lap, st.tyre.ageAtStart + (lap - st.lapStart))
    }
  }
  return out
}

/**
 * Fixed-effects least-squares fit of lap time against laps-of-fuel-remaining,
 * centring each driver's own laps so absolute pace differences between drivers
 * cannot bias the slope. Only fresh-tyre clean laps contribute, isolating fuel
 * from degradation. Returns null when the signal is too thin to trust.
 */
function fitCoefficient(snapshot: RaceSnapshot, totalLaps: number): number | null {
  const ageByLap = tyreAgeByLap(snapshot)
  const byDriver = new Map<number, { x: number; y: number }[]>()
  for (const l of snapshot.laps) {
    if (!isCleanLap(l)) continue
    const age = ageByLap.get(l.driverNumber)?.get(l.lapNumber)
    if (age == null || age > MAX_TYRE_AGE_FOR_FIT) continue
    const x = totalLaps - l.lapNumber // laps of fuel still to burn
    if (x < 0) continue
    const arr = byDriver.get(l.driverNumber) ?? []
    arr.push({ x, y: l.lapTime as number })
    byDriver.set(l.driverNumber, arr)
  }

  let num = 0
  let den = 0
  let count = 0
  for (const points of byDriver.values()) {
    if (points.length < 3) continue
    const meanX = points.reduce((a, p) => a + p.x, 0) / points.length
    const meanY = points.reduce((a, p) => a + p.y, 0) / points.length
    for (const p of points) {
      num += (p.x - meanX) * (p.y - meanY)
      den += (p.x - meanX) ** 2
      count++
    }
  }
  if (count < MIN_FIT_LAPS || den <= 0) return null
  return num / den
}

function computeFuelCoefficient(snapshot: RaceSnapshot): FuelCoefficient {
  const totalLaps = isFuelRelevant(snapshot) ? snapshot.totalLaps : null
  if (totalLaps == null || totalLaps <= 1) {
    return { sPerLap: DEFAULT_S_PER_FUEL_LAP, confidence: 'estimated', totalLaps: null }
  }
  const fitted = fitCoefficient(snapshot, totalLaps)
  if (fitted != null && fitted >= MIN_COEFF && fitted <= MAX_COEFF) {
    return { sPerLap: fitted, confidence: 'measured', totalLaps }
  }
  return { sPerLap: DEFAULT_S_PER_FUEL_LAP, confidence: 'estimated', totalLaps }
}

/**
 * Memoise a pure function of the snapshot's lap/stint inputs. The providers hand
 * out the same `laps` array between lap completions while the snapshot object
 * itself changes several times a second, so the last result is cached per `laps`
 * identity. Every OTHER field the fuel-aware engines read (`stints`,
 * `currentLap`, `totalLaps`, session type) is part of the key, so a hit is only
 * ever the value a fresh computation would return. `compute` must read nothing
 * else off the snapshot. The returned value is shared between callers: treat it
 * as read-only.
 */
export function memoizeOnLapInputs<T>(compute: (snapshot: RaceSnapshot) => T): (snapshot: RaceSnapshot) => T {
  interface Entry {
    stints: RaceSnapshot['stints']
    currentLap: number | null
    totalLaps: number | null
    sessionType: RaceSnapshot['session']['type']
    result: T
  }
  const cache = new WeakMap<RaceSnapshot['laps'], Entry>()
  return (snapshot) => {
    const hit = cache.get(snapshot.laps)
    if (
      hit != null &&
      hit.stints === snapshot.stints &&
      hit.currentLap === snapshot.currentLap &&
      hit.totalLaps === snapshot.totalLaps &&
      hit.sessionType === snapshot.session.type
    ) {
      return hit.result
    }
    const result = compute(snapshot)
    cache.set(snapshot.laps, {
      stints: snapshot.stints,
      currentLap: snapshot.currentLap,
      totalLaps: snapshot.totalLaps,
      sessionType: snapshot.session.type,
      result
    })
    return result
  }
}

/** Derive the fuel coefficient for a session (physical default outside races). */
export const estimateFuelCoefficient = memoizeOnLapInputs(computeFuelCoefficient)

/**
 * Normalise a lap time to the end-of-race (near-empty) fuel reference. A no-op
 * when the coefficient carries no race distance, so non-race sessions and
 * unknown-distance races pass through unchanged.
 */
export function fuelCorrect(lapTime: number, lapNumber: number, coeff: FuelCoefficient): number {
  if (coeff.totalLaps == null) return lapTime
  const lapsRemaining = Math.max(0, coeff.totalLaps - lapNumber)
  return lapTime - coeff.sPerLap * lapsRemaining
}
