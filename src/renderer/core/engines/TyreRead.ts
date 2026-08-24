/**
 * TyreRead — one pure, at-a-glance read of a driver's current tyre.
 *
 * The dossier previously showed only a compound pill and a lap count, which
 * leaves the two questions a viewer actually asks unanswered: how worn is this
 * set really, and is the pace drop the tyre or the car in front? Both answers
 * already exist inside the strategy engines; this module assembles them into a
 * single value object so the widget stays presentational and the numbers can be
 * unit-tested without a DOM.
 *
 * Every field is honest about provenance: anything the feed cannot support comes
 * back null rather than as a confident-looking guess.
 */

import type { LapSample, TimingEntry, TyreCompound, TyreStintRecord } from '@shared/models'
import type { RaceSnapshot } from '@renderer/core/providers/types'
import { StrategyEngine, fuelCorrectedLapTimes } from '@renderer/core/engines/StrategyEngine'
import {
  classifyTrackContamination,
  type ContaminationReason
} from '@renderer/core/engines/PitCycleModel'
import { compoundModel } from '@renderer/core/engines/AnalyticsEngine'
import { estimateFuelCoefficient } from '@renderer/core/engines/FuelModel'
import { reconcileTyreHistory } from '@renderer/core/providers/f1normalize'

/** Degradation bands (s/lap) used for the headline verdict. */
const DEG_STEADY_MAX = 0.06
const DEG_WORKING_MAX = 0.14

export type TyreCondition = 'fresh' | 'steady' | 'working' | 'spent'

/** Why a degradation slope is unavailable, when it is. */
export type DegradationBlocker = 'traffic' | 'insufficient-laps' | null

export interface TyreReadModel {
  readonly compound: TyreCompound | null
  /**
   * Laps run on this SET, including laps carried over from an earlier stint on
   * a used set. This is the number that governs wear.
   */
  readonly setAge: number | null
  /**
   * Laps run in the CURRENT stint. Differs from `setAge` on a used set, and is
   * the right basis for reading this stint's own pace trend.
   */
  readonly stintLaps: number | null
  /** True when the set was fitted used — `setAge` and `stintLaps` disagree. */
  readonly usedSet: boolean

  /**
   * Measured degradation over this stint's clean laps (s/lap), or null when it
   * cannot be measured honestly. `degradationBlocker` says which.
   */
  readonly degradationPerLap: number | null
  readonly degradationBlocker: DegradationBlocker
  /** Clean laps behind the slope, for an honest sample-size read. */
  readonly slopeSampleLaps: number

  /** Banded verdict for the headline. Null exactly when the slope is null. */
  readonly condition: TyreCondition | null

  /**
   * Estimated pace loss on the latest clean lap versus the first lap in this
   * slope window (seconds). This is NOT cumulative race time lost and makes no
   * pit-payback claim. Null when the slope is unavailable.
   */
  readonly latestLapLossSec: number | null

  /**
   * This compound's degradation across the whole field this event (s/lap), so
   * the driver's own number can be read as better or worse than the norm.
   */
  readonly fieldDegradationPerLap: number | null
  /** True when the field figure is measured this event rather than estimated. */
  readonly fieldDegradationMeasured: boolean

  /**
   * Short broadcast-style set label, e.g. "M2" (2nd Medium set used this
   * session). Null when there isn't enough stint history to count sets.
   */
  readonly setLabel: string | null
  /**
   * Laps already on the set when this stint began ("8L before fit"), from
   * F1's own `TyreStintSeries` feed when available, else the same inferred
   * value already carried by `setAge`/`stintLaps`.
   */
  readonly priorStintLaps: number | null
  /** True when `priorStintLaps` is F1's direct statement, not an inference. */
  readonly ageIsDirect: boolean
  /** This driver's full stint history from `TyreStintSeries`, for a set-history view. */
  readonly stintHistory: readonly TyreStintRecord[] | null

  /**
   * The last 6 clean, fuel-corrected laps behind `degradationPerLap` — the
   * exact series a sparkline should plot to make a cliff, flat trend, or
   * recovery visible without reading prose. Empty (not null) when there are no
   * clean laps to show, matching `stint`'s own emptiness.
   */
  readonly sparklineLaps: readonly { lapNumber: number; correctedSec: number }[]

  /**
   * Why `degradationBlocker` is `'traffic'`, in more specific terms than the
   * single bare label — e.g. `['close-traffic', 'train']` vs `['neutralized']`.
   * Empty when the blocker isn't traffic.
   */
  readonly contaminationReasons: readonly ContaminationReason[]
}

/** Clean, representative laps: real times, no in/out laps. */
function isCleanLap(lap: LapSample): boolean {
  return lap.lapTime != null && lap.lapTime > 0 && !lap.isPitInLap && !lap.isPitOutLap
}

/**
 * This stint's laps, sliced by `lapsThisStint` rather than tyre age.
 *
 * On a used set those differ, and slicing by the larger tyre age pulls laps
 * from an EARLIER stint on the same compound — run on fresher rubber — into the
 * window, flattening the very slope being measured.
 */
