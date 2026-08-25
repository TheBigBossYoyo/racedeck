import { describe, expect, it } from 'vitest'
import type { LapSample } from '@shared/models'
import { sectorDegradationTrend } from '@renderer/core/engines/SectorDegradation'

function lap(overrides: Partial<LapSample> & { lapNumber: number }): LapSample {
  return {
    driverNumber: 2,
    lapTime: null,
    sector1: null,
    sector2: null,
    sector3: null,
    speedI1: null,
    speedI2: null,
    speedST: null,
    isPitOutLap: false,
    isPitInLap: false,
    compound: 'MEDIUM',
    dateStart: null,
    ...overrides
  }
}

describe('sectorDegradationTrend', () => {
  it('returns nulls for every sector without enough clean laps', () => {
    const laps = [
      lap({ lapNumber: 1, lapTime: 90, sector1: 30, sector2: 30, sector3: 30 }),
      lap({ lapNumber: 2, lapTime: 90.1, sector1: 30, sector2: 30.1, sector3: 30 })
    ]
    const result = sectorDegradationTrend(laps)
    expect(result).toHaveLength(3)
    expect(result.every((s) => s.slopeSecPerLap == null)).toBe(true)
  })

  it('isolates degradation to the sector that is actually getting slower', () => {
    // Sector 2 climbs steadily; sectors 1 and 3 stay flat.
    const laps = Array.from({ length: 6 }, (_, i) =>
      lap({
        lapNumber: i + 1,
        lapTime: 30 + (30 + i * 0.2) + 30,
        sector1: 30,
        sector2: 30 + i * 0.2,
        sector3: 30
      })
    )
    const result = sectorDegradationTrend(laps)
    const s1 = result.find((s) => s.sector === 1)!
    const s2 = result.find((s) => s.sector === 2)!
    const s3 = result.find((s) => s.sector === 3)!
    expect(s2.slopeSecPerLap).not.toBeNull()
    expect(s2.slopeSecPerLap!).toBeGreaterThan(0.15)
    expect(Math.abs(s1.slopeSecPerLap ?? 0)).toBeLessThan(0.01)
    expect(Math.abs(s3.slopeSecPerLap ?? 0)).toBeLessThan(0.01)
  })

  it('excludes pit in/out laps and laps missing a sector', () => {
    const laps: LapSample[] = [
      lap({
        lapNumber: 1,
        lapTime: 200,
        sector1: 100,
        sector2: 60,
        sector3: 40,
        isPitOutLap: true
      }),
      lap({ lapNumber: 2, lapTime: 90, sector1: 30, sector2: 30, sector3: 30 }),
      lap({ lapNumber: 3, lapTime: 90.1, sector1: 30, sector2: 30.1, sector3: 29.9 }),
      lap({ lapNumber: 4, lapTime: 90.2, sector1: 30, sector2: 30.2, sector3: 30 }),
      lap({ lapNumber: 5, lapTime: null, sector1: null, sector2: null, sector3: null })
    ]
    const result = sectorDegradationTrend(laps)
    // Only 3 clean laps remain (2,3,4) — the minimum for a slope, but a real one.
    expect(result.some((s) => s.slopeSecPerLap != null)).toBe(true)
  })

  it('lets sector 3 being missing on every lap still yield trends for sectors 1 and 2', () => {
    // Old all-or-nothing filter required sector1 && sector2 && sector3 on the
    // SAME lap, so a feed that never reports sector3 would zero out every
    // sector's trend, not just sector 3's. Per-sector filtering should keep
    // sectors 1 and 2 working off their own clean laps.
    const laps = Array.from({ length: 6 }, (_, i) =>
      lap({
        lapNumber: i + 1,
        lapTime: 90 + i * 0.2,
        sector1: 30,
        sector2: 30 + i * 0.2,
        sector3: null
      })
    )
    const result = sectorDegradationTrend(laps)
    const s1 = result.find((s) => s.sector === 1)!
    const s2 = result.find((s) => s.sector === 2)!
    const s3 = result.find((s) => s.sector === 3)!
    expect(s1.slopeSecPerLap).not.toBeNull()
    expect(s2.slopeSecPerLap).not.toBeNull()
    expect(s2.slopeSecPerLap!).toBeGreaterThan(0.15)
    expect(s3.slopeSecPerLap).toBeNull()
  })

  it("computes deltaToBestSec against the driver's own best sector", () => {
    const laps = Array.from({ length: 4 }, (_, i) =>
      lap({
        lapNumber: i + 1,
        lapTime: 90 + i * 0.3,
        sector1: 30 + i * 0.1,
        sector2: 30 + i * 0.1,
        sector3: 30 + i * 0.1
      })
    )
    const result = sectorDegradationTrend(laps, 6, undefined, [29.5, null, null])
    const s1 = result.find((s) => s.sector === 1)!
    expect(s1.deltaToBestSec).not.toBeNull()
    expect(s1.deltaToBestSec!).toBeGreaterThan(0)
    const s2 = result.find((s) => s.sector === 2)!
    expect(s2.deltaToBestSec).toBeNull()
  })
})
