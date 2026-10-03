import type { TimingEntry } from '@shared/models'
import type { RaceSnapshot } from '@renderer/core/model/snapshot'
import { driverRecentPace } from '../AnalyticsEngine'
import { estimateFuelCoefficient, type FuelCoefficient } from '../FuelModel'
import { currentStintLaps, degradationTrend, snapshotWithKnownLaps } from './StintLaps'

// ── Pace battle: how much faster/slower vs the car ahead & behind ────────────────

export interface PaceRival {
  number: number
  code: string
  /** Interval to this rival (s), from the timing feed. */
  gapSec: number | null
  /** Gap-change rate (s/lap); positive = the gap is closing. */
  deltaPerLap: number | null
  rivalPace: number | null
  closing: boolean
  /** Laps to erase the gap at the current rate (only when closing). */
  lapsToResolve: number | null
}

export interface PaceBattle {
  available: boolean
  driverNumber: number
  code: string
  position: number | null
  driverPace: number | null
  ahead: PaceRival | null
  behind: PaceRival | null
}

/** How much faster/slower a driver is vs the car directly ahead and behind. */
export function paceComparison(snapshot: RaceSnapshot, driverNumber: number): PaceBattle {
  const liveSnapshot = snapshotWithKnownLaps(snapshot)
  const code =
    liveSnapshot.drivers.find((d) => d.number === driverNumber)?.code ?? `#${driverNumber}`
  const codeOf = (n: number) => liveSnapshot.drivers.find((d) => d.number === n)?.code ?? `#${n}`
  const ordered = [...liveSnapshot.timing]
    .filter((t) => t.position != null)
    .sort((a, b) => (a.position as number) - (b.position as number))
  const idx = ordered.findIndex((t) => t.driverNumber === driverNumber)
  const self =
    idx >= 0 ? ordered[idx] : liveSnapshot.timing.find((t) => t.driverNumber === driverNumber)

  const driverPace = driverRecentPace(liveSnapshot, driverNumber)
  const result: PaceBattle = {
    available: idx >= 0,
    driverNumber,
    code,
    position: self?.position ?? null,
    driverPace,
    ahead: null,
    behind: null
  }
  if (idx < 0) return result

  const num = (v: number | '+1 LAP' | null): number | null => (typeof v === 'number' ? v : null)

  // Ahead: gap shrinks when the focus driver is faster.
  const aheadEntry = idx > 0 ? ordered[idx - 1] : null
  if (aheadEntry) {
    const rivalPace = driverRecentPace(liveSnapshot, aheadEntry.driverNumber)
    const gap = num(self?.intervalAhead ?? null)
    const shrink = rivalPace != null && driverPace != null ? rivalPace - driverPace : null
    const closing = shrink != null && shrink > 0.03
    result.ahead = {
      number: aheadEntry.driverNumber,
      code: codeOf(aheadEntry.driverNumber),
      gapSec: gap,
      deltaPerLap: shrink,
      rivalPace,
      closing,
      lapsToResolve: closing && gap != null && shrink ? gap / shrink : null
    }
  }

  // Behind: gap shrinks when the car behind is faster than the focus driver.
  const behindEntry = idx < ordered.length - 1 ? ordered[idx + 1] : null
  if (behindEntry) {
    const rivalPace = driverRecentPace(liveSnapshot, behindEntry.driverNumber)
    const gap = num(behindEntry.intervalAhead)
    const shrink = rivalPace != null && driverPace != null ? driverPace - rivalPace : null
    const closing = shrink != null && shrink > 0.03
    result.behind = {
      number: behindEntry.driverNumber,
      code: codeOf(behindEntry.driverNumber),
      gapSec: gap,
      deltaPerLap: shrink,
      rivalPace,
      closing,
      lapsToResolve: closing && gap != null && shrink ? gap / shrink : null
    }
  }

  return result
}

// ── Pace duel: any two drivers, degradation-aware closing ETA ───────────────

/** Below this magnitude a closing rate reads as noise, not a real trend (matches `paceComparison`'s threshold). */
const PACE_DUEL_TREND_DEADBAND = 0.03
/**
 * Projection horizon fallback ONLY when the session's remaining-lap count
 * isn't known (no total-lap data — e.g. a session without a resolved lap
 * count). When `lapsRemaining` IS known, it is used directly and uncapped:
 * the real constraint is "does the gap close before the race ends," not an
 * arbitrary window. This used to be `Math.min(lapsRemaining, 40)`, which
 * silently truncated the projection to 40 laps even in a 60-70-lap race
 * with plenty of genuine distance left — any battle developing later than
 * that (common for a tyre-degradation-driven late-race fight) never got an
 * ETA at all, reading as "the module doesn't predict this."
 */
const PACE_DUEL_MAX_PROJECTION_LAPS = 80

export type PaceDuelTrend = 'closing' | 'opening' | 'stable'

export interface PaceDuelSide {
  number: number
  code: string
  position: number | null
  currentPace: number | null
  /** s/lap, fuel-corrected, from the current stint (same basis the Tyre dossier shows); positive = getting slower. Null without enough clean laps. */
  degradationPerLap: number | null
}

