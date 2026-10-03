import type { TimingEntry } from '@shared/models'
import { CAR_CHANNELS, indexedToArray, type F1StreamPoint } from '@shared/f1live'
import {
  initErsState,
  integrateErs,
  startLap,
  computeErsEstimate,
  applyOvertakeEligibility,
  deriveEnergyTrend,
  explainOvertakeEligibility,
  eligibilityDurationSec,
  type ErsDriverState,
  type ErsEstimate,
  type ErsTelemetrySample
} from '@renderer/core/engines/ErsEstimator'
import { nearestAtOrBefore } from '../normalize'
import type { LapRecord } from '../f1normalize'
import { numOrNull as num, rec } from './shared'
import { PRECOMPUTE_YIELD_EVERY, yieldToRenderer } from './scheduler'

// ── ERS estimate (2026 ~50%-electric power unit) ────────────────────────────
//
// The public F1 feed exposes throttle/brake/speed/aero but NOT battery state.
// We derive a labelled ESTIMATE via the shared, unit-tested `ErsEstimator`
// engine (harvest under braking, deploy under power, mean-reverting to a
// working window), computed once in a forward pass and decimated for lookup.
// energyIsEstimate is always set; values are absent entirely without CarData.
//
// Moved from F1LiveProvider.ts; the provider owns `ersBuild` and `ersPoints`.

/** One decimated ERS lookup entry: everyone's estimate at session time `t`. */
export interface ErsPoint {
  t: number
  byDriver: Record<number, ErsEstimate>
}

/**
 * Drop ERS estimates older than the oldest retained CarData point. They are
 * derived from telemetry that no longer exists to scrub to, and the integrator's
 * running state lives in `ErsBuild`, not in the estimates, so nothing later
 * depends on them.
 */
export function trimErsPoints(ersPoints: ErsPoint[], oldestCarDataT: number): void {
  let stale = 0
  while (stale < ersPoints.length && ersPoints[stale].t < oldestCarDataT) stale++
  if (stale > 0) ersPoints.splice(0, stale)
}

/** Decimation spacing (s) for the ERS lookup timeline (~1.5s ≈ display cadence). */
const ERS_EMIT_DT = 1.5

export interface ErsBuild {
  states: Map<number, ErsDriverState>
  lastSample: Map<number, ErsTelemetrySample>
  lastT: Map<number, number>
  lastEmit: number
  /**
   * Index of the next not-yet-crossed lap boundary in `lapsByDriver`, per driver.
   * The ERS budgets refill once per lap, so the integrator needs to know when a
   * car crossed the line. Kept as a forward-only cursor so a streaming CarData
   * chunk costs O(new points), never O(laps × points).
   */
  lapCursor: Map<number, number>
}

export function newErsBuild(): ErsBuild {
  return {
    states: new Map(),
    lastSample: new Map(),
    lastT: new Map(),
    lastEmit: -Infinity,
    lapCursor: new Map()
  }
}

/**
 * Integrate one chronological batch of CarData into the decimated ERS
 * timeline. Called with the full array at ingest (live payloads) and with
 * each streamed chunk during archive enrichment — same math either way.
 *
 * `build`, `target` and `lapsByDriver` are captured by the caller when the batch
 * starts, so a superseded load can only ever write into orphans; `isSuperseded`
 * is polled at each yield.
 */
