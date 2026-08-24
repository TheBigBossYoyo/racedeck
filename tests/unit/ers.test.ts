import { describe, expect, it } from 'vitest'
import {
  initErsState,
  integrateErs,
  startLap,
  deriveDeployMode,
  applyOvertakeEligibility,
  computeErsEstimate,
  deriveEnergyTrend,
  explainOvertakeEligibility,
  eligibilityDurationSec,
  type ErsEstimate,
  type ErsTelemetrySample,
  type ErsTimelinePoint
} from '../../src/renderer/core/engines/ErsEstimator'
import { highDeploymentLap, lowDeploymentLap, mixedLap } from './fixtures/ers/lapShapes'

const deploy: ErsTelemetrySample = { throttle: 100, speed: 300, brake: 0, aeroChannel: 0 }
const boost: ErsTelemetrySample = { throttle: 100, speed: 300, brake: 0, aeroChannel: 12 }
const braking: ErsTelemetrySample = { throttle: 0, speed: 120, brake: 100, aeroChannel: 0 }
const lift: ErsTelemetrySample = { throttle: 0, speed: 180, brake: 0, aeroChannel: 0 }
const unusable: ErsTelemetrySample = {
  throttle: null,
  speed: null,
  brake: null,
  aeroChannel: null
}

/**
 * A representative F1 lap: mostly full-throttle high-speed running (the profile
 * that rails a naive integrator to empty) punctuated by heavy-braking corners.
 */
function syntheticLap(): ErsTelemetrySample[] {
  const s: ErsTelemetrySample[] = []
  const push = (n: number, x: ErsTelemetrySample) => {
    for (let i = 0; i < n; i++) s.push(x)
  }
  for (let corner = 0; corner < 6; corner++) {
    push(20, deploy) // straight
    push(4, braking) // braking zone
    push(6, { throttle: 60, speed: 150, brake: 0, aeroChannel: 0 }) // corner exit
  }
  return s
}

describe('integrateErs', () => {
  it('drains under deployment and harvests under braking', () => {
    const start = { soc: 60, sampleCount: 10 }
    expect(integrateErs(start, deploy, 1).soc).toBeLessThan(60)
    expect(integrateErs(start, braking, 1).soc).toBeGreaterThan(60)
  })

  it('drains harder in Boost Mode than plain deploy', () => {
    const start = { soc: 60, sampleCount: 10 }
    const plain = integrateErs(start, deploy, 1).soc
    const boosted = integrateErs(start, boost, 1).soc
    expect(boosted).toBeLessThan(plain)
  })

  it('stays in a working window across a full race, without a spring', () => {
    const lap = syntheticLap()
    let st = initErsState()
    let min = st.soc
    let max = st.soc
    for (let l = 0; l < 60; l++) {
      st = startLap(st)
      for (const s of lap) {
        st = integrateErs(st, s, 0.5)
        expect(st.soc).toBeGreaterThanOrEqual(0)
        expect(st.soc).toBeLessThanOrEqual(100)
        min = Math.min(min, st.soc)
        max = Math.max(max, st.soc)
      }
    }
    expect(max - min).toBeGreaterThan(8) // genuinely dynamic
    expect(min).toBeGreaterThan(0) // never pinned at the floor
    expect(max).toBeLessThan(100) // never pinned at the ceiling
  })

  it('stays bounded over a race even when no lap boundary is ever signalled', () => {
    // A session without NumberOfLaps data never calls startLap. The elapsed-time
    // fallback must still refill the allowances, or every car sits on the
    // reserve flow for the whole race.
    const lap = syntheticLap()
    let st = initErsState()
    let min = st.soc
    let max = st.soc
    for (let l = 0; l < 60; l++) {
      for (const s of lap) {
        st = integrateErs(st, s, 0.5)
        min = Math.min(min, st.soc)
        max = Math.max(max, st.soc)
      }
    }
    expect(min).toBeGreaterThan(0)
    expect(max).toBeLessThan(100)
  })

  it('bounds deployment by the lap allowance, and startLap restores it', () => {
    let st = initErsState()
    // Burn the whole deployment allowance on one long straight.
    for (let i = 0; i < 40; i++) st = integrateErs(st, deploy, 1)
    expect(st.deployBudget).toBe(0)

    // Spent allowance ⇒ the next deploy second costs far less than a fresh one.
    const spentDrain = st.soc - integrateErs(st, deploy, 1).soc
    const fresh = startLap(st)
    expect(fresh.deployBudget).toBeGreaterThan(0)
    const freshDrain = fresh.soc - integrateErs(fresh, deploy, 1).soc
    expect(freshDrain).toBeGreaterThan(spentDrain)
  })

  it('will not charge past the top of the working window', () => {
    let st = { soc: 90, sampleCount: 50 }
    // Sustained braking, refilling the harvest allowance every lap, must still
    // not push SoC to the physical ceiling.
    for (let l = 0; l < 30; l++) {
      st = startLap(st)
      for (let i = 0; i < 40; i++) st = integrateErs(st, braking, 1)
    }
    expect(st.soc).toBeLessThan(100)
  })

  it('survives a state that carries no allowance fields', () => {
    // An older persisted shape must not produce NaN and poison every later tick.
    const next = integrateErs({ soc: 60, sampleCount: 10 }, braking, 1)
    expect(Number.isFinite(next.soc)).toBe(true)
    expect(next.soc).toBeGreaterThan(60)
  })

  it('clamps oversized dt so a feed gap cannot spike SoC', () => {
    const a = integrateErs({ soc: 60, sampleCount: 10 }, braking, 5)
    const b = integrateErs({ soc: 60, sampleCount: 10 }, braking, 500)
    expect(b.soc).toBe(a.soc) // both clamped to the same MAX_DT step
  })

  it('does not change SoC, budgets or confidence count for unusable telemetry', () => {
    const start = initErsState()

    const next = integrateErs(start, unusable, 1)

    expect(next).toEqual(start)
  })

  it('does not count a valid frame when no time was integrated', () => {
    const start = initErsState()

    const next = integrateErs(start, deploy, 0)

    expect(next).toEqual(start)
  })
})