function stintLapsFor(entry: TimingEntry, laps: readonly LapSample[]): LapSample[] {
  const compound = entry.compound
  if (compound == null) return laps.filter(isCleanLap)
  const sameCompound = laps.filter((lap) => lap.compound === compound && isCleanLap(lap))
  const count = entry.lapsThisStint ?? entry.stintAge
  if (count == null || !Number.isFinite(count) || count < 0) return sameCompound
  if (count === 0) return []
  return sameCompound.slice(-Math.max(0, Math.trunc(count)))
}

function conditionFor(slope: number, setAge: number | null): TyreCondition {
  // A set only a handful of laps old reads as fresh regardless of early noise.
  if (setAge != null && setAge <= 2) return 'fresh'
  if (slope <= DEG_STEADY_MAX) return 'steady'
  if (slope <= DEG_WORKING_MAX) return 'working'
  return 'spent'
}

/**
 * Build the tyre read for one driver.
 *
 * `laps` is the driver's own lap history, already bounded to the replay clock
 * by the caller — this function never reaches past what the snapshot knows.
 */
export function buildTyreRead(
  snapshot: RaceSnapshot,
  entry: TimingEntry,
  laps: readonly LapSample[]
): TyreReadModel {
  const compound = entry.compound
  const setAge = entry.stintAge ?? null
  const stintCount = entry.lapsThisStint ?? null
  const stint = stintLapsFor(entry, laps)

  // Traffic contaminates the pace trend: a car held up behind another is slow
  // for a reason that has nothing to do with its tyres, and reporting that as
  // degradation is exactly the misread this panel exists to avoid.
  const contamination = classifyTrackContamination(snapshot, entry)
  // Fuel-corrected, and not optionally so: `fieldDegradationPerLap` below comes
  // from AnalyticsEngine, which already corrects. Comparing a raw driver slope
  // against a corrected field slope would be apples to oranges, and the burn-off
  // (~0.055 s/lap) is large enough on its own to make a set that is genuinely
  // losing 0.03 s/lap read as improving.
  const fuelCoefficient = estimateFuelCoefficient(snapshot)
  const rawSlope = StrategyEngine.degradationTrend(stint, 6, fuelCoefficient)
  // The exact series the slope above was regressed over — a sparkline shows it
  // directly rather than the driver having to trust the single scalar slope.
  const sparklineLaps = fuelCorrectedLapTimes(stint, 6, fuelCoefficient)

  let degradationPerLap: number | null = null
  let degradationBlocker: DegradationBlocker = null
  if (contamination.isContaminated) {
    degradationBlocker = 'traffic'
  } else if (rawSlope == null) {
    degradationBlocker = 'insufficient-laps'
  } else {
    degradationPerLap = rawSlope
  }

  const latestLapLossSec =
    degradationPerLap != null && stint.length > 0
      ? Math.max(0, degradationPerLap * (stint.length - 1))
      : null

  const fieldEntry = compound != null ? (compoundModel(snapshot).get(compound) ?? null) : null

  const history = snapshot.tyreStintHistory?.find((h) => h.driverNumber === entry.driverNumber)
  const currentTyre = snapshot.currentTyres?.find((t) => t.driverNumber === entry.driverNumber)
  const reconciliation = reconcileTyreHistory(
    history,
    { compound: entry.compound, age: entry.stintAge },
    currentTyre
  )
  const priorStintLaps = reconciliation.activeStint
    ? reconciliation.activeStint.ageAtStart
    : setAge != null && stintCount != null
      ? Math.max(0, setAge - stintCount)
      : null
  const setLabel = buildSetLabel(compound, history, reconciliation.activeStint)

  return {
    compound,
    setAge,
    stintLaps: stintCount ?? (stint.length > 0 ? stint.length : null),
    usedSet: setAge != null && stintCount != null && setAge > stintCount,
    degradationPerLap,
    degradationBlocker,
    slopeSampleLaps: stint.length,
    condition: degradationPerLap != null ? conditionFor(degradationPerLap, setAge) : null,
    latestLapLossSec,
    fieldDegradationPerLap: fieldEntry?.deg ?? null,
    fieldDegradationMeasured: fieldEntry?.measured ?? false,
    setLabel,
    priorStintLaps,
    ageIsDirect: !reconciliation.inferred,
    stintHistory: history?.stints ?? null,
    sparklineLaps,
    contaminationReasons: degradationBlocker === 'traffic' ? contamination.reasons : []
  }
}

const COMPOUND_LETTER: Record<TyreCompound, string> = {
  SOFT: 'S',
  MEDIUM: 'M',
  HARD: 'H',
  INTERMEDIATE: 'I',
  WET: 'W',
  UNKNOWN: '?'
}

/**
 * Broadcast-style set label, e.g. "M2" for the 2nd Medium set of the session.
 * The feed carries no literal set serial number, so the ordinal is counted
 * from the driver's own TyreStintSeries history — null without that history.
 */
function buildSetLabel(
  compound: TyreCompound | null,
  history: { stints: readonly TyreStintRecord[] } | undefined,
  activeStint: TyreStintRecord | null
): string | null {
  if (compound == null) return null
  const letter = COMPOUND_LETTER[compound]
  if (!history || !activeStint) return null
  const ordinal = history.stints.filter(
    (s) => s.compound === compound && s.stintNumber <= activeStint.stintNumber
  ).length
  return ordinal > 0 ? `${letter}${ordinal}` : null
}
