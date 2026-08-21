import { describe, it, expect } from 'vitest'
import { estimateFuelCoefficient, fuelCorrect, type FuelCoefficient } from '@renderer/core/engines/FuelModel'
import type { RaceSnapshot } from '@renderer/core/providers/types'
import type { LapSample, Stint } from '@shared/models'

function lap(driverNumber: number, lapNumber: number, lapTime: number): LapSample {
  return {
    driverNumber, lapNumber, lapTime,
    sector1: null, sector2: null, sector3: null,
    speedI1: null, speedI2: null, speedST: null,
    isPitOutLap: false, isPitInLap: false, compound: 'MEDIUM', dateStart: null
  }
}

function stint(driverNumber: number, stintNumber: number, lapStart: number, lapEnd: number): Stint {
  return {
    driverNumber, stintNumber, lapStart, lapEnd,
    tyre: { compound: 'MEDIUM', ageAtStart: 0, isNew: true },
    degradationPerLap: null
  }
}

function raceSnapshot(over: Partial<RaceSnapshot>): RaceSnapshot {
  return {
    session: { type: 'race' },
    totalLaps: 50,
    currentLap: 50,
    laps: [],
    stints: [],
    drivers: [],
    ...over
  } as unknown as RaceSnapshot
}

/**
 * Build a race where each driver runs three short fresh-tyre stints at very
 * different fuel loads. `fuel` is the true seconds-per-lap-of-fuel and `deg` the
 * true per-lap tyre wear; a correct fit recovers `fuel`, not fuel±deg.
 */
function syntheticRace(fuel: number, deg: number): RaceSnapshot {
  const totalLaps = 50
  const laps: LapSample[] = []
  const stints: Stint[] = []
  const stintStarts = [1, 18, 35]
  for (const driver of [1, 2, 3, 4]) {
    const base = 88 + driver * 0.1 // each driver a different absolute pace level
    stintStarts.forEach((start, index) => {
      stints.push(stint(driver, index + 1, start, start + 5))
      for (let age = 0; age < 6; age++) {
        const lapNumber = start + age
        const time = base + fuel * (totalLaps - lapNumber) + deg * age
        laps.push(lap(driver, lapNumber, time))
      }
    })
  }
  return raceSnapshot({ totalLaps, currentLap: totalLaps, laps, stints })
}

describe('estimateFuelCoefficient', () => {
  it('recovers a known fuel coefficient from the field data', () => {
    const coeff = estimateFuelCoefficient(syntheticRace(0.04, 0))
    expect(coeff.confidence).toBe('measured')
    expect(coeff.totalLaps).toBe(50)
    expect(coeff.sPerLap).toBeCloseTo(0.04, 2)
  })

  it('separates fuel from tyre degradation in the fit', () => {
    // True fuel 0.04, true deg 0.02 — the coefficient must track fuel, not
    // fuel+deg (0.06) nor fuel−deg (0.02).
    const coeff = estimateFuelCoefficient(syntheticRace(0.04, 0.02))
    expect(coeff.confidence).toBe('measured')
    expect(coeff.sPerLap).toBeGreaterThan(0.03)
    expect(coeff.sPerLap).toBeLessThan(0.05)
  })

  it('falls back to the physical default when data is too sparse', () => {
    const thin = raceSnapshot({
      laps: [lap(1, 2, 90), lap(1, 3, 90.1)],
      stints: [stint(1, 1, 1, 10)]
    })
    const coeff = estimateFuelCoefficient(thin)
    expect(coeff.confidence).toBe('estimated')
    expect(coeff.sPerLap).toBeCloseTo(0.055, 3)
    expect(coeff.totalLaps).toBe(50)
  })

  it('rejects an implausible fitted coefficient for the default', () => {
    // A wild 0.5 s/lap "fuel" slope is outside the physical band → default.
    const coeff = estimateFuelCoefficient(syntheticRace(0.5, 0))
    expect(coeff.confidence).toBe('estimated')
    expect(coeff.sPerLap).toBeCloseTo(0.055, 3)
  })

  it('is a no-op outside race/sprint sessions', () => {
    const quali = {
      session: { type: 'qualifying' }, totalLaps: null, currentLap: null,
      laps: [lap(1, 1, 78), lap(1, 2, 78.1)], stints: [stint(1, 1, 1, 3)], drivers: []
    } as unknown as RaceSnapshot
    const coeff = estimateFuelCoefficient(quali)
    expect(coeff.totalLaps).toBeNull()
    // A null-distance coefficient leaves lap times untouched.
    expect(fuelCorrect(78, 1, coeff)).toBe(78)
  })

  it('is a no-op when the race distance is unknown', () => {
    const coeff = estimateFuelCoefficient(raceSnapshot({ totalLaps: null }))
    expect(coeff.totalLaps).toBeNull()
    expect(fuelCorrect(90, 5, coeff)).toBe(90)
  })
})

describe('fuelCorrect', () => {
  const coeff: FuelCoefficient = { sPerLap: 0.05, confidence: 'measured', totalLaps: 50 }

  it('normalises earlier (heavier) laps down toward the end-of-race reference', () => {
    // Lap 10 carries 40 laps of fuel → 40 × 0.05 = 2.0s removed.
    expect(fuelCorrect(90, 10, coeff)).toBeCloseTo(88, 6)
    // The final lap (empty) is unchanged.
    expect(fuelCorrect(90, 50, coeff)).toBeCloseTo(90, 6)
  })

  it('unmasks degradation that fuel burn was hiding', () => {
    // A stint whose RAW lap times are flat: +0.05/lap tyre wear exactly cancels
    // −0.05/lap fuel gain. After correction the wear must reveal itself.
    const corrected = [10, 11, 12, 13, 14, 15].map((n) => fuelCorrect(90, n, coeff))
    for (let i = 1; i < corrected.length; i++) {
      expect(corrected[i]).toBeGreaterThan(corrected[i - 1])
    }
  })
})
