import type { LapSample } from '@shared/models'
import { fuelCorrect, type FuelCoefficient } from '@renderer/core/engines/FuelModel'

/**
 * Sector-level degradation diagnosis (APP_IMPROVEMENT_ROADMAP.md P2 item 19).
 *
 * Separates whether lost pace is concentrated in one sector rather than spread
 * evenly across the lap — a whole-lap slope alone can't distinguish "this tyre
 * is going off in the fast corners" from "traffic cost a tenth everywhere".
 *
 * Fuel correction is applied per-sector proportional to that sector's average
 * share of total lap time — fuel burn isn't sector-localized, so distributing
 * the same whole-lap coefficient by time-share is the honest approximation
 * (documented here rather than presented as sector-measured combustion).
 */

export interface SectorDegradationPoint {
  sector: 1 | 2 | 3
  /** Least-squares slope, s/lap; null without enough clean laps. */
  slopeSecPerLap: number | null
  /** Latest clean corrected sector time minus the driver's own session-best; null if either is unknown. */
  deltaToBestSec: number | null
}

function sectorValueOrNull(lap: LapSample, sector: 1 | 2 | 3): number | null {
  return sector === 1 ? lap.sector1 : sector === 2 ? lap.sector2 : lap.sector3
}

/**
 * Filtered per SECTOR, not per lap: a lap missing one sector's time (a real
 * possibility on a live feed) still counts toward the OTHER two sectors'
 * trends. The previous all-or-nothing filter (require all three sectors on
 * the same lap) meant one missing sector silently zeroed out every sector's
 * trend for that lap, not just its own.
 */
function cleanLaps(laps: LapSample[], lastN: number, sector: 1 | 2 | 3): LapSample[] {
  return laps
    .filter(
      (l) =>
        l.lapTime != null &&
        l.lapTime > 0 &&
        !l.isPitOutLap &&
        !l.isPitInLap &&
        sectorValueOrNull(l, sector) != null
    )
    .slice(-lastN)
}

function sectorValue(lap: LapSample, sector: 1 | 2 | 3): number {
  return sectorValueOrNull(lap, sector) as number
}

function averageSectorShare(laps: LapSample[], sector: 1 | 2 | 3): number {
  const totalLap = laps.reduce((sum, l) => sum + (l.lapTime as number), 0)
  if (totalLap <= 0) return 1 / 3
  const totalSector = laps.reduce((sum, l) => sum + sectorValue(l, sector), 0)
  return totalSector / totalLap
}

function leastSquaresSlope(ys: number[]): number | null {
  const n = ys.length
  if (n < 3) return null
  const xs = ys.map((_, i) => i)
  const meanX = xs.reduce((a, b) => a + b, 0) / n
  const meanY = ys.reduce((a, b) => a + b, 0) / n
  let num = 0
  let den = 0
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (ys[i] - meanY)
    den += (xs[i] - meanX) ** 2
  }
  return den === 0 ? null : num / den
}

/**
 * Per-sector degradation slope and delta-to-best over the last `lastN` clean
 * laps of `laps` (caller pre-filters to the current stint / non-contaminated
 * laps — this function only requires valid sector data).
 */
export function sectorDegradationTrend(
  laps: LapSample[],
  lastN = 6,
  coeff?: FuelCoefficient,
  bestSectorsSec: readonly [number | null, number | null, number | null] = [null, null, null]
): SectorDegradationPoint[] {
  return ([1, 2, 3] as const).map((sector) => {
    const clean = cleanLaps(laps, lastN, sector)
    if (clean.length < 3) {
      return { sector, slopeSecPerLap: null, deltaToBestSec: null }
    }
    const share = averageSectorShare(clean, sector)
    const corrected = clean.map((l) => {
      const raw = sectorValue(l, sector)
      if (!coeff) return raw
      // Distribute the whole-lap fuel correction by this sector's time-share.
      const wholeLapCorrected = fuelCorrect(l.lapTime as number, l.lapNumber, coeff)
      const wholeLapDelta = wholeLapCorrected - (l.lapTime as number)
      return raw + wholeLapDelta * share
    })
    const slopeSecPerLap = leastSquaresSlope(corrected)
    const best = bestSectorsSec[sector - 1]
    const deltaToBestSec = best != null ? corrected[corrected.length - 1] - best : null
    return { sector, slopeSecPerLap, deltaToBestSec }
  })
}