describe('deriveDeployMode', () => {
  it('classifies the deployment zones', () => {
    expect(deriveDeployMode(boost, 60)).toBe('BOOST')
    expect(deriveDeployMode(deploy, 60)).toBe('DEPLOY')
    expect(deriveDeployMode(braking, 60)).toBe('HARVEST')
    expect(deriveDeployMode(lift, 60)).toBe('HARVEST')
    expect(deriveDeployMode({ throttle: 50, speed: 150, brake: 0, aeroChannel: 0 }, 60)).toBe(
      'BALANCED'
    )
  })

  it('will not report BOOST on an empty battery', () => {
    expect(deriveDeployMode(boost, 5)).toBe('DEPLOY')
  })

  it('returns null when no channels are present', () => {
    expect(
      deriveDeployMode({ throttle: null, speed: null, brake: null, aeroChannel: null }, 60)
    ).toBeNull()
  })
})

describe('applyOvertakeEligibility', () => {
  it('keeps Boost distinct outside the one-second window', () => {
    expect(applyOvertakeEligibility('BOOST', 1.01)).toBe('BOOST')
    expect(applyOvertakeEligibility('BOOST', null)).toBe('BOOST')
  })

  it('reports Overtake only inside the one-second eligibility window', () => {
    expect(applyOvertakeEligibility('BOOST', 1)).toBe('OVERTAKE')
    expect(applyOvertakeEligibility('DEPLOY', 0.4)).toBe('OVERTAKE')
    expect(applyOvertakeEligibility('HARVEST', 0.4)).toBe('HARVEST')
  })
})

