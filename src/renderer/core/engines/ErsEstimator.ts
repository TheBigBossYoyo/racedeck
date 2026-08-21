/**
 * ErsEstimator — pure, deterministic battery model for real F1 sessions.
 *
 * The public F1 timing feed doesn't expose battery state, so this module derives
 * a *labelled estimate* from CarData telemetry (throttle, speed, brake, ch45 aero).
 * It is NOT real battery data — callers must set `energyIsEstimate = true` and the
 * UI must show the "~" / "est." marker so the user is never misled.
 *
 * Design goals:
 *  - Pure functions: no module-level state, fully unit-testable.
 *  - Cheap per tick: only arithmetic; no loops over history each snapshot.
 *  - Honest: returns null values when insufficient data rather than guessing.
 *  - 2026 terminology: BOOST is manual deployment; OVERTAKE is eligibility-based
 *    and is assigned by the provider using the timing interval to the car ahead.
 *
 * Energy model (simplified 2026 ~50%-electric PU):
 *  - DEPLOY zone  (throttle > 75% AND speed > 200 km/h): drains ~1.8 %/s.
 *  - BOOST zone (Straight Mode + throttle > 85% + speed > 200): drains faster.
 *  - HARVEST/brake (brake > 20% AND throttle < 20%): charges ~1.4 %/s.
 *  - HARVEST/lift  (throttle < 20% AND speed > 50 km/h, no brake): charges ~0.4 %/s.
 *  - Otherwise (BALANCED): very mild trickle.
 *  - PLUS a gentle mean-reversion toward a working baseline SoC. This is what
 *    keeps the estimate honest over a stint: 2026 ERS deployment is capped per
 *    lap by regulation and actively managed, so real SoC oscillates in a working
 *    window rather than draining monotonically. Without this a power circuit
 *    (long full-throttle stretches) would rail the estimate to empty. The
 *    reversion makes deployment settle to an equilibrium instead of the floor.
 *  - SoC is clamped [0, 100].
 */

import type { EnergyMode } from '@shared/models'

// ── Public types ──────────────────────────────────────────────────────────────

/** Per-driver rolling state, passed through `integrateErs` incrementally. */
export interface ErsDriverState {
  /** Current battery state-of-charge, 0–100. */
  soc: number
  /** Total number of telemetry samples integrated so far. */
  sampleCount: number
}

/** One telemetry frame fed into the estimator. All channels may be null. */
export interface ErsTelemetrySample {
  /** Throttle position 0–100. */
  throttle: number | null
  /** Speed km/h. */
  speed: number | null
  /** Brake pressure 0–100 (or any positive value for braking). */
  brake: number | null
  /** Raw channel-45 value (active aero): 10/12/14 = Straight Mode. */
  aeroChannel: number | null
}

