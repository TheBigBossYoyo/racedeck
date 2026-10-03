import type { LapSample, TimingEntry, TyreCompound } from '@shared/models'
import type { RaceSnapshot } from '@renderer/core/model/snapshot'
import { fuelCorrect, type FuelCoefficient } from '../FuelModel'

/**
 * Lap- and gap-windowing helpers shared by the strategy modules: which laps a
 * snapshot may legitimately know about, which of them belong to the current stint,
 * and the fuel-corrected degradation slope fitted over them.
 */

export interface DegradationTrend {
  driverNumber: number
  compound: TyreCompound | null
  slopePerLap: number | null
  sampleLaps: number
}

// ── gap helpers ────────────────────────────────────────────────────────────────

/** Numeric gap-to-leader in seconds, or null when unknown / lapped. */
export function numericGap(e: TimingEntry): number | null {
  if (e.position === 1) return 0
  if (typeof e.gapToLeader === 'number') return e.gapToLeader
  return null // '+1 LAP' or null → excluded from the road-position projection
}

function isKnownLapAtSnapshot(snapshot: RaceSnapshot, lap: LapSample): boolean {
  if (lap.sessionTime != null && Number.isFinite(lap.sessionTime)) {
    return lap.sessionTime <= snapshot.clock
  }
  if (snapshot.currentLap != null) return lap.lapNumber <= snapshot.currentLap
  return true
}

export function knownLapsAtSnapshot(snapshot: RaceSnapshot, laps: LapSample[]): LapSample[] {
  return laps.filter((lap) => isKnownLapAtSnapshot(snapshot, lap))
}

export function snapshotWithKnownLaps(snapshot: RaceSnapshot): RaceSnapshot {
  const laps = knownLapsAtSnapshot(snapshot, snapshot.laps)
  return laps.length === snapshot.laps.length ? snapshot : { ...snapshot, laps }
}

/**
 * The laps run in the driver's CURRENT stint.
 *
 * Must slice by `lapsThisStint`, not `stintAge`: on a used set those differ by
 * the laps the tyres already carried, and slicing by the larger tyre age drags
 * laps from an EARLIER stint on the same compound into the window — on a fresher
 * set, which flattens the degradation slope and skews every pit-window estimate.
 * Falls back to `stintAge` only when the stint-relative count is unavailable.
 */
export function currentStintLaps(entry: TimingEntry | undefined, laps: LapSample[]): LapSample[] {
  const compound = entry?.compound ?? null
  if (compound == null) return laps
  const sameCompound = laps.filter((lap) => lap.compound === compound)
  const stintLaps = entry?.lapsThisStint ?? entry?.stintAge
  if (stintLaps == null || !Number.isFinite(stintLaps) || stintLaps <= 0) return sameCompound
  return sameCompound.slice(-Math.max(0, Math.trunc(stintLaps)))
}

/**
 * One clean lap's fuel-corrected time, from `degradationTrend`'s own filtering
 * (real time, no in/out lap) and correction (`fuelCorrect` when `coeff` is
 * given). Factored out so a per-lap SPARKLINE can show the exact series behind
 * the slope instead of re-deriving the same filtering/correction separately.
 */
export function fuelCorrectedLapTimes(
  laps: LapSample[],
  lastN = 6,
  coeff?: FuelCoefficient
): { lapNumber: number; correctedSec: number }[] {
  return laps
    .filter((l) => l.lapTime != null && l.lapTime > 0 && !l.isPitOutLap && !l.isPitInLap)
    .slice(-lastN)
    .map((l) => ({
      lapNumber: l.lapNumber,
      correctedSec: coeff
        ? fuelCorrect(l.lapTime as number, l.lapNumber, coeff)
        : (l.lapTime as number)
    }))
}

/**
 * Linear tyre-deg slope (s/lap) from the last N green laps of a stint.
 *
 * Pass `coeff` wherever a snapshot is available: a race car burns off fuel as
 * the stint runs, which makes later laps faster for reasons that have nothing
 * to do with the tyre. Uncorrected, that burn (~0.055 s/lap) is subtracted
 * straight off the measured slope, so a set genuinely losing 0.03 s/lap reads
 * as IMPROVING and every degradation band lands a step too optimistic.
 * Omitting `coeff` keeps the raw behaviour for callers holding bare laps.
 */
export function degradationTrend(
  laps: LapSample[],
  lastN = 6,
  coeff?: FuelCoefficient
): number | null {
  const clean = fuelCorrectedLapTimes(laps, lastN, coeff)
  if (clean.length < 3) return null
  // Simple least-squares slope over lap index.
  const n = clean.length
  const xs = clean.map((_, i) => i)
  const ys = clean.map((l) => l.correctedSec)
  const meanX = xs.reduce((a, b) => a + b, 0) / n
  const meanY = ys.reduce((a, b) => a + b, 0) / n
  let num = 0
  let den = 0
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (ys[i] - meanY)
    den += (xs[i] - meanX) ** 2
  }
  if (den === 0) return null
  return num / den
}
