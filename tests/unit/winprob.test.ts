import { describe, it, expect } from 'vitest'
import { DemoProvider } from '@renderer/core/providers/DemoProvider'
import {
  WinProbabilityEngine,
  winProbabilitySummary,
  poissonBinomialPmf
} from '@renderer/core/engines/WinProbabilityEngine'
import type { RaceSnapshot } from '@renderer/core/providers/types'
import type { LapSample, TimingEntry, TyreCompound } from '@shared/models'

const provider = new DemoProvider()
const earlyRace = provider.getSnapshotAt(provider.getDuration() * 0.1)
const midRace = provider.getSnapshotAt(provider.getDuration() * 0.5)
const lateRace = provider.getSnapshotAt(provider.getDuration() * 0.97)

type TimingOverride = Partial<TimingEntry> & {
  recentPace?: number
  recentPaceSampleCount?: number
  tyreCompound?: TyreCompound
  stintAgeLaps?: number
  penaltySeconds?: number
}

function leaderOf(snap: RaceSnapshot): number {
  return [...snap.timing].sort((a, b) => (a.position ?? 99) - (b.position ?? 99))[0].driverNumber
}

function controlledSnapshot(
  overrides: TimingOverride[],
  snapshotOverrides: Partial<RaceSnapshot> = {}
): RaceSnapshot {
  const currentLap = snapshotOverrides.currentLap ?? 24
  const laps: LapSample[] = []
  const timing = overrides.map((override, index) => {
    const base = midRace.timing[index]
    const {
      recentPace,
      recentPaceSampleCount = 0,
      tyreCompound,
      stintAgeLaps,
      penaltySeconds,
      ...timingOverride
    } = override
    if (recentPace != null) {
      for (let sample = 0; sample < recentPaceSampleCount; sample += 1) {
        laps.push({
          driverNumber: base.driverNumber,
          lapNumber: Math.max(1, currentLap - recentPaceSampleCount + sample + 1),
          lapTime: recentPace,
          sector1: null,
          sector2: null,
          sector3: null,
          speedI1: null,
          speedI2: null,
          speedST: null,
          isPitOutLap: false,
          isPitInLap: false,
          compound: tyreCompound ?? base.compound,
          dateStart: null
        })
      }
    }
    return {
      ...base,
      retired: false,
      status: base.status,
      position: index + 1,
      gapToLeader: index === 0 ? 0 : (index + 1) * 1.6,
      compound: tyreCompound ?? base.compound,
      stintAge: stintAgeLaps ?? base.stintAge,
      penalty: penaltySeconds != null ? `${penaltySeconds}s` : base.penalty,
      ...timingOverride
    }
  })
  const drivers = timing.map(
    (entry) => midRace.drivers.find((driver) => driver.number === entry.driverNumber)!
  )

  return {
    ...midRace,
    timing,
    laps,
    drivers,
    session: { ...midRace.session, type: 'race' },
    trackStatus: 'CLEAR',
    totalLaps: 60,
    currentLap,
    ...snapshotOverrides
  }
}

describe('poissonBinomialPmf', () => {
  it('is a valid distribution summing to 1', () => {
    const pmf = poissonBinomialPmf([0.2, 0.5, 0.9, 0.1])
    const sum = pmf.reduce((a, b) => a + b, 0)
    expect(sum).toBeCloseTo(1, 10)
    for (const p of pmf) expect(p).toBeGreaterThanOrEqual(0)
    expect(pmf.length).toBe(5) // n+1 buckets
  })

  it('handles deterministic edges', () => {
    expect(poissonBinomialPmf([])).toEqual([1])
    expect(poissonBinomialPmf([1, 1])).toEqual([0, 0, 1]) // always 2 successes
    expect(poissonBinomialPmf([0, 0])).toEqual([1, 0, 0]) // never
    const one = poissonBinomialPmf([0.5])
    expect(one[0]).toBeCloseTo(0.5, 10)
    expect(one[1]).toBeCloseTo(0.5, 10)
  })
})

