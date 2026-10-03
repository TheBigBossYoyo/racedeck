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
 * ── Why this model, and not a spring ──────────────────────────────────────────
 * An earlier version pulled SoC toward a fixed 60% baseline with a mean-reversion
 * term. That kept the number in a plausible band, but the attractor was invented:
 * it made SoC a function of an arbitrary constant rather than of what the car was
 * doing, so the estimate drifted toward 60% even when the driver had clearly been
 * attacking for a full lap.
 *
 * What actually bounds SoC in the 2026 rules is a *budget*, not a spring:
 *  - MGU-K recovery is capped per lap (the car cannot harvest without limit).
 *  - Deployment is capped per lap by the same energy-flow regulations.
 * So this model tracks both budgets explicitly. Once a lap's harvest allowance is
 * spent, braking stops charging the battery; once the deployment allowance is
 * spent, full-throttle running falls back to a much weaker "reserve" drain. Both
 * budgets refill when the car crosses the line (`startLap`).
 *
 * The result self-limits for the same reason the real system does — the driver
 * runs out of allowance — rather than because a constant pulled it back.
 *
 * Energy model, calibrated against the real 2026 FIA Power Unit Technical
 * Regulations (not invented rates) — see the constants section below for the
 * exact figures and sourcing:
 *  - DEPLOY zone  (throttle > 75% AND speed > 200 km/h): drains at the rate a
 *    350kW MGU-K implies against the ~4MJ Energy Store (a full-power burst
 *    empties the store in ~11.4s, matching the regulation's own "4MJ burst /
 *    ~11.5s" figure — a useful internal cross-check that the conversion is
 *    right).
 *  - Above ~340-345 km/h, deployment tapers to zero: the 2026 regs cut
 *    electrical assist entirely above that speed, so top-speed running on a
 *    long straight (Monza, Spa) is combustion-only — a genuinely new
 *    behaviour this model has no equivalent of pre-2026.
 *  - BOOST zone (Straight Mode + throttle > 85% + speed > 200): drains faster
 *    (manual-override multiplier — not independently sourced, kept as a
 *    documented estimate).
 *  - HARVEST/brake, HARVEST/lift: MGU-H is removed for 2026, so ALL recovery
 *    now comes from the MGU-K alone. Real per-lap recovery capability jumped
 *    to up to 8.5MJ (circuit-dependent, FIA-set ~5-9MJ), a ~4x increase over
 *    the pre-2026 baseline — these rates are scaled up proportionally from
 *    that ratio (see the constants section; the exact recovery POWER in kW
 *    isn't published, so this is a documented proportional estimate, not a
 *    directly-sourced rate the way the deploy drain is).
 *  - Otherwise (BALANCED): very mild trickle.
 *  - SoC is clamped [0, 100]; both budgets are clamped at 0.
 */

import type { EnergyMode } from '@shared/models'
import { nearestAtOrBefore } from '@renderer/core/normalize/series'

// ── Public types ──────────────────────────────────────────────────────────────

