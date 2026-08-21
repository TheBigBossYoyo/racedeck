import { describe, it, expect } from 'vitest'
import { DemoProvider } from '@renderer/core/providers/DemoProvider'
import { computeBattles, detectTrains } from '@renderer/core/engines/BattleEngine'
import type { TimingEntry } from '@shared/models'

const provider = new DemoProvider()
const midRace = provider.getSnapshotAt(provider.getDuration() * 0.55)

function entry(driverNumber: number, position: number, interval: number | '+1 LAP' | null, o: Partial<TimingEntry> = {}): TimingEntry {
  const sec = { seconds: null, state: 'none' as const }
  return {
    driverNumber,
    position,
    gapToLeader: position === 1 ? 0 : position * 1.2,
    intervalAhead: interval,
    lastLap: 90,
    bestLap: 89,
    lapNumber: 20,
    stintAge: 10,
    compound: 'MEDIUM',
    sector1: sec,
    sector2: sec,
    sector3: sec,
    status: 'RUNNING',
    inPit: false,
    pitStops: 1,
    isFastestLap: false,
    isPersonalBestLap: false,
    penalty: null,
    underInvestigation: false,
    retired: false,
    energyPct: 60,
    deployMode: 'BALANCED',
    ...o
  }
}

describe('computeBattles', () => {
  const report = computeBattles(midRace)

  it('returns well-formed battles within range', () => {
    expect(Array.isArray(report.battles)).toBe(true)
    for (const b of report.battles) {
      expect(b.interval).toBeGreaterThanOrEqual(0)
      expect(b.interval).toBeLessThanOrEqual(report.rangeSec)
      expect(b.inOvertakeRange).toBe(b.interval <= 1.0)
      expect(b.intensity).toBeGreaterThanOrEqual(0)
      expect(b.intensity).toBeLessThanOrEqual(1)
      expect(['PASS LIKELY', 'OVERTAKE', 'CLOSING', 'HOLDING']).toContain(b.verdict)
      // Attacker trails the defender by exactly one position.
      const att = midRace.timing.find((t) => t.driverNumber === b.attacker)!
      const def = midRace.timing.find((t) => t.driverNumber === b.defender)!
      expect((att.position ?? 0) - (def.position ?? 0)).toBe(1)
      expect(b.forPosition).toBe(def.position)
    }
  })

  it('never reports a car that is in the pits', () => {
    const withPit = {
      ...midRace,
      timing: midRace.timing.map((t, i) => (i === 3 ? { ...t, inPit: true } : t))
    }
    const inPitNum = midRace.timing[3].driverNumber
    const r = computeBattles(withPit)
    expect(r.battles.some((b) => b.attacker === inPitNum || b.defender === inPitNum)).toBe(false)
  })
})

describe('detectTrains', () => {
  it('finds a run of 3+ cars within overtake range and stops at a gap', () => {
    const ordered: TimingEntry[] = [
      entry(1, 1, null),
      entry(4, 2, 0.6),
      entry(16, 3, 0.8),
      entry(81, 4, 0.4),
      entry(55, 5, 3.0), // breaks the first train, and is isolated…
      entry(63, 6, 3.0), // …because the next car is 3.0s back too
      entry(44, 7, 0.7),
      entry(11, 8, 0.9)
    ]
    const trains = detectTrains(ordered)
    expect(trains.length).toBe(2)
    expect(trains[0]).toEqual([1, 4, 16, 81])
    expect(trains[1]).toEqual([63, 44, 11])
  })

  it('ignores cars in the pits when linking a train', () => {
    const ordered: TimingEntry[] = [
      entry(1, 1, null),
      entry(4, 2, 0.6),
      entry(16, 3, 0.5, { inPit: true }), // in pit → not part of a train
      entry(81, 4, 0.5)
    ]
    expect(detectTrains(ordered)).toEqual([])
  })
})

describe('battle verdict + closing', () => {
  it('flags overtake range and a closing rate from pace', () => {
    // Two hand-built snapshots: attacker (4) clearly quicker than defender (1).
    const timing = [entry(1, 1, null), entry(4, 2, 0.7)]
    const laps = [
      { driverNumber: 1, lapNumber: 18, lapTime: 92, sector1: null, sector2: null, sector3: null, speedI1: null, speedI2: null, speedST: null, isPitOutLap: false, isPitInLap: false, compound: 'MEDIUM' as const, dateStart: null },
      { driverNumber: 1, lapNumber: 19, lapTime: 92, sector1: null, sector2: null, sector3: null, speedI1: null, speedI2: null, speedST: null, isPitOutLap: false, isPitInLap: false, compound: 'MEDIUM' as const, dateStart: null },
      { driverNumber: 4, lapNumber: 18, lapTime: 91, sector1: null, sector2: null, sector3: null, speedI1: null, speedI2: null, speedST: null, isPitOutLap: false, isPitInLap: false, compound: 'MEDIUM' as const, dateStart: null },
      { driverNumber: 4, lapNumber: 19, lapTime: 91, sector1: null, sector2: null, sector3: null, speedI1: null, speedI2: null, speedST: null, isPitOutLap: false, isPitInLap: false, compound: 'MEDIUM' as const, dateStart: null }
    ]
    const snap = { ...midRace, timing, laps }
    const b = computeBattles(snap).battles[0]
    expect(b).toBeTruthy()
    expect(b.attacker).toBe(4)
    expect(b.inOvertakeRange).toBe(true)
    expect(b.closingPerLap).toBeCloseTo(1, 5) // 92 − 91 s/lap
    expect(b.verdict).toBe('PASS LIKELY')
  })
})
