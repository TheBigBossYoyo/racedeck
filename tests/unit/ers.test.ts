import { describe, expect, it } from 'vitest'
import {
  initErsState,
  integrateErs,
  deriveDeployMode,
  applyOvertakeEligibility,
  computeErsEstimate,
  type ErsTelemetrySample
} from '../../src/renderer/core/engines/ErsEstimator'

const deploy: ErsTelemetrySample = { throttle: 100, speed: 300, brake: 0, aeroChannel: 0 }
const boost: ErsTelemetrySample = { throttle: 100, speed: 300, brake: 0, aeroChannel: 12 }
const braking: ErsTelemetrySample = { throttle: 0, speed: 120, brake: 100, aeroChannel: 0 }
const lift: ErsTelemetrySample = { throttle: 0, speed: 180, brake: 0, aeroChannel: 0 }

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

  it('mean-reverts: never rails to empty across a full race', () => {
    const lap = syntheticLap()
    let st = initErsState()
    let min = st.soc
    let max = st.soc
    for (let l = 0; l < 60; l++) {
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

  it('clamps oversized dt so a feed gap cannot spike SoC', () => {
    const a = integrateErs({ soc: 60, sampleCount: 10 }, braking, 5)
    const b = integrateErs({ soc: 60, sampleCount: 10 }, braking, 500)
    expect(b.soc).toBe(a.soc) // both clamped to the same MAX_DT step
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

  it('reports a rounded SoC and mode once warmed up', () => {
    const est = computeErsEstimate({ soc: 61.4, sampleCount: 20 }, braking)
    expect(est.energyPct).toBe(61)
    expect(est.deployMode).toBe('HARVEST')
  })
})
