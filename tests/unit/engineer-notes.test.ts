import { describe, it, expect } from 'vitest'
import { deriveEngineerNotes } from '@renderer/core/engines/EngineerNotesEngine'
import type { RaceSnapshot } from '@renderer/core/providers/types'
import type { TimingEntry, TyreCompound, Driver, WeatherSample, TrackStatus } from '@shared/models'

function entry(over: Partial<TimingEntry> & { driverNumber: number; position: number }): TimingEntry {
  return {
    intervalAhead: null, gapToLeader: null, lastLap: null, bestLap: null, lapNumber: null,
    stintAge: null, compound: 'MEDIUM' as TyreCompound, sector1: {} as TimingEntry['sector1'],
    sector2: {} as TimingEntry['sector2'], sector3: {} as TimingEntry['sector3'],
    status: 'RUNNING', inPit: false, pitStops: null, isFastestLap: false, isPersonalBestLap: false,
    penalty: null, underInvestigation: false, retired: false, energyPct: null, deployMode: null,
    ...over
  } as TimingEntry
}

function driver(number: number, code: string): Driver {
  return { number, code } as unknown as Driver
}

function snapshot(over: Partial<RaceSnapshot>): RaceSnapshot {
  return {
    session: { id: 'race-1', type: 'race' },
    clock: 100, currentLap: 20,
    drivers: [driver(1, 'VER'), driver(4, 'NOR'), driver(16, 'LEC')],
    timing: [], trackStatus: 'CLEAR' as TrackStatus, weather: null,
    ...over
  } as unknown as RaceSnapshot
}

describe('deriveEngineerNotes', () => {
  it('flags an undercut threat when a chaser is close on fresher tyres', () => {
    const timing = [
      entry({ driverNumber: 16, position: 1, intervalAhead: null, stintAge: 20 }),
      entry({ driverNumber: 4, position: 2, intervalAhead: 1.4, stintAge: 5 })
    ]
    const notes = deriveEngineerNotes(snapshot({ timing }), snapshot({ timing }))
    const undercut = notes.find((n) => n.category === 'undercut')
    expect(undercut).toBeDefined()
    expect(undercut!.drivers).toEqual([4, 16])
    expect(undercut!.text).toContain('undercut range')
  })

  it('does not flag an undercut when tyres are the same age', () => {
    const timing = [
      entry({ driverNumber: 16, position: 1, stintAge: 12 }),
      entry({ driverNumber: 4, position: 2, intervalAhead: 1.2, stintAge: 12 })
    ]
    const notes = deriveEngineerNotes(snapshot({ timing }), snapshot({ timing }))
    expect(notes.some((n) => n.category === 'undercut')).toBe(false)
  })

  it('opens a pit window when a stint runs long for its compound', () => {
    const timing = [entry({ driverNumber: 1, position: 1, compound: 'SOFT', stintAge: 18 })]
    const notes = deriveEngineerNotes(snapshot({ timing }), snapshot({ timing }))
    const pit = notes.find((n) => n.category === 'pit-window')
    expect(pit).toBeDefined()
    expect(pit!.text).toContain('18 laps old')
  })

  it('flags a closing battle when the gap shrinks quickly', () => {
    const prev = snapshot({
      timing: [
        entry({ driverNumber: 1, position: 1, stintAge: 10 }),
        entry({ driverNumber: 4, position: 2, intervalAhead: 1.9, stintAge: 10 })
      ]
    })
    const cur = snapshot({
      timing: [
        entry({ driverNumber: 1, position: 1, stintAge: 10 }),
        entry({ driverNumber: 4, position: 2, intervalAhead: 1.4, stintAge: 10 })
      ]
    })
    const battle = deriveEngineerNotes(prev, cur).find((n) => n.category === 'battle')
    expect(battle).toBeDefined()
    expect(battle!.text).toContain('closing on')
  })

  it('raises a high-priority note when a safety car is deployed', () => {
    const prev = snapshot({ trackStatus: 'CLEAR' as TrackStatus })
    const cur = snapshot({ trackStatus: 'SAFETY_CAR' as TrackStatus })
    const note = deriveEngineerNotes(prev, cur).find((n) => n.category === 'neutralisation')
    expect(note).toBeDefined()
    expect(note!.priority).toBe('high')
  })

  it('raises a high-priority note on rain onset', () => {
    const dry = { rainfall: false } as WeatherSample
    const wet = { rainfall: true } as WeatherSample
    const note = deriveEngineerNotes(snapshot({ weather: dry }), snapshot({ weather: wet })).find(
      (n) => n.category === 'weather'
    )
    expect(note).toBeDefined()
    expect(note!.priority).toBe('high')
    expect(note!.text.toLowerCase()).toContain('rain')
  })

  it('stays quiet when nothing strategic is happening', () => {
    const timing = [
      entry({ driverNumber: 1, position: 1, stintAge: 8, intervalAhead: null }),
      entry({ driverNumber: 4, position: 2, stintAge: 8, intervalAhead: 12 })
    ]
    const notes = deriveEngineerNotes(snapshot({ timing }), snapshot({ timing }))
    expect(notes).toEqual([])
  })

  it('ignores cars in the pit lane', () => {
    const timing = [
      entry({ driverNumber: 16, position: 1, stintAge: 25 }),
      entry({ driverNumber: 4, position: 2, intervalAhead: 1.0, stintAge: 5, inPit: true })
    ]
    const notes = deriveEngineerNotes(snapshot({ timing }), snapshot({ timing }))
    expect(notes.some((n) => n.category === 'undercut')).toBe(false)
  })
})