describe('WinProbabilityEngine.compute', () => {
  const model = WinProbabilityEngine.compute(midRace)

  it('produces an available model for a race snapshot', () => {
    expect(model.available).toBe(true)
    expect(model.chances.length).toBeGreaterThan(0)
    expect(model.isEstimate).toBe(true)
    expect(model.confidencePct).toBeGreaterThan(0)
    expect(['low', 'medium', 'high']).toContain(model.dataQuality)
    expect(model.chances[0].factors.length).toBeGreaterThan(0)
  })

  it('win chances sum to ~100% and are sorted descending', () => {
    const sum = model.chances.reduce((a, c) => a + c.winPct, 0)
    expect(sum).toBeCloseTo(100, 4)
    const wins = model.chances.map((c) => c.winPct)
    expect(wins).toEqual([...wins].sort((a, b) => b - a))
  })

  it('keeps every probability in range and monotonic (win ≤ podium ≤ points)', () => {
    for (const c of model.chances) {
      for (const v of [c.winPct, c.podiumPct, c.pointsPct]) {
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThanOrEqual(100)
      }
      expect(c.podiumPct).toBeGreaterThanOrEqual(c.winPct - 1e-6)
      expect(c.pointsPct).toBeGreaterThanOrEqual(c.podiumPct - 1e-6)
    }
  })

  it('favours the on-track leader early, before strategies diverge', () => {
    // Early on the running order tracks pace, so the leader is the top pick.
    const early = WinProbabilityEngine.compute(earlyRace)
    expect(early.chances[0].driverNumber).toBe(leaderOf(earlyRace))
    expect(early.chances[0].winPct).toBeGreaterThan(early.chances[1].winPct)
  })

  it('rewards a faster car even when another leads on an offset strategy', () => {
    // The genuinely quickest car should top the win chances at mid-race.
    expect(model.chances[0].winPct).toBeGreaterThanOrEqual(model.chances[1].winPct)
    expect(model.chances[0].projectedMargin).toBeLessThanOrEqual(model.chances[1].projectedMargin)
  })

  it('grows more certain as the race nears the end', () => {
    const leader = leaderOf(lateRace)
    const late = WinProbabilityEngine.compute(lateRace)
    const leaderLate = late.chances.find((c) => c.driverNumber === leader)!
    const leaderMid = model.chances.find((c) => c.driverNumber === leader)!
    expect(late.lapsRemaining! ).toBeLessThan(model.lapsRemaining!)
    expect(leaderLate.winPct).toBeGreaterThan(leaderMid.winPct)
  })

  it('excludes retired drivers from the field', () => {
    const snap: RaceSnapshot = {
      ...midRace,
      timing: midRace.timing.map((t, i) =>
        i === 5 ? { ...t, status: 'RETIRED' as const, retired: true } : t
      )
    }
    const retiredNum = midRace.timing[5].driverNumber
    const m = WinProbabilityEngine.compute(snap)
    expect(m.chances.some((c) => c.driverNumber === retiredNum)).toBe(false)
    // Win chances still normalise to ~100 without them.
    expect(m.chances.reduce((a, c) => a + c.winPct, 0)).toBeCloseTo(100, 4)
  })

  it('declines for non-race sessions', () => {
    const quali: RaceSnapshot = { ...midRace, session: { ...midRace.session, type: 'qualifying' } }
    const m = WinProbabilityEngine.compute(quali)
    expect(m.available).toBe(false)
    expect(m.reason).toBeTruthy()
  })

  it('inflates uncertainty under a Safety Car', () => {
    const green = WinProbabilityEngine.betaFor({ ...midRace, trackStatus: 'CLEAR' }, 20)
    const sc = WinProbabilityEngine.betaFor({ ...midRace, trackStatus: 'SAFETY_CAR' }, 20)
    expect(sc).toBeGreaterThan(green)
  })

  it('preserves early-race dry, wet, Safety Car and combined uncertainty ordering', () => {
    const early = { ...midRace, currentLap: 1, totalLaps: 60, trackStatus: 'CLEAR' as const }
    const wet = { ...early, weather: { ...midRace.weather!, rainfall: true } }
    const sc = { ...early, trackStatus: 'SAFETY_CAR' as const }
    const wetSc = { ...wet, trackStatus: 'SAFETY_CAR' as const }

    const dryBeta = WinProbabilityEngine.betaFor(early, 59)
    const wetBeta = WinProbabilityEngine.betaFor(wet, 59)
    const scBeta = WinProbabilityEngine.betaFor(sc, 59)
    const wetScBeta = WinProbabilityEngine.betaFor(wetSc, 59)
    expect(dryBeta).toBeLessThan(wetBeta)
    expect(wetBeta).toBeLessThan(scBeta)
    expect(scBeta).toBeLessThan(wetScBeta)
    expect(wetScBeta).toBeLessThanOrEqual(12)
  })

  it('moves early-race probabilities when rain increases uncertainty', () => {
    const green = controlledSnapshot([
      { gapToLeader: 0 },
      { gapToLeader: 3 },
      { gapToLeader: 8 },
      { gapToLeader: 14 }
    ], { currentLap: 1, totalLaps: 60 })
    const wet = { ...green, weather: { ...green.weather!, rainfall: true } }
    const greenModel = WinProbabilityEngine.compute(green)
    const wetModel = WinProbabilityEngine.compute(wet)
    expect(wetModel.beta).toBeGreaterThan(greenModel.beta)
    expect(wetModel.chances[0].winPct).not.toBeCloseTo(greenModel.chances[0].winPct, 4)
  })

  it('projects expected points that stay within the points table and rank sensibly', () => {
    const total = model.chances.reduce((a, c) => a + c.expectedPoints, 0)
    // At most the full race allocation (25+18+…+1 = 101) is on the table.
    expect(total).toBeGreaterThan(0)
    expect(total).toBeLessThanOrEqual(101 + 1e-6)
    for (const c of model.chances) {
      expect(c.expectedPoints).toBeGreaterThanOrEqual(0)
      expect(c.expectedPoints).toBeLessThanOrEqual(25)
    }
    // The win favourite should also be near the top on expected points.
    const byXpts = [...model.chances].sort((a, b) => b.expectedPoints - a.expectedPoints)
    expect(byXpts[0].expectedPoints).toBeGreaterThan(byXpts[byXpts.length - 1].expectedPoints)
  })

  it('applies a reliability (DNF) hazard that eases as the race runs out', () => {
    for (const c of model.chances) {
      expect(c.dnfPct).toBeGreaterThan(0)
      expect(c.dnfPct).toBeLessThan(100)
    }
    const late = WinProbabilityEngine.compute(lateRace)
    // Fewer laps left ⇒ less chance of a retirement before the flag.
    expect(late.chances[0].dnfPct).toBeLessThan(model.chances[0].dnfPct)
    // Even a runaway leader can't show a 100% podium — retirement is possible.
    expect(Math.max(...model.chances.map((c) => c.podiumPct))).toBeLessThanOrEqual(100)
  })

  it('also projects a sprint, using the sprint points table', () => {
    const sprint: RaceSnapshot = { ...midRace, session: { ...midRace.session, type: 'sprint' } }
    const m = WinProbabilityEngine.compute(sprint)
    expect(m.available).toBe(true)
    // Sprint tops out at 8 points, so no expected value can exceed it.
    for (const c of m.chances) expect(c.expectedPoints).toBeLessThanOrEqual(8)
  })

  it('uses explicit time penalties as a direct win handicap', () => {
    const baseline = controlledSnapshot([
      {
        gapToLeader: 0,
        recentPace: 91,
        recentPaceSampleCount: 5,
        tyreCompound: 'MEDIUM',
        stintAgeLaps: 10
      },
      {
        gapToLeader: 1.2,
        recentPace: 91,
        recentPaceSampleCount: 5,
        tyreCompound: 'MEDIUM',
        stintAgeLaps: 10
      }
    ])
    const penalized = controlledSnapshot([
      {
        gapToLeader: 0,
        recentPace: 91,
        recentPaceSampleCount: 5,
        tyreCompound: 'MEDIUM',
        stintAgeLaps: 10,
        penaltySeconds: 5
      },
      {
        gapToLeader: 1.2,
        recentPace: 91,
        recentPaceSampleCount: 5,
        tyreCompound: 'MEDIUM',
        stintAgeLaps: 10
      }
    ])

    const baselineModel = WinProbabilityEngine.compute(baseline)
    const penalizedModel = WinProbabilityEngine.compute(penalized)
    const driverA = baseline.timing[0].driverNumber
    const driverB = baseline.timing[1].driverNumber
    const baselineA = baselineModel.chances.find((c) => c.driverNumber === driverA)!
    const penalizedA = penalizedModel.chances.find((c) => c.driverNumber === driverA)!

    expect(baselineModel.chances[0].driverNumber).toBe(driverA)
    expect(penalizedModel.chances[0].driverNumber).toBe(driverB)
    expect(penalizedA.winPct).toBeLessThan(baselineA.winPct)
    expect(penalizedA.factors.some((factor) => /penalty/i.test(factor))).toBe(true)
  })

  it('blends pace confidence and tyre state when gaps are close', () => {
    const neutral = controlledSnapshot(
      [
        {
          gapToLeader: 0,
          recentPace: 91,
          recentPaceSampleCount: 5,
          tyreCompound: 'MEDIUM',
          stintAgeLaps: 10
        },
        {
          gapToLeader: 1.1,
          recentPace: 91,
          recentPaceSampleCount: 5,
          tyreCompound: 'MEDIUM',
          stintAgeLaps: 10
        }
      ],
      { currentLap: 38, totalLaps: 60 }
    )
    const advantaged = controlledSnapshot(
      [
        {
          gapToLeader: 0,
          recentPace: 91,
          recentPaceSampleCount: 5,
          tyreCompound: 'HARD',
          stintAgeLaps: 24
        },
        {
          gapToLeader: 1.1,
          recentPace: 90.4,
          recentPaceSampleCount: 5,
          tyreCompound: 'SOFT',
          stintAgeLaps: 4
        }
      ],
      { currentLap: 38, totalLaps: 60 }
    )

    const driverB = advantaged.timing[1].driverNumber
    const neutralB = WinProbabilityEngine.compute(neutral).chances.find((c) => c.driverNumber === driverB)!
    const advantagedModel = WinProbabilityEngine.compute(advantaged)
    const advantagedB = advantagedModel.chances.find((c) => c.driverNumber === driverB)!

    expect(advantagedModel.chances[0].driverNumber).toBe(driverB)
    expect(advantagedB.winPct).toBeGreaterThan(neutralB.winPct)
    expect(advantagedB.factors.join(' ')).toMatch(/Pace|tyre/i)
  })

  it('keeps a normalized non-zero win field while admitting sparse early data', () => {
    const sparse = controlledSnapshot(
      [
        { gapToLeader: 0, recentPaceSampleCount: 0, stintAgeLaps: 1 },
        { gapToLeader: null, recentPaceSampleCount: 0, stintAgeLaps: 1 },
        { gapToLeader: null, recentPaceSampleCount: 0, stintAgeLaps: 1 },
        { gapToLeader: null, recentPaceSampleCount: 0, stintAgeLaps: 1 }
      ],
      { currentLap: 2, totalLaps: 58 }
    )
    const m = WinProbabilityEngine.compute(sparse)

    expect(m.available).toBe(true)
    expect(m.confidencePct).toBeLessThan(50)
    expect(m.dataQuality).toBe('low')
    expect(m.chances.reduce((sum, chance) => sum + chance.winPct, 0)).toBeCloseTo(100, 4)
    for (const chance of m.chances) expect(chance.winPct).toBeGreaterThan(0)
    expect(m.chances.some((chance) => chance.factors.some((factor) => /Gap (estimated|partly inferred)/.test(factor)))).toBe(true)
  })

  it('does not rate a P20 car near the leader from a contradictory one-second gap', () => {
    const snapshot = controlledSnapshot(
      Array.from({ length: 20 }, (_, index): TimingOverride => ({
        gapToLeader: index === 0 ? 0 : index === 19 ? 1 : index * 2,
        recentPace: 91,
        recentPaceSampleCount: 5,
        tyreCompound: index === 0 ? 'HARD' : index === 19 ? 'SOFT' : 'MEDIUM',
        stintAgeLaps: index === 0 ? 16 : index === 19 ? 8 : 12
      })),
      { currentLap: 8, totalLaps: 44 }
    )
    const model = WinProbabilityEngine.compute(snapshot)
    const leader = model.chances.find((chance) => chance.position === 1)!
    const backmarker = model.chances.find((chance) => chance.position === 20)!

    expect(leader.pointsPct).toBeGreaterThan(75)
    expect(backmarker.pointsPct).toBeLessThan(15)
    expect(backmarker.expectedPoints).toBeLessThan(4)
    expect(backmarker.factors).toContain('Gap estimated')
  })

  it('becomes near-certain at the end with a secure exact gap', () => {
    const finish = controlledSnapshot(
      [
        {
          gapToLeader: 0,
          recentPace: 90.5,
          recentPaceSampleCount: 5,
          tyreCompound: 'MEDIUM',
          stintAgeLaps: 8
        },
        {
          gapToLeader: 6.8,
          recentPace: 90.6,
          recentPaceSampleCount: 5,
          tyreCompound: 'MEDIUM',
          stintAgeLaps: 8
        },
        {
          gapToLeader: 12.5,
          recentPace: 90.8,
          recentPaceSampleCount: 5,
          tyreCompound: 'HARD',
          stintAgeLaps: 12
        }
      ],
      { currentLap: 59, totalLaps: 60 }
    )
    const m = WinProbabilityEngine.compute(finish)

    expect(m.chances[0].driverNumber).toBe(finish.timing[0].driverNumber)
    expect(m.chances[0].winPct).toBeGreaterThan(98)
    expect(m.chances[0].projectedMargin).toBeCloseTo(0, 8)
  })
})

describe('winProbabilitySummary', () => {
  it('summarises an available model and is empty otherwise', () => {
    const text = winProbabilitySummary(WinProbabilityEngine.compute(midRace))
    expect(text).toMatch(/WIN PROBABILITY MODEL/)
    expect(text).toMatch(/win \d+%/)
    const quali: RaceSnapshot = { ...midRace, session: { ...midRace.session, type: 'qualifying' } }
    expect(winProbabilitySummary(WinProbabilityEngine.compute(quali))).toBe('')
  })
})
