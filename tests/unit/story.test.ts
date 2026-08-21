import { describe, it, expect } from 'vitest'
import { DemoProvider } from '@renderer/core/providers/DemoProvider'
import { diffSnapshots } from '@renderer/core/engines/RaceStoryEngine'
import type { RaceSnapshot } from '@renderer/core/providers/types'
import type { TimingEntry, TrackStatus, TyreCompound } from '@shared/models'

const base = new DemoProvider().getSnapshotAt(1500)

function entry(driverNumber: number, position: number, o: Partial<TimingEntry> = {}): TimingEntry {
  const sec = { seconds: null, state: 'none' as const }
  return {
    driverNumber,
    position,
    gapToLeader: position === 1 ? 0 : position * 1.5,
    intervalAhead: position === 1 ? null : 1.5,
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

function snap(
  timing: TimingEntry[],
  o: { trackStatus?: TrackStatus; clock?: number; currentLap?: number } = {}
): RaceSnapshot {
  return {
    ...base,
    timing,
    trackStatus: o.trackStatus ?? 'CLEAR',
    clock: o.clock ?? 1500,
    currentLap: o.currentLap ?? 20
  }
}

describe('diffSnapshots', () => {
  it('reports nothing for an unchanged frame', () => {
    const s = snap([entry(1, 1), entry(4, 2), entry(16, 3)])
    expect(diffSnapshots(s, s)).toEqual([])
  })

  it('detects a Safety Car being deployed', () => {
    const prev = snap([entry(1, 1), entry(4, 2)], { trackStatus: 'CLEAR', clock: 1500 })
    const cur = snap([entry(1, 1), entry(4, 2)], { trackStatus: 'SAFETY_CAR', clock: 1510 })
    const evs = diffSnapshots(prev, cur)
    const flag = evs.find((e) => e.kind === 'flag')
    expect(flag?.text).toMatch(/Safety Car/i)
    expect(flag?.severity).toBe('warn')
  })

  it('detects a lead change', () => {
    const prev = snap([entry(1, 1), entry(4, 2)], { clock: 1500 })
    const cur = snap([entry(4, 1), entry(1, 2)], { clock: 1510 })
    const lead = diffSnapshots(prev, cur).find((e) => e.kind === 'lead-change')
    expect(lead).toBeTruthy()
    expect(lead!.drivers).toEqual([4, 1])
    expect(lead!.text).toMatch(/takes the lead/i)
  })

  it('detects a clean on-track overtake (adjacent swap)', () => {
    const prev = snap([entry(1, 1), entry(4, 2), entry(16, 3)], { clock: 1500 })
    const cur = snap([entry(1, 1), entry(16, 2), entry(4, 3)], { clock: 1510 })
    const ot = diffSnapshots(prev, cur).find((e) => e.kind === 'overtake')
    expect(ot).toBeTruthy()
    expect(ot!.drivers).toEqual([16, 4])
    expect(ot!.text).toMatch(/passes/i)
  })

  it('does not call a pit-cycle position swap an overtake', () => {
    const prev = snap([entry(1, 1), entry(4, 2), entry(16, 3)], { clock: 1500 })
    // 4 drops to P3 only because it pitted — not a pass by 16.
    const cur = snap([entry(1, 1), entry(16, 2), entry(4, 3, { inPit: true })], { clock: 1510 })
    expect(diffSnapshots(prev, cur).some((e) => e.kind === 'overtake')).toBe(false)
  })

  it('detects a pit stop and a tyre change', () => {
    const prev = snap([entry(1, 1), entry(4, 2, { inPit: false, compound: 'MEDIUM' })], { clock: 1500 })
    const cur = snap([entry(1, 1), entry(4, 2, { inPit: true, compound: 'HARD' as TyreCompound })], { clock: 1510 })
    const evs = diffSnapshots(prev, cur)
    expect(evs.find((e) => e.kind === 'pit')?.drivers).toEqual([4])
    expect(evs.find((e) => e.kind === 'tyres')?.text).toMatch(/HARD/)
  })

  it('detects a fastest lap and a retirement', () => {
    const prev = snap([entry(1, 1), entry(4, 2)], { clock: 1500 })
    const cur = snap(
      [entry(1, 1, { isFastestLap: true }), entry(4, 2, { status: 'RETIRED', retired: true })],
      { clock: 1510 }
    )
    const evs = diffSnapshots(prev, cur)
    expect(evs.find((e) => e.kind === 'fastest-lap')?.drivers).toEqual([1])
    expect(evs.find((e) => e.kind === 'retirement')?.drivers).toEqual([4])
  })
})