/** Result from `computeErsEstimate`. Both fields are null when data is insufficient. */
export interface ErsEstimate {
  energyPct: number | null
  deployMode: EnergyMode | null
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** Starting SoC assumption — realistic mid-stint value. */
const INITIAL_SOC = 65

/**
 * Minimum samples before we trust the estimate enough to report it.
 * Avoids garbage-in-first-tick values when only 1–2 telem frames have arrived.
 */
const MIN_SAMPLES_FOR_ESTIMATE = 4

const MAX_SOC = 100
const MIN_SOC = 0

/** Energy flow rates in %/s. Tuned so sustained attack drains SoC toward a low
 *  working equilibrium (see reversion below) rather than to the floor. */
const DRAIN_DEPLOY_PER_S = 1.8
/** Extra factor on drain during manual Boost deployment. */
const DRAIN_BOOST_MULTIPLIER = 1.6
const HARVEST_BRAKE_PER_S = 1.4
const HARVEST_LIFT_PER_S = 0.4
/** Very mild trickle in balanced/transitional state (near-zero). */
const BALANCED_FLOW_PER_S = -0.04

/**
 * Working-window SoC the model relaxes toward, and how strongly (per second).
 * Emulates the per-lap deployment budget: deployment eases as the battery
 * depletes and harvesting eases as it fills, so SoC settles into a window
 * instead of railing. Equilibrium under sustained deploy ≈ BASELINE −
 * DRAIN/REVERT_K; with these values ≈ 60 − 1.8/0.05 = 24% (a believable low).
 */
const BASELINE_SOC = 60
const REVERT_PER_S = 0.05

/** Maximum believable dt per integration step (guards against cold-start spikes). */
const MAX_DT_S = 5

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Create a fresh per-driver state at a sensible starting SoC.
 * Call this when the driver is first seen or when the cursor resets.
 */
export function initErsState(): ErsDriverState {
  return { soc: INITIAL_SOC, sampleCount: 0 }
}

/**
 * Integrate one telemetry frame into the driver's ERS state.
 *
 * @param state  The previous per-driver state (treated as immutable).
 * @param sample Channel values for this frame.
 * @param dt     Time elapsed since the previous sample, in seconds.
 * @returns      New per-driver state with updated SoC and sampleCount.
 */
export function integrateErs(
  state: ErsDriverState,
  sample: ErsTelemetrySample,
  dt: number
): ErsDriverState {
  const safeDt = Math.max(0, Math.min(dt, MAX_DT_S))
  // Still increment sampleCount even for dt=0 so callers see the count advance.
  const sampleCount = state.sampleCount + 1

  if (safeDt === 0) {
    return { soc: state.soc, sampleCount }
  }

  const thr = sample.throttle ?? 0
  const spd = sample.speed ?? 0
  const brk = sample.brake ?? 0
  const aero = sample.aeroChannel

  let flowPerS: number
  const isAeroOpen = aero === 10 || aero === 12 || aero === 14
  if (thr > 75 && spd > 200) {
    // Deployment zone; harder drain when the driver uses Boost on a straight.
    const boostActive = isAeroOpen && thr > 85
    flowPerS = boostActive
      ? -DRAIN_DEPLOY_PER_S * DRAIN_BOOST_MULTIPLIER
      : -DRAIN_DEPLOY_PER_S
  } else if (brk > 20 && thr < 20) {
    // Braking harvest
    flowPerS = HARVEST_BRAKE_PER_S
  } else if (thr < 20 && spd > 50) {
    // Lift-and-coast harvest
    flowPerS = HARVEST_LIFT_PER_S
  } else {
    flowPerS = BALANCED_FLOW_PER_S
  }

  // Mean-reversion toward the working baseline keeps a stint from railing.
  flowPerS += (BASELINE_SOC - state.soc) * REVERT_PER_S

  const newSoc = Math.min(MAX_SOC, Math.max(MIN_SOC, state.soc + flowPerS * safeDt))
  return { soc: newSoc, sampleCount }
}

/**
 * Infer the current deployment mode from the latest telemetry frame and SoC.
 * Returns null only when the sample has no usable data (all channels null).
 */
export function deriveDeployMode(
  sample: ErsTelemetrySample,
  soc: number
): EnergyMode | null {
  const thr = sample.throttle
  const spd = sample.speed
  const brk = sample.brake
  const aero = sample.aeroChannel

  // Need at least some channel data to make a determination.
  if (thr == null && spd == null && brk == null) return null

  const thrV = thr ?? 0
  const spdV = spd ?? 0
  const brkV = brk ?? 0
  const isAeroOpen = aero === 10 || aero === 12 || aero === 14

  // BOOST = driver-controlled high-power deployment. Overtake eligibility needs
  // timing data and is therefore applied by F1LiveProvider, not guessed here.
  if (isAeroOpen && thrV > 85 && spdV > 200 && soc > 12) {
    return 'BOOST'
  }
  // DEPLOY: high throttle, high speed.
  if (thrV > 75 && spdV > 200) {
    return 'DEPLOY'
  }
  // HARVEST: braking phase.
  if (brkV > 20 && thrV < 20) {
    return 'HARVEST'
  }
  // HARVEST: lift-and-coast (no throttle, no braking, moving).
  if (thrV < 20 && spdV > 50) {
    return 'HARVEST'
  }
  return 'BALANCED'
}

/**
 * Apply timing-based Overtake Mode eligibility to a telemetry-derived mode.
 * Boost and Overtake are distinct: telemetry can infer high-power Boost, while
 * only the interval to the car ahead can establish the one-second Overtake aid.
 */
export function applyOvertakeEligibility(
  mode: EnergyMode | null,
  intervalAhead: number | '+1 LAP' | null
): EnergyMode | null {
  const eligible =
    typeof intervalAhead === 'number' && intervalAhead > 0 && intervalAhead <= 1
  return eligible && (mode === 'BOOST' || mode === 'DEPLOY') ? 'OVERTAKE' : mode
}

/**
 * Compute the ERS estimate for display from the current driver state.
 *
 * Returns `{ energyPct: null, deployMode: null }` when the estimator has not
 * seen enough data to produce a trustworthy reading — the UI must show nothing
 * (not zeros) in that case.
 *
 * @param state        Current per-driver ERS state (from `integrateErs`).
 * @param latestSample The most recent telemetry frame for mode inference.
 */
export function computeErsEstimate(
  state: ErsDriverState,
  latestSample: ErsTelemetrySample | null
): ErsEstimate {
  if (state.sampleCount < MIN_SAMPLES_FOR_ESTIMATE) {
    return { energyPct: null, deployMode: null }
  }
  const energyPct = Math.round(Math.min(MAX_SOC, Math.max(MIN_SOC, state.soc)))
  const deployMode = latestSample != null ? deriveDeployMode(latestSample, state.soc) : null
  return { energyPct, deployMode }
}