export async function integrateErsBatch(
  points: F1StreamPoint[],
  build: ErsBuild,
  target: ErsPoint[],
  lapsByDriver: Map<number, LapRecord[]>,
  isSuperseded: () => boolean
): Promise<void> {
  for (let pointIndex = 0; pointIndex < points.length; pointIndex++) {
    const point = points[pointIndex]
    for (const e of indexedToArray(rec(point.d).Entries)) {
      const cars = rec(rec(e).Cars)
      for (const [key, carRaw] of Object.entries(cars)) {
        if (!/^\d+$/.test(key)) continue
        const dn = +key
        const ch = rec(rec(carRaw).Channels)
        const sample: ErsTelemetrySample = {
          throttle: num(ch[CAR_CHANNELS.throttle]),
          speed: num(ch[CAR_CHANNELS.speed]),
          brake: num(ch[CAR_CHANNELS.brake]),
          aeroChannel: num(ch[CAR_CHANNELS.drs])
        }
        const dt = point.t - (build.lastT.get(dn) ?? point.t) // integrateErs clamps this
        build.lastT.set(dn, point.t)
        let state = build.states.get(dn) ?? initErsState()
        // Crossing the line refills the lap's harvest/deployment allowances.
        state = advanceErsLaps(build, lapsByDriver, dn, point.t, state)
        build.states.set(dn, integrateErs(state, sample, dt))
        build.lastSample.set(dn, sample)
      }
    }
    // Emit a decimated snapshot of everyone's estimate (SoC + inferred mode).
    const yieldDue = pointIndex > 0 && pointIndex % PRECOMPUTE_YIELD_EVERY === 0
    if (point.t - build.lastEmit >= ERS_EMIT_DT) {
      build.lastEmit = point.t
      const byDriver: Record<number, ErsEstimate> = {}
      for (const [dn, st] of build.states) {
        byDriver[dn] = computeErsEstimate(st, build.lastSample.get(dn) ?? null)
      }
      target.push({ t: point.t, byDriver })
    }
    if (yieldDue) {
      await yieldToRenderer()
      if (isSuperseded()) return
    }
  }
}

/**
 * Refill the per-lap ERS allowances for every lap this driver completed at or
 * before `t`.
 *
 * The lap boundary comes from the timing feed (`LapRecord.tComplete`), which
 * is fully applied before CarData integrates — at ingest `appendLapHistory`
 * runs first, and during archive enrichment the timing feed finishes before
 * the `.z` telemetry streams. The cursor only moves forward, so a driver whose
 * laps arrive later simply refills from wherever the cursor had reached.
 */
function advanceErsLaps(
  build: ErsBuild,
  lapsByDriver: Map<number, LapRecord[]>,
  driverNumber: number,
  t: number,
  state: ErsDriverState
): ErsDriverState {
  const laps = lapsByDriver.get(driverNumber)
  if (!laps || laps.length === 0) return state
  let cursor = build.lapCursor.get(driverNumber) ?? 0
  let next = state
  while (cursor < laps.length && laps[cursor].tComplete <= t) {
    next = startLap(next)
    cursor++
  }
  build.lapCursor.set(driverNumber, cursor)
  return next
}

/**
 * Attach the ERS estimate to each timing entry at session time `clock`.
 * `eligibleSinceClock` is the replay view's forward-playback bookkeeping and is
 * mutated as it reads; `timing` entries must be freshly built for this call.
 */
export function attachErs(
  timing: TimingEntry[],
  clock: number,
  ersPoints: ErsPoint[],
  eligibleSinceClock: Map<number, number>
): void {
  if (ersPoints.length === 0) return
  const point = nearestAtOrBefore(ersPoints, clock, (p) => p.t)
  if (!point) return
  for (const e of timing) {
    const est = point.byDriver[e.driverNumber]
    if (!est || est.energyPct == null) continue
    e.energyPct = est.energyPct
    // Overtake Mode is distinct from Boost and is only available when the car
    // is within one second at detection. Timing gives us an honest eligibility
    // signal; the public feed does not expose the driver's button press.
    e.deployMode = applyOvertakeEligibility(est.deployMode, e.intervalAhead)
    e.energyIsEstimate = true
    e.energyConfidence = est.confidence ?? undefined
    e.energyDeployBudgetPct = est.deployBudgetRemainingPct
    const trend = deriveEnergyTrend(ersPoints, e.driverNumber, clock)
    e.energyTrend = trend.direction
    e.energyTrendDeltaPct = trend.deltaPct
    e.energyDeploymentLimited = est.deploymentLimited

    const eligibility = explainOvertakeEligibility(
      e.deployMode,
      e.intervalAhead,
      est.deployBudgetRemainingPct
    )
    if (eligibility.eligible) {
      if (eligibleSinceClock.get(e.driverNumber) == null) {
        eligibleSinceClock.set(e.driverNumber, clock)
      }
    } else {
      eligibleSinceClock.delete(e.driverNumber)
    }
    e.energyEligibleForSec = eligibility.eligible
      ? eligibilityDurationSec(eligibleSinceClock.get(e.driverNumber), clock)
      : null
    e.energyEligibilityReason = eligibility.reason
  }
}
