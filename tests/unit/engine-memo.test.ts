import { describe, it, expect } from 'vitest'
import { DemoProvider } from '@renderer/core/providers/DemoProvider'
import { estimateFuelCoefficient, memoizeOnLapInputs } from '@renderer/core/engines/FuelModel'
import {
  compoundPerformance,
  driverLaps,
  driverRecentPace
} from '@renderer/core/engines/AnalyticsEngine'
import { circuitPitLoss } from '@renderer/core/engines/StrategyEngine'
import type { RaceSnapshot } from '@renderer/core/providers/types'

const provider = new DemoProvider()
const base = provider.getSnapshotAt(provider.getDuration() * 0.6)

/** A new snapshot object that shares every lap/stint array with `base`. */
function tick(over: Partial<RaceSnapshot> = {}): RaceSnapshot {
  return { ...base, ...over }
}

describe('estimateFuelCoefficient memo', () => {
  it('returns the same reference for a new snapshot object sharing the laps array', () => {
    const a = estimateFuelCoefficient(base)
    expect(estimateFuelCoefficient(tick({ clock: base.clock + 1 }))).toBe(a)
  })

  it('recomputes when the laps array identity changes', () => {
    const a = estimateFuelCoefficient(base)
    const b = estimateFuelCoefficient(tick({ laps: [...base.laps] }))
    expect(b).not.toBe(a)
    expect(b).toEqual(a)
  })

  it('matches a from-scratch computation when the laps array is replaced by different data', () => {
    const fewer = base.laps.slice(0, Math.floor(base.laps.length / 3))
    estimateFuelCoefficient(base) // warm the cache for the original array
    const viaMemo = estimateFuelCoefficient(tick({ laps: fewer }))
    // A structured clone has fresh array identities, so it cannot hit any cache.
    const scratch = estimateFuelCoefficient({ ...structuredClone(base), laps: structuredClone(fewer) })
    expect(viaMemo).toEqual(scratch)
  })

  it('recomputes when a non-laps input the fit reads changes', () => {
    const a = estimateFuelCoefficient(base)
    expect(estimateFuelCoefficient(tick({ totalLaps: null }))).toEqual({
      sPerLap: 0.055,
      confidence: 'estimated',
      totalLaps: null
    })
    expect(estimateFuelCoefficient(tick({ session: { ...base.session, type: 'qualifying' } })).totalLaps).toBeNull()
    // Back to the original inputs: the value is the original again.
    expect(estimateFuelCoefficient(base)).toEqual(a)
  })

  it('recomputes when stints or currentLap change (open-ended stints read currentLap)', () => {
    const openStints = base.stints.map((s) => ({ ...s, lapEnd: null }))
    const early = estimateFuelCoefficient(tick({ stints: openStints, currentLap: 5 }))
    const late = estimateFuelCoefficient(tick({ stints: openStints, currentLap: base.currentLap }))
    // A cache hit that ignored currentLap would hand back the same object.
    expect(early).not.toBe(late)
    const scratch = estimateFuelCoefficient({
      ...structuredClone(base),
      stints: structuredClone(openStints),
      currentLap: 5
    })
    expect(early).toEqual(scratch)
  })

  it('memoizeOnLapInputs computes once per input tuple', () => {
    let calls = 0
    const counted = memoizeOnLapInputs((s) => {
      calls += 1
      return s.clock
    })
    counted(base)
    counted(tick({ clock: base.clock + 1 }))
    expect(calls).toBe(1)
    counted(tick({ currentLap: (base.currentLap ?? 0) + 1 }))
    expect(calls).toBe(2)
  })
})

describe('driverLaps / driverRecentPace', () => {
  it('groups laps per driver once per laps array and preserves snapshot order', () => {
    for (const t of base.timing) {
      const expected = base.laps.filter((l) => l.driverNumber === t.driverNumber)
      expect(driverLaps(base, t.driverNumber)).toEqual(expected)
    }
    expect(driverLaps(base, 99999)).toEqual([])
    const n = base.timing[0].driverNumber
    expect(driverLaps(tick(), n)).toBe(driverLaps(base, n))
  })

  it('does not go stale when the laps array is replaced', () => {
    const n = base.timing[0].driverNumber
    const before = driverRecentPace(base, n)
    const trimmed = base.laps.filter((l) => !(l.driverNumber === n && l.lapNumber > 10))
    const after = driverRecentPace(tick({ laps: trimmed }), n)
    expect(after).not.toBe(before)
    expect(driverLaps(tick({ laps: trimmed }), n).every((l) => l.lapNumber <= 10)).toBe(true)
    // The original array's grouping is untouched.
    expect(driverRecentPace(base, n)).toBe(before)
  })
})

describe('compoundPerformance memo', () => {
  it('shares its rows across snapshot objects with the same laps/stints', () => {
    const rows = compoundPerformance(base)
    expect(compoundPerformance(tick({ clock: base.clock + 5 }))).toBe(rows)
    expect(compoundPerformance(tick({ laps: [...base.laps] }))).not.toBe(rows)
    expect(compoundPerformance(tick({ laps: [...base.laps] }))).toEqual(rows)
  })
})

describe('circuitPitLoss memo', () => {
  it('is keyed on the laps array, not the snapshot object', () => {
    const a = circuitPitLoss(base)
    expect(circuitPitLoss(tick({ clock: base.clock + 1 }))).toBe(a)
    const copy = circuitPitLoss(tick({ laps: [...base.laps] }))
    expect(copy).not.toBe(a)
    expect(copy).toEqual(a)
    expect(circuitPitLoss(tick({ laps: [] }))).toEqual({ seconds: 21.5, sampleSize: 0, source: 'default' })
  })
})
