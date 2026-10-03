import { describe, it, expect } from 'vitest'
import { DemoProvider } from '@renderer/core/providers/DemoProvider'
import { estimateFuelCoefficient } from '@renderer/core/engines/FuelModel'
import {
  bestTyrePerTeam,
  compoundModel,
  compoundPerformance,
  driverRecentPace,
  teamPace
} from '@renderer/core/engines/AnalyticsEngine'
import { WinProbabilityEngine } from '@renderer/core/engines/WinProbabilityEngine'
import { StrategyEngine, planRemainingStrategy } from '@renderer/core/engines/StrategyEngine'
import type { RaceSnapshot } from '@renderer/core/providers/types'

/**
 * Characterization of the engines whose inner loops are memoised on the
 * snapshot's `laps` / `stints` identity. The expected values live in the
 * committed vitest snapshot, recorded from the implementation BEFORE the memo
 * was introduced, so a memo bug that changes any output fails here.
 */

const provider = new DemoProvider()
const FRACTIONS = [0.1, 0.3, 0.5, 0.72, 0.97]
const snapshots: RaceSnapshot[] = FRACTIONS.map((f) => provider.getSnapshotAt(provider.getDuration() * f))

function entriesOf<K, V>(m: Map<K, V>): [K, V][] {
  return [...m.entries()]
}

describe('memoised engines keep their exact outputs', () => {
  it('estimateFuelCoefficient', () => {
    expect(snapshots.map((s) => estimateFuelCoefficient(s))).toMatchSnapshot()
  })

  it('driverRecentPace for every driver at n=5 and n=3', () => {
    const out = snapshots.map((s) =>
      s.timing.map((t) => [
        t.driverNumber,
        driverRecentPace(s, t.driverNumber),
        driverRecentPace(s, t.driverNumber, 3)
      ])
    )
    expect(out).toMatchSnapshot()
  })

  it('teamPace / compoundPerformance / bestTyrePerTeam / compoundModel', () => {
    const out = snapshots.map((s) => ({
      teamPace: teamPace(s),
      compoundPerformance: compoundPerformance(s),
      bestTyrePerTeam: bestTyrePerTeam(s),
      compoundModel: entriesOf(compoundModel(s))
    }))
    expect(out).toMatchSnapshot()
  })

  it('WinProbabilityEngine.compute', () => {
    expect(snapshots.map((s) => WinProbabilityEngine.compute(s))).toMatchSnapshot()
  })

  it('strategy projections that consume the memoised inputs', () => {
    const out = snapshots.map((s) => {
      const drivers = s.timing.slice(0, 4).map((t) => t.driverNumber)
      return drivers.map((n) => ({
        n,
        pit: StrategyEngine.predictPitStop(
          s,
          n,
          s.laps.filter((l) => l.driverNumber === n)
        ),
        plan: planRemainingStrategy(s, n)
      }))
    })
    expect(out).toMatchSnapshot()
  })

  it('open-ended stints resolve against currentLap exactly as before', () => {
    const base = snapshots[3]
    const variants = [base.currentLap, (base.currentLap ?? 30) - 7, null].map((currentLap) => ({
      ...base,
      currentLap
    }))
    expect(variants.map((s) => estimateFuelCoefficient(s))).toMatchSnapshot()
  })
})