describe('computeErsEstimate', () => {
  it('withholds a reading until enough samples have accrued', () => {
    const est = computeErsEstimate({ soc: 60, sampleCount: 1 }, deploy)
    expect(est.energyPct).toBeNull()
    expect(est.deployMode).toBeNull()
  })

  it('cannot warm up from repeated unusable telemetry', () => {
    let state = initErsState()
    for (let index = 0; index < 10; index += 1) state = integrateErs(state, unusable, 1)

    const est = computeErsEstimate(state, unusable)

    expect(est.energyPct).toBeNull()
    expect(est.confidence).toBeNull()
    expect(est.deployMode).toBeNull()
  })

  it('reports a rounded SoC and mode once warmed up', () => {
    const est = computeErsEstimate({ soc: 61.4, sampleCount: 20 }, braking)
    expect(est.energyPct).toBe(61)
    expect(est.deployMode).toBe('HARVEST')
  })

  it('grades confidence by how far the integration has moved past its seed', () => {
    // A barely-started integrator is still reporting the seed assumption, and
    // must say so rather than presenting the number with settled authority.
    expect(computeErsEstimate({ soc: 60, sampleCount: 5 }, braking).confidence).toBe('low')
    expect(computeErsEstimate({ soc: 60, sampleCount: 40 }, braking).confidence).toBe('medium')
    expect(computeErsEstimate({ soc: 60, sampleCount: 500 }, braking).confidence).toBe('high')
    // Null exactly when there is no reading to qualify.
    expect(computeErsEstimate({ soc: 60, sampleCount: 1 }, braking).confidence).toBeNull()
  })

  it('flags a spent lap allowance so the UI can explain a flat battery', () => {
    const spent = computeErsEstimate(
      { soc: 40, sampleCount: 200, deployBudget: 0, harvestBudget: 5 },
      deploy
    )
    expect(spent.deploymentLimited).toBe(true)
    expect(spent.deployBudgetRemainingPct).toBe(0)
    // A spent allowance rules out Boost for the same reason an empty battery does.
    expect(
      computeErsEstimate({ soc: 60, sampleCount: 200, deployBudget: 0 }, boost).deployMode
    ).toBe('DEPLOY')

    const fresh = computeErsEstimate({ soc: 40, sampleCount: 200, deployBudget: 12 }, deploy)
    expect(fresh.deploymentLimited).toBe(false)
  })

  it('reports the deployment allowance remaining as a percentage of the per-lap budget', () => {
    // DEPLOY_BUDGET_PER_LAP is 15; 6/15 = 40%.
    const est = computeErsEstimate({ soc: 50, sampleCount: 50, deployBudget: 6 }, deploy)
    expect(est.deployBudgetRemainingPct).toBe(40)
    // An absent budget reads as a full one, same as `deploymentLimited`'s fallback.
    expect(computeErsEstimate({ soc: 50, sampleCount: 50 }, deploy).deployBudgetRemainingPct).toBe(
      100
    )
  })
})

describe('deriveEnergyTrend', () => {
  const point = (t: number, driverNumber: number, energyPct: number | null): ErsTimelinePoint => ({
    t,
    byDriver: {
      [driverNumber]: {
        energyPct,
        deployMode: null,
        confidence: 'high',
        deploymentLimited: false,
        deployBudgetRemainingPct: 100
      } as ErsEstimate
    }
  })

  it('reports stable with no delta when there is no history at all', () => {
    expect(deriveEnergyTrend([], 1, 100)).toEqual({ direction: 'stable', deltaPct: null })
  })

  it('reports stable with no delta when the lookback window has no earlier reading', () => {
    const points = [point(98, 1, 60)]
    expect(deriveEnergyTrend(points, 1, 100)).toEqual({ direction: 'stable', deltaPct: null })
  })

  it('reports stable with no delta for a driver absent from the timeline', () => {
    const points = [point(90, 1, 60), point(98, 1, 62)]
    expect(deriveEnergyTrend(points, 99, 100)).toEqual({ direction: 'stable', deltaPct: null })
  })

  it('classifies a real rise as charging, with the percentage-point delta', () => {
    const points = [point(90, 1, 50), point(98, 1, 60)]
    const trend = deriveEnergyTrend(points, 1, 100, 8)
    expect(trend.direction).toBe('charging')
    expect(trend.deltaPct).toBeCloseTo(10, 5)
  })

  it('classifies a real fall as draining, with the percentage-point delta', () => {
    const points = [point(90, 1, 60), point(98, 1, 48)]
    const trend = deriveEnergyTrend(points, 1, 100, 8)
    expect(trend.direction).toBe('draining')
    expect(trend.deltaPct).toBeCloseTo(-12, 5)
  })

  it('treats a small change within the deadband as stable, not noise-driven direction', () => {
    const points = [point(90, 1, 60), point(98, 1, 61)]
    const trend = deriveEnergyTrend(points, 1, 100, 8)
    expect(trend.direction).toBe('stable')
    expect(trend.deltaPct).toBeCloseTo(1, 5)
  })
})

