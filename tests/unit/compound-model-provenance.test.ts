import { describe, expect, it } from 'vitest'
import { STORE_NS } from '@shared/ipc-contract'
import { persist } from '@renderer/store/persist'
import { useComparisonLibraryStore } from '@renderer/store/comparisonLibraryStore'
import { DemoProvider } from '@renderer/core/providers/DemoProvider'
import { compoundModel } from '@renderer/core/engines/AnalyticsEngine'
import { buildComparisonSummary } from '@renderer/core/engines/ComparisonSummary'
import type { RaceSnapshot } from '@renderer/core/providers/types'
import type { LapSample, Stint, TyreCompound } from '@shared/models'

/**
 * Provenance of `compoundModel`: `measured` may only be true when BOTH the pace and
 * the degradation come from this event's laps. A measured compound whose fitted
 * slope is missing or non-positive keeps the fallback number (planners need one)
 * but must never be presented, or persisted, as measured.
 */

const provider = new DemoProvider()
const base = provider.getSnapshotAt(provider.getDuration() * 0.45)

function stintLaps(
  driverNumber: number,
  compound: TyreCompound,
  firstLapTime: number,
  perLap: number,
  count = 8
): { laps: LapSample[]; stint: Stint } {
  const laps: LapSample[] = Array.from({ length: count }, (_, i) => ({
    driverNumber,
    lapNumber: i + 1,
    lapTime: firstLapTime + perLap * i,
    sector1: null,
    sector2: null,
    sector3: null,
    speedI1: null,
    speedI2: null,
    speedST: null,
    isPitOutLap: false,
    isPitInLap: false,
    compound,
    dateStart: null
  }))
  const stint: Stint = {
    driverNumber,
    stintNumber: 1,
    lapStart: 1,
    lapEnd: count,
    tyre: { compound, ageAtStart: 0, isNew: true },
    degradationPerLap: null
  }
  return { laps, stint }
}

/** Practice session: no fuel correction, so the fitted slope equals the raw slope. */
function snapshotWith(parts: { laps: LapSample[]; stint: Stint }[]): RaceSnapshot {
  return {
    ...base,
    session: { ...base.session, type: 'practice' },
    laps: parts.flatMap((p) => p.laps),
    stints: parts.map((p) => p.stint),
    currentLap: 8,
    totalLaps: null
  }
}

describe('compoundModel provenance', () => {
  it('marks a compound measured when pace and a positive slope come from real laps', () => {
    const model = compoundModel(snapshotWith([stintLaps(1, 'SOFT', 90, 0.1)]))
    const soft = model.get('SOFT')!
    expect(soft.measured).toBe(true)
    expect(soft.paceMeasured).toBe(true)
    expect(soft.degMeasured).toBe(true)
    expect(soft.deg).toBeCloseTo(0.1, 6)
  })

  it('does not call a fallback degradation measured when the fitted slope is not positive', () => {
    const model = compoundModel(
      snapshotWith([stintLaps(1, 'SOFT', 90, 0.1), stintLaps(2, 'HARD', 91, -0.1)])
    )
    const hard = model.get('HARD')!
    expect(hard.paceMeasured).toBe(true)
    expect(hard.degMeasured).toBe(false)
    expect(hard.measured).toBe(false)
    // The planner still gets a number to rank plans with.
    expect(hard.deg).toBeGreaterThan(0)
    // Measured data on the other compound is untouched.
    expect(model.get('SOFT')!.measured).toBe(true)
  })

  it('does not call a compound with no stint laps measured', () => {
    const model = compoundModel(snapshotWith([stintLaps(1, 'SOFT', 90, 0.1)]))
    const medium = model.get('MEDIUM')!
    expect(medium.paceMeasured).toBe(false)
    expect(medium.degMeasured).toBe(false)
    expect(medium.measured).toBe(false)
  })

  it('does not call a measured pace with too few stint laps for a slope fully measured', () => {
    const model = compoundModel(snapshotWith([stintLaps(1, 'SOFT', 90, 0.1, 3)]))
    const soft = model.get('SOFT')!
    expect(soft.paceMeasured).toBe(true)
    expect(soft.degMeasured).toBe(false)
    expect(soft.measured).toBe(false)
  })
})

describe('ComparisonSummary.degradationByCompound', () => {
  it('persists a number only for a compound whose degradation was measured', () => {
    const summary = buildComparisonSummary(
      snapshotWith([stintLaps(1, 'SOFT', 90, 0.1), stintLaps(2, 'HARD', 91, -0.1)])
    )
    expect(summary.degradationByCompound.SOFT).toBeCloseTo(0.1, 6)
    expect(summary.degradationByCompound.HARD).toBeNull()
    expect(summary.degradationByCompound.MEDIUM).toBeNull()
  })

  it('never persists the fallback figure for any compound when nothing was measured', () => {
    const summary = buildComparisonSummary(snapshotWith([stintLaps(1, 'HARD', 91, -0.1)]))
    for (const value of Object.values(summary.degradationByCompound)) expect(value).toBeNull()
  })
})

describe('comparison library entries saved before this fix', () => {
  it('still load unchanged: the persisted shape did not change and nothing is migrated', async () => {
    const legacy = {
      sessionId: 'legacy',
      meetingName: 'Monza',
      sessionName: 'Race',
      dateStart: '2024-09-01T13:00:00Z',
      pitLossMedianSec: 21.5,
      degradationByCompound: { SOFT: 0.1, MEDIUM: 0.05, HARD: null },
      topSpeedKmh: 340,
      teamPaceMs: { Ferrari: 81000 },
      weather: { avgTrackTempC: 40, avgAirTempC: 28, rainFraction: 0 }
    }
    await persist.set(STORE_NS.COMPARISON_LIBRARY, 'entries', [legacy])
    await useComparisonLibraryStore.getState().hydrate()
    expect(useComparisonLibraryStore.getState().entries).toEqual([legacy])
  })
})
