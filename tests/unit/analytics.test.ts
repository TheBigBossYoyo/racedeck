import { describe, it, expect } from 'vitest'
import { DemoProvider } from '@renderer/core/providers/DemoProvider'
import {
  teamPace,
  compoundPerformance,
  bestTyrePerTeam,
  analyticsSummary
} from '@renderer/core/engines/AnalyticsEngine'

const provider = new DemoProvider()
// ~72% through the race: everyone has run multiple compounds and many clean laps.
const snapshot = provider.getSnapshotAt(provider.getDuration() * 0.72)

describe('teamPace', () => {
  const rows = teamPace(snapshot)

  it('ranks teams by their fastest car, best first', () => {
    expect(rows.length).toBeGreaterThan(3)
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].pace).toBeGreaterThanOrEqual(rows[i - 1].pace)
    }
    expect(rows[0].deltaToBest).toBe(0)
    expect(rows.every((r) => r.deltaToBest >= 0)).toBe(true)
  })

  it('lists each team drivers with the quicker car first', () => {
    for (const r of rows) {
      expect(r.drivers.length).toBeGreaterThan(0)
      const paces = r.drivers.map((d) => d.pace ?? Infinity)
      expect(paces).toEqual([...paces].sort((a, b) => a - b))
    }
  })
})

describe('compoundPerformance', () => {
  const rows = compoundPerformance(snapshot)

  it('reports pace per compound, fastest first', () => {
    expect(rows.length).toBeGreaterThan(0)
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].pace ?? Infinity).toBeGreaterThanOrEqual(rows[i - 1].pace ?? -Infinity)
    }
    expect(rows[0].deltaToBest).toBeCloseTo(0, 5)
    expect(rows.every((r) => r.laps > 0)).toBe(true)
  })

  it('only counts real compounds that were actually run', () => {
    const compounds = rows.map((r) => r.compound)
    expect(compounds).toContain('MEDIUM') // several demo drivers start on mediums
    expect(new Set(compounds).size).toBe(compounds.length) // no duplicates
  })
})

describe('bestTyrePerTeam', () => {
  it('gives every team a best compound drawn from what it has run', () => {
    const rows = bestTyrePerTeam(snapshot)
    expect(rows.length).toBeGreaterThan(0)
    for (const r of rows) {
      expect(r.best).not.toBeNull()
      const compounds = r.byCompound.map((b) => b.compound)
      expect(compounds).toContain(r.best!.compound)
      // "best" must be the quickest of the team's compounds.
      expect(r.best!.pace).toBe(Math.min(...r.byCompound.map((b) => b.pace)))
    }
  })
})

describe('analyticsSummary', () => {
  it('emits the three analytics blocks for the AI context', () => {
    const text = analyticsSummary(snapshot)
    expect(text).toContain('TEAM PACE')
    expect(text).toContain('COMPOUND PERFORMANCE')
    expect(text).toContain('BEST TYRE PER TEAM')
  })
})