// Calibration: APP_IMPROVEMENT_ROADMAP.md P0 item 2 — run representative
// high/low-deployment and mixed circuit profiles across a full-race lap count
// and assert the physical invariants a calibrated model must hold, not just
// the isolated single-tick behaviours covered above.
describe('ERS calibration across representative circuits', () => {
  const RACE_LAPS = 60
  const SAMPLE_DT = 0.5
  const circuits: readonly (readonly [string, () => ErsTelemetrySample[]])[] = [
    ['high-deployment (Monza-like)', highDeploymentLap],
    ['low-deployment (Monaco-like)', lowDeploymentLap],
    ['mixed', mixedLap]
  ]

  for (const [name, lapFn] of circuits) {
    it(`${name}: never rails to 0/100, budgets never go negative, no per-sample spike`, () => {
      const lap = lapFn()
      let st = initErsState()
      let maxStepDelta = 0
      for (let l = 0; l < RACE_LAPS; l++) {
        st = startLap(st)
        expect(st.harvestBudget).toBeGreaterThanOrEqual(0)
        expect(st.deployBudget).toBeGreaterThanOrEqual(0)
        for (const s of lap) {
          const prevSoc = st.soc
          st = integrateErs(st, s, SAMPLE_DT)
          maxStepDelta = Math.max(maxStepDelta, Math.abs(st.soc - prevSoc))
          expect(st.soc).toBeGreaterThan(0)
          expect(st.soc).toBeLessThan(100)
          expect(st.harvestBudget).toBeGreaterThanOrEqual(0)
          expect(st.deployBudget).toBeGreaterThanOrEqual(0)
        }
      }
      // Fastest possible per-tick flow (boosted deploy, ~2.88%/s) over one 0.5s
      // sample is well under 2 points; anything near 3 would mean a spike.
      expect(maxStepDelta).toBeLessThan(3)
    })

    it(`${name}: reported confidence never regresses across a full race`, () => {
      const lap = lapFn()
      let st = initErsState()
      const rank: Record<string, number> = { low: 0, medium: 1, high: 2 }
      let best = -1
      for (let l = 0; l < 30; l++) {
        st = startLap(st)
        for (const s of lap) {
          st = integrateErs(st, s, SAMPLE_DT)
          const confidence = computeErsEstimate(st, s).confidence
          if (confidence == null) continue
          expect(rank[confidence]).toBeGreaterThanOrEqual(best)
          best = rank[confidence]
        }
      }
      expect(best).toBe(2) // reaches 'high' well within a full race
    })
  }

  it('a mid-race feed gap does not spike SoC beyond a normal 5s integration step', () => {
    const lap = mixedLap()
    let st = initErsState()
    for (let l = 0; l < 10; l++) {
      st = startLap(st)
      for (const s of lap) st = integrateErs(st, s, SAMPLE_DT)
    }
    const beforeGap = st.soc
    // A dropped feed can hand back an enormous dt when it resumes; MAX_DT_S
    // must clamp this to an ordinary step regardless of how large it is.
    const afterHugeGap = integrateErs(st, braking, 5).soc
    const afterReportedGap = integrateErs(st, braking, 5_000).soc
    expect(afterReportedGap).toBe(afterHugeGap)
    expect(Math.abs(afterReportedGap - beforeGap)).toBeLessThan(8)
  })
})

describe('explainOvertakeEligibility', () => {
  it('reports no target when there is no car ahead', () => {
    const result = explainOvertakeEligibility('DEPLOY', null, 100)
    expect(result.eligible).toBe(false)
    expect(result.reason).toMatch(/no car ahead/i)
  })

  it('reports the gap when out of range', () => {
    const result = explainOvertakeEligibility('DEPLOY', 1.8, 100)
    expect(result.eligible).toBe(false)
    expect(result.reason).toMatch(/1\.8s/)
  })

  it('reports lapped traffic (string interval) as ineligible', () => {
    const result = explainOvertakeEligibility('DEPLOY', '+1 LAP', 100)
    expect(result.eligible).toBe(false)
  })

  it('reports eligible-but-budget-spent within range', () => {
    const result = explainOvertakeEligibility('OVERTAKE', 0.5, 0)
    expect(result.eligible).toBe(false)
    expect(result.reason).toMatch(/allowance is spent/i)
  })

  it('reports eligible with OVERTAKE mode and budget remaining', () => {
    const result = explainOvertakeEligibility('OVERTAKE', 0.5, 40)
    expect(result.eligible).toBe(true)
    expect(result.reason).toMatch(/eligible/i)
  })

  it('reports eligible gap even when the model has not switched to OVERTAKE yet', () => {
    const result = explainOvertakeEligibility('HARVEST', 0.5, 40)
    expect(result.eligible).toBe(true)
    expect(result.reason).toMatch(/not currently deploying/i)
  })
})

describe('eligibilityDurationSec', () => {
  it('returns null with no start clock', () => {
    expect(eligibilityDurationSec(undefined, 100)).toBeNull()
  })

  it('returns null after a backward scrub past the start clock', () => {
    expect(eligibilityDurationSec(90, 50)).toBeNull()
  })

  it('returns elapsed seconds during forward playback', () => {
    expect(eligibilityDurationSec(90, 97)).toBe(7)
  })

  it('returns zero exactly at the start clock', () => {
    expect(eligibilityDurationSec(90, 90)).toBe(0)
  })
})
