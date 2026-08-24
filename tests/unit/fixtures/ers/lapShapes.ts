import type { ErsTelemetrySample } from '@renderer/core/engines/ErsEstimator'

/**
 * Deterministic, hand-built telemetry sequences representative of three
 * circuit archetypes, for ERS estimator calibration (APP_IMPROVEMENT_ROADMAP.md
 * P0 item 2: "Calibrate the ERS estimator against complete real sessions").
 *
 * These are synthetic — not captured DRM/video data, per the roadmap's explicit
 * constraint — built from the same throttle/speed/brake/aeroChannel shape the
 * existing `syntheticLap()` fixture in tests/unit/ers.test.ts already uses.
 */

function push(out: ErsTelemetrySample[], n: number, sample: ErsTelemetrySample): void {
  for (let i = 0; i < n; i++) out.push(sample)
}

/**
 * Full-throttle running on a long straight, in 2026's Straight Mode (channel
 * 10/12/14 — low drag). A real car opens Straight Mode specifically here, so
 * this is where `integrateErs`'s Boost-drain multiplier (`isAeroOpen && thr >
 * 85`) actually applies — an earlier version of this fixture left aeroChannel
 * closed (Corner Mode) even at 320 km/h, which meant the boosted-drain path
 * had zero coverage across a full race despite the calibration test's own
 * assertion bound assuming it could occur.
 */
const DEPLOY: ErsTelemetrySample = { throttle: 100, speed: 320, brake: 0, aeroChannel: 12 }
/** Braking/cornering: high-downforce Corner Mode (channel outside 10/12/14). */
const BRAKE: ErsTelemetrySample = { throttle: 0, speed: 140, brake: 100, aeroChannel: 0 }
const LIFT: ErsTelemetrySample = { throttle: 0, speed: 90, brake: 0, aeroChannel: 0 }
const CORNER: ErsTelemetrySample = { throttle: 55, speed: 130, brake: 0, aeroChannel: 0 }
/**
 * Below the 200 km/h deployment-zone floor: a short, low-speed acceleration
 * burst. Kept in Corner Mode — a genuinely low-speed, high-downforce circuit
 * like Monaco has little reason to open Straight Mode on such short bursts,
 * unlike the long Monza-style straight above.
 */
const SHORT_BURST: ErsTelemetrySample = { throttle: 100, speed: 180, brake: 0, aeroChannel: 0 }

/**
 * Monza-like: long straights dominate, so this leans on the deployment side of
 * the model far more than `mixedLap` — but a real 11-corner lap still carries
 * enough braking zones to recover close to the harvest ceiling each lap (the
 * energy-flow regulations are DESIGNED around that balance; see the "why this
 * model, and not a spring" note in ErsEstimator.ts). A fixture with realistic
 * deploy time but too few braking zones would drain every lap by construction,
 * regardless of estimator calibration — that was caught and fixed here rather
 * than in the estimator.
 */
export function highDeploymentLap(): ErsTelemetrySample[] {
  const lap: ErsTelemetrySample[] = []
  for (let straight = 0; straight < 6; straight++) {
    push(lap, 22, DEPLOY)
    push(lap, 6, BRAKE)
    push(lap, 5, CORNER)
  }
  return lap
}

/**
 * Monaco-like: short, low-speed acceleration bursts and frequent heavy braking
 * / lift-and-coast. Rarely reaches the 200 km/h deployment-zone floor, so this
 * stresses the harvest/taper side of the model rather than the drain side.
 */
export function lowDeploymentLap(): ErsTelemetrySample[] {
  const lap: ErsTelemetrySample[] = []
  for (let corner = 0; corner < 14; corner++) {
    push(lap, 4, SHORT_BURST)
    push(lap, 6, BRAKE)
    push(lap, 5, LIFT)
  }
  return lap
}

/** A balanced mix of straights and technical sections — the field-average profile. */
export function mixedLap(): ErsTelemetrySample[] {
  const lap: ErsTelemetrySample[] = []
  for (let corner = 0; corner < 6; corner++) {
    push(lap, 20, DEPLOY)
    push(lap, 4, BRAKE)
    push(lap, 6, CORNER)
  }
  return lap
}