/** Per-driver rolling state, passed through `integrateErs` incrementally. */
export interface ErsDriverState {
  /** Current battery state-of-charge, 0–100. */
  soc: number
  /** Total number of telemetry samples integrated so far. */
  sampleCount: number
  /**
   * Remaining MGU-K harvest allowance for the current lap, in SoC percentage
   * points. Refilled by `startLap`; spending it to zero stops braking recovery.
   *
   * Optional so a caller holding an older persisted shape stays valid — an
   * absent allowance is read as a full one rather than as zero or NaN.
   */
  harvestBudget?: number
  /**
   * Remaining deployment allowance for the current lap, in SoC percentage
   * points. Refilled by `startLap`; spending it to zero drops the car onto the
   * weaker reserve drain instead of full deployment. Optional for the same
   * reason as `harvestBudget`.
   */
  deployBudget?: number
  /**
   * Seconds integrated since the allowances were last refilled.
   *
   * The lap boundary normally arrives from the timing feed via `startLap`, but
   * that feed can be absent (a session with no lap counter, a driver whose line
   * never reports, a cold live connection). Without a fallback the allowances
   * would be spent exactly once and every car would sit on the reserve drain for
   * the rest of the session, draining to zero — so this tracks elapsed time and
   * refills once it exceeds any plausible lap duration.
   */
  sinceRefillSec?: number
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

/** How much the estimate can be trusted, for honest UI presentation. */
export type ErsConfidence = 'low' | 'medium' | 'high'

/** Result from `computeErsEstimate`. Fields are null when data is insufficient. */
export interface ErsEstimate {
  energyPct: number | null
  deployMode: EnergyMode | null
  /**
   * Confidence in `energyPct`. Grows with integrated samples: a freshly seeded
   * driver is near the seed value and says so, a driver with a full lap of
   * telemetry behind them does not. Null exactly when `energyPct` is null.
   */
  confidence: ErsConfidence | null
  /**
   * True while this lap's deployment allowance is exhausted — the car is on the
   * reserve drain. Surfaced so the UI can explain a low, flat battery instead of
   * just showing a small number.
   */
  deploymentLimited: boolean
  /**
   * Percentage of this lap's deployment allowance still unspent, 0-100. Answers
   * "how much attack has this driver got left this lap" directly, rather than
   * making the UI infer it from `deploymentLimited` alone.
   */
  deployBudgetRemainingPct: number
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** Starting SoC assumption — realistic mid-stint value. */
const INITIAL_SOC = 65

/**
 * Minimum samples before we trust the estimate enough to report it.
 * Avoids garbage-in-first-tick values when only 1–2 telem frames have arrived.
 */
const MIN_SAMPLES_FOR_ESTIMATE = 4
/** Samples above which the estimate no longer materially reflects the seed. */
const SAMPLES_FOR_MEDIUM_CONFIDENCE = 25
const SAMPLES_FOR_HIGH_CONFIDENCE = 120

const MAX_SOC = 100
const MIN_SOC = 0

/**
 * Energy flow rates in %/s, where 100% SoC represents the Energy Store's
 * usable ~4MJ capacity (the regulation's own "delta State of Charge" cap per
 * lap).
 *
 * DRAIN_DEPLOY_PER_S is derived directly from the 2026 MGU-K's real 350kW
 * output against that 4MJ store: 350kW = 350 kJ/s = 8.75% of a 4000kJ store
 * per second. Cross-check: at that rate a full-power burst empties the whole
 * store in 100/8.75 ≈ 11.4s, matching the regulation's own independently-
 * reported "4MJ burst ≈ 11.5s of full ERS-K power" figure almost exactly —
 * confirms the %-of-store conversion is physically consistent, not just a
 * plausible-looking number.
 */
const DRAIN_DEPLOY_PER_S = 8.75
/** Extra factor on drain during manual Boost deployment. */
const DRAIN_BOOST_MULTIPLIER = 1.6

/**
 * Speed window (km/h) over which 2026's electrical deployment cuts out
 * entirely — real regulatory behaviour, not present pre-2026: above this
 * range the PU is running combustion-only, so DEPLOY/BOOST cannot be active
 * no matter how much budget or SoC remains. Tapers linearly across the
 * window rather than a hard cliff, since the regulation itself describes a
 * formula-based falloff, not an instant cutoff.
 */
const DEPLOY_TAPER_START_KMH = 340
const DEPLOY_CUTOFF_KMH = 345

/** Fraction of full deployment still available at `speedKmh` (1 at/below the taper start, 0 at/above the cutoff). */
function deployTaperFraction(speedKmh: number): number {
  if (speedKmh <= DEPLOY_TAPER_START_KMH) return 1
  if (speedKmh >= DEPLOY_CUTOFF_KMH) return 0
  return 1 - (speedKmh - DEPLOY_TAPER_START_KMH) / (DEPLOY_CUTOFF_KMH - DEPLOY_TAPER_START_KMH)
}

/**
 * Net flow once the lap's deployment allowance is gone.
 *
 * Deliberately ~zero. The PU still pushes energy to the wheels — the regulations
 * cap the budget, they don't cut it dead — but at that point it is passing along
 * live MGU-K recovery rather than withdrawing further stored charge. Modelling
 * this as an extra drain is what previously railed every car to empty: a
 * representative lap spends ~60 s in the deployment zone but exhausts the
 * allowance in ~12 s, so a 0.35 %/s reserve leak over the remaining ~48 s cost
 * more than the entire allowance and left the budget bounding nothing.
 */
const RESERVE_FLOW_PER_S = -0.02
/**
 * MGU-H is removed for 2026 — the MGU-K alone now does all recovery, and its
 * real per-lap capability rose to up to 8.5MJ (FIA-set, circuit-dependent,
 * ~5-9MJ) versus a pre-2026 baseline around 2MJ/lap — roughly a 4.25x
 * increase. The exact recovery POWER in kW isn't published (unlike the 350kW
 * deploy figure), so these per-tick rates are that same 4.25x scale-up
 * applied to the model's previous, pre-2026 rates — a documented proportional
 * estimate, not an independently-sourced number the way DRAIN_DEPLOY_PER_S is.
 */
const HARVEST_BRAKE_PER_S = 6.0
const HARVEST_LIFT_PER_S = 1.7
/** Very mild trickle in balanced/transitional state (near-zero). */
const BALANCED_FLOW_PER_S = -0.04

/**
 * Per-lap allowances, in SoC percentage points, where 100% = the ~4MJ Energy
 * Store.
 *
 * Real 2026 regulation figures directly inform both: MGU-K recovery is now
 * FIA-capped per circuit at ~5MJ (Monza-type, few braking zones) to ~9MJ
 * (Monaco/Hungary-type, braking-heavy) — meaningfully more than one store's
 * worth, so a driver can refill and redeploy more than once per lap at a
 * braking-heavy circuit. This app has no per-circuit energy table (unlike the
 * existing per-circuit pit-loss calibration in `PitCycleModel.ts`, a natural
 * future extension point), so HARVEST_BUDGET_PER_LAP defaults to the
 * regulation's own mid-point: ~7MJ/lap ≈ 175% of the store.
 *
 * DEPLOY_BUDGET_PER_LAP is capped just under 100 (one full store's worth) —
 * not just "below harvest" as before: the regulation's own "delta State of
 * Charge" cap is ±4MJ per lap, i.e. AT MOST one store's capacity of net
 * withdrawal without an interim recharge, which maps directly onto this
 * model's 0-100 SoC scale. A budget above 100 would be meaningless (SoC
 * cannot hold more than a full store to begin with) and — found empirically
 * via this file's own calibration tests — degenerates the model into
 * draining to the floor and sticking there, since nothing above 100 can ever
 * actually bind before SoC itself does. 90 (rather than exactly 100) keeps
 * the budget genuinely distinguishable from the SoC floor itself — a car
 * that fully exhausts its allowance from a full charge still has real charge
 * left, matching how the real regulation is a conservative operating limit,
 * not a "drain to literally zero every lap" design target.
 */
const HARVEST_BUDGET_PER_LAP = 175
const DEPLOY_BUDGET_PER_LAP = 90

/** Maximum believable dt per integration step (guards against cold-start spikes). */
const MAX_DT_S = 5

/**
 * Elapsed seconds after which the allowances refill even without a lap-boundary
 * signal from the timing feed.
 *
 * Set above the slowest realistic green-flag lap (Spa and Baku sit near 105 s;
 * a wet Monaco lap can reach ~120 s) so a real lap is always ended by `startLap`
 * first and this only fires when the boundary signal is genuinely missing. The
 * model must not depend on another feed being present to stay stable.
 */
const MAX_LAP_DURATION_S = 150

/**
 * Top of the usable working window (SoC %).
 *
 * A real energy store is not charged to its physical ceiling: the MGU-K stops
 * recovering near the top of the usable band, and charge acceptance tapers off
 * before that. That taper is what makes the model *stable* rather than merely
 * balanced — without it, SoC is a free integrator, so any residual asymmetry
 * between per-lap deployment and recovery accumulates without bound and pins the
 * estimate at 0 or 100 over a race distance. Tuning the two allowances to cancel
 * exactly would be the wrong fix: exact cancellation is not a property real cars
 * have, and it collapses the moment a driver deploys or brakes atypically.
 */
const WORKING_WINDOW_TOP = 92
/** SoC band below the window top over which charge acceptance tapers to zero. */
const CHARGE_TAPER_BAND = 8

/** Minimum SoC at which manual Boost is still available. */
const BOOST_MIN_SOC = 12

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Create a fresh per-driver state at a sensible starting SoC, with a full lap of
 * both allowances. Call this when the driver is first seen or the cursor resets.
 */
export function initErsState(): ErsDriverState {
  return {
    soc: INITIAL_SOC,
    sampleCount: 0,
    harvestBudget: HARVEST_BUDGET_PER_LAP,
    deployBudget: DEPLOY_BUDGET_PER_LAP,
    sinceRefillSec: 0
  }
}

/**
 * Refill both per-lap allowances. Call when the driver crosses the line.
 *
 * SoC and sampleCount carry over untouched — only the budgets reset, which is
 * exactly the regulatory behaviour being modelled.
 */
export function startLap(state: ErsDriverState): ErsDriverState {
  return {
    soc: state.soc,
    sampleCount: state.sampleCount,
    harvestBudget: HARVEST_BUDGET_PER_LAP,
    deployBudget: DEPLOY_BUDGET_PER_LAP,
    sinceRefillSec: 0
  }
}

/**
 * Integrate one telemetry frame into the driver's ERS state.
 *
 * @param state  The previous per-driver state (treated as immutable).
 * @param sample Channel values for this frame.
 * @param dt     Time elapsed since the previous sample, in seconds.
 * @returns      New per-driver state with updated SoC and budgets.
 */
export function integrateErs(
  state: ErsDriverState,
  sample: ErsTelemetrySample,
  dt: number
): ErsDriverState {
  const safeDt = Math.max(0, Math.min(dt, MAX_DT_S))
  // Confidence means integrated evidence, not message count. A missing channel
  // would otherwise be coerced to zero and invent a BALANCED drain/harvest
  // pattern; a zero-duration frame contains no energy-flow evidence either.
  if (safeDt === 0 || !isUsableTelemetry(sample)) return state
  const sampleCount = state.sampleCount + 1

  const thr = sample.throttle ?? 0
  const spd = sample.speed ?? 0
  const brk = sample.brake ?? 0
  const isAeroOpen = isStraightMode(sample.aeroChannel)

  // A state without budgets (an older persisted shape, or a partially built
  // object) must not poison the arithmetic: an undefined budget would make every
  // Math.min NaN and silently corrupt SoC for the rest of the session. Treat a
  // missing allowance as a full one.
  let harvestBudget = budgetOr(state.harvestBudget, HARVEST_BUDGET_PER_LAP)
  let deployBudget = budgetOr(state.deployBudget, DEPLOY_BUDGET_PER_LAP)
  // `startLap` is authoritative when the lap feed provides boundaries, but the
  // model must not depend on it: a session without NumberOfLaps data would
  // otherwise spend both allowances once and leave every car on the reserve
  // drain for the rest of the race. A lap has a bounded duration, so running
  // longer than any plausible lap without a boundary means one was missed.
  let sinceRefillSec =
    (typeof state.sinceRefillSec === 'number' && Number.isFinite(state.sinceRefillSec)
      ? Math.max(0, state.sinceRefillSec)
      : 0) + safeDt
  if (sinceRefillSec >= MAX_LAP_DURATION_S) {
    harvestBudget = HARVEST_BUDGET_PER_LAP
    deployBudget = DEPLOY_BUDGET_PER_LAP
    sinceRefillSec = 0
  }
  let flowPerS: number

  const deployTaper = deployTaperFraction(spd)
  if (thr > 75 && spd > 200 && deployTaper > 0) {
    // Deployment zone. Full deployment only while the lap's allowance holds
    // AND below the 2026 top-speed taper (electrical assist cuts out above
    // ~345 km/h); after either, the car falls back to the much weaker reserve
    // drain, or (above the taper) to a plain combustion-only trickle.
    if (deployBudget > 0) {
      const boostActive = isAeroOpen && thr > 85
      const requested =
        (boostActive ? DRAIN_DEPLOY_PER_S * DRAIN_BOOST_MULTIPLIER : DRAIN_DEPLOY_PER_S) *
        deployTaper
      // Spend no more than the allowance left, so the budget bounds the drain
      // rather than merely flagging it.
      const spend = Math.min(requested * safeDt, deployBudget)
      deployBudget = Math.max(0, deployBudget - spend)
      flowPerS = -spend / safeDt
    } else {
      // Allowance spent. The PU keeps driving the wheels electrically, but it
      // can only pass along what the MGU-K recovers in real time — it is not
      // still withdrawing from a battery whose lap allowance is gone. So this
      // is net-neutral, NOT a second drain: an unbounded reserve leak would
      // spend more over the rest of the lap than the whole allowance did,
      // making the budget bound nothing and railing every car to empty.
      flowPerS = RESERVE_FLOW_PER_S
    }
  } else if (brk > 20 && thr < 20) {
    // Braking harvest — capped by the lap's recovery allowance AND by the top of
    // the working window (see headroomFor).
    const gain = Math.min(HARVEST_BRAKE_PER_S * safeDt, harvestBudget, headroomFor(state.soc))
    harvestBudget = Math.max(0, harvestBudget - gain)
    flowPerS = gain / safeDt
  } else if (thr < 20 && spd > 50) {
    // Lift-and-coast harvest — same allowance, same window.
    const gain = Math.min(HARVEST_LIFT_PER_S * safeDt, harvestBudget, headroomFor(state.soc))
    harvestBudget = Math.max(0, harvestBudget - gain)
    flowPerS = gain / safeDt
  } else {
    flowPerS = BALANCED_FLOW_PER_S
  }

  const newSoc = Math.min(MAX_SOC, Math.max(MIN_SOC, state.soc + flowPerS * safeDt))
  return { soc: newSoc, sampleCount, harvestBudget, deployBudget, sinceRefillSec }
}

/**
 * Fraction of the requested charge the store will actually accept at `soc`.
 *
 * Full acceptance through the bulk of the range, tapering linearly to zero at
 * the top of the working window. This is what bounds the estimate from above:
 * recovery cannot keep pushing SoC up indefinitely just because a lap happened
 * to brake more than it deployed.
 */
function chargeAcceptance(soc: number): number {
  const headroom = WORKING_WINDOW_TOP - soc
  if (headroom <= 0) return 0
  if (headroom >= CHARGE_TAPER_BAND) return 1
  return headroom / CHARGE_TAPER_BAND
}

/**
 * SoC points the store can still accept at `soc`, before any per-lap allowance
 * or rate limit is applied — callers cap against those separately.
 */
function headroomFor(soc: number): number {
  return Math.max(0, WORKING_WINDOW_TOP - soc) * chargeAcceptance(soc)
}

/** A usable allowance, falling back to a full one for an absent/invalid value. */
function budgetOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : fallback
}

/** All three primary channels are required to classify energy flow honestly. */
function isUsableTelemetry(sample: ErsTelemetrySample): boolean {
  return sample.throttle != null && sample.speed != null && sample.brake != null
}

/** Channel-45 values that mean the active-aero element is open (Straight Mode). */
function isStraightMode(aeroChannel: number | null): boolean {
  return aeroChannel === 10 || aeroChannel === 12 || aeroChannel === 14
}

/**
 * Infer the current deployment mode from the latest telemetry frame and SoC.
 * Returns null only when the sample has no usable data (all channels null).
 */
export function deriveDeployMode(
  sample: ErsTelemetrySample,
  soc: number,
  deployBudget = DEPLOY_BUDGET_PER_LAP
): EnergyMode | null {
  const thr = sample.throttle
  const spd = sample.speed
  const brk = sample.brake

  if (!isUsableTelemetry(sample)) return null

  const thrV = thr ?? 0
  const spdV = spd ?? 0
  const brkV = brk ?? 0
  const isAeroOpen = isStraightMode(sample.aeroChannel)

  // Above ~345 km/h, 2026's electrical deployment has cut out entirely — the
  // PU is combustion-only, so neither Boost nor Deploy can be genuinely active
  // no matter what the throttle/speed/budget inputs otherwise suggest. Falls
  // through to the HARVEST/BALANCED checks below unaffected (lifting or
  // braking at top speed is still real harvesting).
  const deployAvailable = deployTaperFraction(spdV) > 0
  // BOOST = driver-controlled high-power deployment. Overtake eligibility needs
  // timing data and is therefore applied by F1LiveProvider, not guessed here.
  // A spent lap allowance rules Boost out just as an empty battery does.
  if (
    deployAvailable &&
    isAeroOpen &&
    thrV > 85 &&
    spdV > 200 &&
    soc > BOOST_MIN_SOC &&
    deployBudget > 0
  ) {
    return 'BOOST'
  }
  // DEPLOY: high throttle, high speed.
  if (deployAvailable && thrV > 75 && spdV > 200) {
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
  const eligible = typeof intervalAhead === 'number' && intervalAhead > 0 && intervalAhead <= 1
  return eligible && (mode === 'BOOST' || mode === 'DEPLOY') ? 'OVERTAKE' : mode
}

// ── Overtake eligibility explanation (APP_IMPROVEMENT_ROADMAP.md P2 item 25) ──

const OVERTAKE_MAX_GAP_SEC = 1

/**
 * Why Overtake Mode is or isn't available right now. Never implies the
 * driver's button press is observed — only the timing-interval eligibility
 * and the modelled deployment allowance, exactly what `applyOvertakeEligibility`
 * itself is allowed to know.
 */
export function explainOvertakeEligibility(
  mode: EnergyMode | null,
  intervalAhead: number | '+1 LAP' | null,
  deployBudgetRemainingPct: number | null
): { eligible: boolean; reason: string } {
  if (typeof intervalAhead !== 'number') {
    return { eligible: false, reason: 'No car ahead on the road to target.' }
  }
  if (intervalAhead <= 0 || intervalAhead > OVERTAKE_MAX_GAP_SEC) {
    return {
      eligible: false,
      reason: `${intervalAhead.toFixed(1)}s behind car ahead — need ≤${OVERTAKE_MAX_GAP_SEC.toFixed(1)}s.`
    }
  }
  if (deployBudgetRemainingPct != null && deployBudgetRemainingPct <= 0) {
    return {
      eligible: false,
      reason: 'Within range, but this lap’s deployment allowance is spent.'
    }
  }
  if (mode === 'OVERTAKE') {
    return { eligible: true, reason: `Eligible — ${intervalAhead.toFixed(1)}s behind car ahead.` }
  }
  return {
    eligible: true,
    reason: `Gap eligible (${intervalAhead.toFixed(1)}s) — not currently deploying.`
  }
}

/**
 * How long a driver's Overtake eligibility has held, from the clock it most
 * recently began.
 *
 * Deliberately NOT a replayable timeline like `ersPoints`: `intervalAhead` at
 * past moments isn't retained anywhere in this app (it comes from the timing
 * feed's live/on-demand snapshot, not a precomputed forward sweep like CarData
 * is), so a scrub-anywhere-accurate duration isn't honestly reconstructable.
 * The caller (`F1LiveProvider.attachErs`) tracks only "the clock eligibility
 * last started" per driver, which is accurate during forward playback — the
 * normal way a session is watched — and simply returns null rather than a
 * fabricated number after a backward scrub past that marker.
 */
export function eligibilityDurationSec(
  eligibleSinceClock: number | undefined,
  clock: number
): number | null {
  if (eligibleSinceClock == null || clock < eligibleSinceClock) return null
  return clock - eligibleSinceClock
}

/** How far the integration has moved past its seed value. */
function confidenceFor(sampleCount: number): ErsConfidence {
  if (sampleCount >= SAMPLES_FOR_HIGH_CONFIDENCE) return 'high'
  if (sampleCount >= SAMPLES_FOR_MEDIUM_CONFIDENCE) return 'medium'
  return 'low'
}

/**
 * Compute the ERS estimate for display from the current driver state.
 *
 * Returns all-null when the estimator has not seen enough data to produce a
 * trustworthy reading — the UI must show nothing (not zeros) in that case.
 *
 * @param state        Current per-driver ERS state (from `integrateErs`).
 * @param latestSample The most recent telemetry frame for mode inference.
 */
export function computeErsEstimate(
  state: ErsDriverState,
  latestSample: ErsTelemetrySample | null
): ErsEstimate {
  if (state.sampleCount < MIN_SAMPLES_FOR_ESTIMATE) {
    return {
      energyPct: null,
      deployMode: null,
      confidence: null,
      deploymentLimited: false,
      deployBudgetRemainingPct: 100
    }
  }
  const energyPct = Math.round(Math.min(MAX_SOC, Math.max(MIN_SOC, state.soc)))
  // An absent allowance reads as a full one, exactly as `integrateErs` treats it:
  // an older persisted shape must not be reported as deployment-limited.
  const deployBudget = budgetOr(state.deployBudget, DEPLOY_BUDGET_PER_LAP)
  const deployMode =
    latestSample != null ? deriveDeployMode(latestSample, state.soc, deployBudget) : null
  return {
    energyPct,
    deployMode,
    confidence: confidenceFor(state.sampleCount),
    deploymentLimited: deployBudget <= 0,
    deployBudgetRemainingPct: Math.round(
      Math.min(100, Math.max(0, (deployBudget / DEPLOY_BUDGET_PER_LAP) * 100))
    )
  }
}

// ── Energy trend (charging / stable / draining) ─────────────────────────────
//
// `F1LiveProvider` already retains a decimated ERS lookup timeline (one entry
// per ~1.5s across every driver); this derives direction and recent change from
// it by comparing the estimate at `clock` against the nearest one from
// `windowSec` earlier. Kept here (not in the provider) so it stays a pure,
// independently-testable function over plain data.

/** One decimated point on the ERS lookup timeline (`F1LiveProvider.ersPoints`). */
export interface ErsTimelinePoint {
  t: number
  byDriver: Record<number, ErsEstimate>
}

export type EnergyTrendDirection = 'charging' | 'stable' | 'draining'

export interface EnergyTrend {
  direction: EnergyTrendDirection
  /** Percentage-point change over the lookback window; null without enough history. */
  deltaPct: number | null
}

/** Below this magnitude a change reads as normal per-tick noise, not a real trend. */
const TREND_DEADBAND_PCT = 1.5
/** Default lookback window for direction/delta. */
const DEFAULT_TREND_WINDOW_SEC = 8

const STABLE_NO_HISTORY: EnergyTrend = { direction: 'stable', deltaPct: null }

/**
 * Direction + recent percentage-point change for one driver's battery.
 *
 * Returns `{direction: 'stable', deltaPct: null}` whenever there isn't a usable
 * reading at `clock` or `windowSec` earlier (session start, a driver only just
 * seen) — never a confident-looking direction from too little evidence.
 */
export function deriveEnergyTrend(
  points: ErsTimelinePoint[],
  driverNumber: number,
  clock: number,
  windowSec: number = DEFAULT_TREND_WINDOW_SEC
): EnergyTrend {
  const latest = nearestAtOrBefore(points, clock, (p) => p.t)
  const latestPct = latest?.byDriver[driverNumber]?.energyPct
  if (latest == null || latestPct == null) return STABLE_NO_HISTORY

  const earliest = nearestAtOrBefore(points, clock - windowSec, (p) => p.t)
  const earliestPct = earliest?.byDriver[driverNumber]?.energyPct
  if (earliest == null || earliestPct == null) return STABLE_NO_HISTORY

  const deltaPct = latestPct - earliestPct
  const direction: EnergyTrendDirection =
    deltaPct > TREND_DEADBAND_PCT
      ? 'charging'
      : deltaPct < -TREND_DEADBAND_PCT
        ? 'draining'
        : 'stable'
  return { direction, deltaPct }
}