export interface PaceDuel {
  available: boolean
  /** Whichever of the two chosen drivers is currently ahead on track. */
  ahead: PaceDuelSide
  behind: PaceDuelSide
  gapSec: number | null
  /** At the CURRENT moment, before any degradation projection — positive means the gap is shrinking. */
  closingRatePerLap: number | null
  trend: PaceDuelTrend
  /**
   * Laps until the gap crosses zero. Unlike a flat `gap / closingRate`
   * division, this projects each driver's OWN current-stint degradation
   * trend forward lap by lap — a driver whose tyres are falling away closes
   * (or opens) the gap faster than their current single-lap pace alone
   * suggests. A driver with no readable degradation trend is projected flat
   * (their current pace, unchanged) rather than dropping the estimate
   * entirely — only a genuinely missing PACE reading (not degradation) makes
   * this null. Also null when the gap doesn't close within the laps left in
   * the session.
   */
  lapsToResolve: number | null
}

function paceDuelSide(
  snapshot: RaceSnapshot,
  entry: TimingEntry,
  codeOf: (n: number) => string,
  fuelCoefficient: FuelCoefficient | undefined
): PaceDuelSide {
  const driverLaps = snapshot.laps.filter((l) => l.driverNumber === entry.driverNumber)
  const stintLaps = currentStintLaps(entry, driverLaps)
  return {
    number: entry.driverNumber,
    code: codeOf(entry.driverNumber),
    position: entry.position,
    currentPace: driverRecentPace(snapshot, entry.driverNumber),
    degradationPerLap: degradationTrend(stintLaps, 6, fuelCoefficient)
  }
}

/** Project the gap forward lap by lap, each side's pace evolving by its own degradation trend. */
function projectPaceDuelClosingLaps(
  gapSec: number | null,
  ahead: PaceDuelSide,
  behind: PaceDuelSide,
  lapsRemaining: number | null
): number | null {
  if (gapSec == null || gapSec <= 0) return null
  if (ahead.currentPace == null || behind.currentPace == null) return null
  // Uncapped when the race's own remaining-lap count is known — that IS the
  // real horizon (a fight can't happen after the chequered flag, but there's
  // no reason to invent a shorter one). Only fall back to the constant when
  // there's no lap-count data to bound the search at all.
  const horizon = lapsRemaining ?? PACE_DUEL_MAX_PROJECTION_LAPS
  if (horizon <= 0) return null
  let remainingGap = gapSec
  for (let lap = 1; lap <= horizon; lap++) {
    const aheadPace = ahead.currentPace + (ahead.degradationPerLap ?? 0) * lap
    const behindPace = behind.currentPace + (behind.degradationPerLap ?? 0) * lap
    remainingGap -= aheadPace - behindPace
    if (remainingGap <= 0) return lap
  }
  return null
}

/**
 * Pace duel between any two drivers, not just track-adjacent ones (unlike
 * `paceComparison`, which only ever compares the focus driver against
 * whoever is immediately ahead/behind). Gap is derived from the difference
 * in `gapToLeader` (both already computed by the timing feed), same-lap
 * assumption noted like the rest of this file's gap logic.
 */
export function paceBattleBetween(
  snapshot: RaceSnapshot,
  driverA: number,
  driverB: number
): PaceDuel {
  const liveSnapshot = snapshotWithKnownLaps(snapshot)
  const codeOf = (n: number) => liveSnapshot.drivers.find((d) => d.number === n)?.code ?? `#${n}`
  const entryOf = (n: number) => liveSnapshot.timing.find((t) => t.driverNumber === n)
  const entryA = entryOf(driverA)
  const entryB = entryOf(driverB)

  const unavailable: PaceDuel = {
    available: false,
    ahead: {
      number: driverA,
      code: codeOf(driverA),
      position: entryA?.position ?? null,
      currentPace: null,
      degradationPerLap: null
    },
    behind: {
      number: driverB,
      code: codeOf(driverB),
      position: entryB?.position ?? null,
      currentPace: null,
      degradationPerLap: null
    },
    gapSec: null,
    closingRatePerLap: null,
    trend: 'stable',
    lapsToResolve: null
  }
  if (!entryA || !entryB || entryA.position == null || entryB.position == null) return unavailable

  const [aheadEntry, behindEntry] =
    entryA.position <= entryB.position ? [entryA, entryB] : [entryB, entryA]

  const num = (v: number | '+1 LAP' | null): number | null => (typeof v === 'number' ? v : null)
  const gapAhead = num(aheadEntry.gapToLeader)
  const gapBehind = num(behindEntry.gapToLeader)
  const gapSec = gapAhead != null && gapBehind != null ? Math.abs(gapBehind - gapAhead) : null

  const fuelCoefficient = estimateFuelCoefficient(liveSnapshot)
  const ahead = paceDuelSide(liveSnapshot, aheadEntry, codeOf, fuelCoefficient)
  const behind = paceDuelSide(liveSnapshot, behindEntry, codeOf, fuelCoefficient)

  const closingRatePerLap =
    ahead.currentPace != null && behind.currentPace != null
      ? ahead.currentPace - behind.currentPace
      : null
  const trend: PaceDuelTrend =
    closingRatePerLap == null
      ? 'stable'
      : closingRatePerLap > PACE_DUEL_TREND_DEADBAND
        ? 'closing'
        : closingRatePerLap < -PACE_DUEL_TREND_DEADBAND
          ? 'opening'
          : 'stable'

  const lapsRemaining =
    liveSnapshot.totalLaps != null && liveSnapshot.currentLap != null
      ? Math.max(0, liveSnapshot.totalLaps - liveSnapshot.currentLap)
      : null
  const lapsToResolve = projectPaceDuelClosingLaps(gapSec, ahead, behind, lapsRemaining)

  return { available: true, ahead, behind, gapSec, closingRatePerLap, trend, lapsToResolve }
}
