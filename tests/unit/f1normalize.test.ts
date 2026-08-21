import { describe, it, expect } from 'vitest'
import {
  parseLapTime,
  parseGap,
  normalizeDrivers,
  buildTiming,
  buildTrackPath,
  buildClosedTrackPath,
  positionCoordinatesAt,
  buildStints,
  currentStint,
  positionAvailability,
  assignCredibleFastestLap,
  collectRaceControl,
  weatherAt,
  trackStatusAt,
  lapCountAt,
  qualifyingPartAt,
  sectorDisplayState
} from '@renderer/core/providers/f1normalize'
import type { Driver, SectorTime } from '@shared/models'
import type { F1StreamPoint } from '@shared/f1live'

describe('parseLapTime', () => {
  it('parses m:ss.mmm and ss.mmm; rejects empty/zero', () => {
    expect(parseLapTime('1:23.456')).toBeCloseTo(83.456, 3)
    expect(parseLapTime('28.531')).toBeCloseTo(28.531, 3)
    expect(parseLapTime('')).toBeNull()
    expect(parseLapTime(undefined)).toBeNull()
  })
})

describe('parseGap', () => {
  it('parses numeric gaps and lap-down markers', () => {
    expect(parseGap('+1.234')).toBeCloseTo(1.234, 3)
    expect(parseGap('0.512')).toBeCloseTo(0.512, 3)
    expect(parseGap('LAP 1')).toBe('+1 LAP')
    expect(parseGap('1L')).toBe('+1 LAP')
    expect(parseGap('')).toBeNull()
  })
})

const DRIVER_STATE = {
  '4': {
    RacingNumber: '4',
    Tla: 'NOR',
    FirstName: 'Lando',
    LastName: 'Norris',
    FullName: 'Lando NORRIS',
    BroadcastName: 'L NORRIS',
    TeamName: 'McLaren',
    TeamColour: 'FF8000',
    CountryCode: 'GBR'
  },
  '1': {
    RacingNumber: '1',
    Tla: 'VER',
    FirstName: 'Max',
    LastName: 'Verstappen',
    FullName: 'Max VERSTAPPEN',
    TeamName: 'Red Bull Racing',
    TeamColour: '3671C6'
  }
}

const drivers: Driver[] = normalizeDrivers(DRIVER_STATE)

describe('normalizeDrivers', () => {
  it('maps the F1 DriverList into Driver models', () => {
    expect(drivers.map((d) => d.number)).toEqual([1, 4])
    const nor = drivers.find((d) => d.number === 4)!
    expect(nor.code).toBe('NOR')
    expect(nor.teamName).toBe('McLaren')
    expect(nor.teamColour).toBe('FF8000')
  })
})

describe('buildTiming', () => {
  const timingState = {
    Lines: {
      '1': {
        Position: '1',
        GapToLeader: '',
        IntervalToPositionAhead: { Value: '' },
        NumberOfLaps: 20,
        NumberOfPitStops: 1,
        InPit: false,
        LastLapTime: { Value: '1:24.100', OverallFastest: false, PersonalFastest: true },
        BestLapTime: { Value: '1:23.900' },
        Sectors: { '0': { Value: '28.5' }, '1': { Value: '30.1' }, '2': { Value: '25.5' } }
      },
      '4': {
        Position: '2',
        GapToLeader: '+2.345',
        IntervalToPositionAhead: { Value: '+2.345' },
        NumberOfLaps: 20,
        NumberOfPitStops: 1,
        InPit: false,
        LastLapTime: { Value: '1:23.800', OverallFastest: true, PersonalFastest: true },
        BestLapTime: { Value: '1:23.800' },
        Sectors: { '0': { Value: '28.3' }, '1': { Value: '30.0' }, '2': { Value: '25.5' } }
      }
    }
  }
  const appState = {
    Lines: {
      '1': { Stints: { '0': { Compound: 'MEDIUM', New: 'true', StartLaps: 0, TotalLaps: 12 }, '1': { Compound: 'HARD', New: 'true', StartLaps: 0, TotalLaps: 8 } } },
      '4': { Stints: { '0': { Compound: 'SOFT', New: 'true', StartLaps: 0, TotalLaps: 20 } } }
    }
  }
  const timing = buildTiming(timingState, appState, drivers)

  it('orders by position and sets leader gaps/intervals correctly', () => {
    expect(timing.map((t) => t.driverNumber)).toEqual([1, 4])
    expect(timing[0].gapToLeader).toBe(0)
    expect(timing[0].intervalAhead).toBeNull()
    expect(timing[1].gapToLeader).toBeCloseTo(2.345, 3)
    expect(timing[1].intervalAhead).toBeCloseTo(2.345, 3)
  })

  it('reads lap times, tyres (current stint) and fastest-lap flag', () => {
    expect(timing[0].lastLap).toBeCloseTo(84.1, 2)
    expect(timing[0].compound).toBe('HARD') // active (2nd) stint
    expect(timing[0].stintAge).toBe(8)
    expect(timing[0].pitStops).toBe(1)
    expect(timing[1].compound).toBe('SOFT')
    expect(timing[1].isFastestLap).toBe(true)
  })

  it('keeps exactly one fastest-lap holder when incremental flags are stale', () => {
    const staleFlags = {
      Lines: {
        ...timingState.Lines,
        '1': {
          ...timingState.Lines['1'],
          BestLapTime: { Value: '1:23.900', OverallFastest: true },
          LastLapTime: { ...timingState.Lines['1'].LastLapTime, OverallFastest: true }
        },
        '4': {
          ...timingState.Lines['4'],
          BestLapTime: { Value: '1:23.800', OverallFastest: true },
          LastLapTime: { ...timingState.Lines['4'].LastLapTime, OverallFastest: true }
        }
      }
    }
    const result = buildTiming(staleFlags, appState, drivers)
    expect(result.filter((entry) => entry.isFastestLap).map((entry) => entry.driverNumber)).toEqual([4])
  })

  it('does not invent a fastest-lap holder from an incomplete or implausible field', () => {
    const partial = {
      Lines: {
        ...timingState.Lines,
        '1': { ...timingState.Lines['1'], BestLapTime: { Value: '' } }
      }
    }
    expect(buildTiming(partial, appState, drivers).some((entry) => entry.isFastestLap)).toBe(false)

    const malformed = {
      Lines: {
        ...timingState.Lines,
        '1': { ...timingState.Lines['1'], BestLapTime: { Value: '28.531' } }
      }
    }
    const result = buildTiming(malformed, appState, drivers)
    expect(result.find((entry) => entry.driverNumber === 1)?.isFastestLap).toBe(false)
    expect(result.find((entry) => entry.driverNumber === 4)?.isFastestLap).toBe(false)
  })

  it('re-ranks duplicate raw positions into a unique classification', () => {
    const duplicate = {
      Lines: {
        ...timingState.Lines,
        '4': { ...timingState.Lines['4'], Position: '1', GapToLeader: '+2.345' }
      }
    }
    const result = buildTiming(duplicate, appState, drivers)
    expect(result.map((entry) => entry.position)).toEqual([1, 2])
    expect(new Set(result.map((entry) => entry.position)).size).toBe(result.length)
  })

  it('drops a stale leader gap that contradicts the repaired order and interval', () => {
    const contradictory = {
      Lines: {
        ...timingState.Lines,
        '4': {
          ...timingState.Lines['4'],
          Position: '20',
          GapToLeader: '+0.2',
          IntervalToPositionAhead: { Value: '+2.0' }
        }
      }
    }
    const result = buildTiming(contradictory, appState, drivers)
    expect(result.find((entry) => entry.driverNumber === 4)?.gapToLeader).toBeNull()
  })

  it('does not mark a transient Stopped timing state as retired', () => {
    const stopped = {
      Lines: {
        ...timingState.Lines,
        '1': { ...timingState.Lines['1'], Stopped: true, Retired: false }
      }
    }
    const result = buildTiming(stopped, appState, drivers)
    expect(result.find((entry) => entry.driverNumber === 1)).toMatchObject({
      status: 'STOPPED',
      retired: false
    })
  })

  it('projects time penalties and investigations from Race Control', () => {
    const messages = [
      {
        id: 'investigation',
        date: '2024-01-01T00:00:01Z',
        category: 'Other',
        message: 'CAR 4 (NOR) UNDER INVESTIGATION',
        flag: 'NONE' as const,
        scope: 'Driver',
        sector: null,
        driverNumber: 4,
        lapNumber: 10,
        severity: 'warning' as const
      },
      {
        id: 'penalty',
        date: '2024-01-01T00:00:02Z',
        category: 'Penalty',
        message: 'CAR 1 (VER) TIME 5 SECOND PENALTY - TRACK LIMITS',
        flag: 'NONE' as const,
        scope: 'Driver',
        sector: null,
        driverNumber: null,
        lapNumber: 11,
        severity: 'warning' as const
      }
    ]
    const result = buildTiming(timingState, appState, drivers, messages)
    expect(result.find((entry) => entry.driverNumber === 1)?.penalty).toBe('5s')
    expect(result.find((entry) => entry.driverNumber === 4)?.underInvestigation).toBe(true)
  })

  it('accumulates multiple time penalties and preserves non-time sanctions', () => {
    const base = {
      date: '2024-01-01T00:00:01Z',
      category: 'Penalty',
      flag: 'NONE' as const,
      scope: 'Driver',
      sector: null,
      driverNumber: 1,
      lapNumber: 10,
      severity: 'warning' as const
    }
    const result = buildTiming(timingState, appState, drivers, [
      { ...base, id: 'p1', message: 'CAR 1 TIME 5 SECOND PENALTY' },
      { ...base, id: 'p2', message: 'CAR 1 TIME 10 SECOND PENALTY' },
      { ...base, id: 'p3', message: 'CAR 1 DRIVE THROUGH PENALTY' }
    ])
    expect(result.find((entry) => entry.driverNumber === 1)?.penalty).toBe('15s · DT')
  })
})

describe('buildTrackPath', () => {
  it('precomputes one bounded reference-car trace from Position data', () => {
    const points: F1StreamPoint[] = [
      { t: 0, d: { Position: { '0': { Entries: { '1': { X: 0, Y: 0 }, '4': { X: 5, Y: 5 } } } } } },
      { t: 1, d: { Position: { '0': { Entries: { '1': { X: 100, Y: 0 }, '4': { X: 10, Y: 5 } } } } } },
      { t: 2, d: { Position: { '0': { Entries: { '1': { X: 200, Y: 100 }, '4': { X: 15, Y: 5 } } } } } },
      { t: 3, d: { Position: { '0': { Entries: { '1': { X: 300, Y: 100 }, '4': { X: 20, Y: 5 } } } } } }
    ]
    expect(buildTrackPath(points, 3, 0)).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 200, y: 100 }
    ])
  })

  it('returns no trace when Position data has no usable coordinates', () => {
    expect(buildTrackPath([{ t: 0, d: { Position: { '0': { Entries: {} } } } }])).toEqual([])
  })
})

describe('buildClosedTrackPath', () => {
  const circlePoints = (radius: number, fromStep: number, toStep: number, steps = 60): F1StreamPoint[] =>
    Array.from({ length: toStep - fromStep + 1 }, (_, index) => {
      const angle = (2 * Math.PI * (fromStep + index)) / steps
      return {
        t: fromStep + index,
        d: {
          Position: {
            '0': {
              Entries: { '1': { X: radius * Math.cos(angle), Y: radius * Math.sin(angle) } }
            }
          }
        }
      }
    })

  it('withholds the trace while the reference car has only covered part of a lap', () => {
    // A 6000-unit radius is a ≈3.8 km lap; half of it is an open trace.
    expect(buildClosedTrackPath(circlePoints(6000, 0, 30))).toBeNull()
  })

  it('withholds a closed loop that is too short to be a real F1 lap', () => {
    // A ~1.9 km loop (pit return under red flag) closes but cannot be a circuit.
    expect(buildClosedTrackPath(circlePoints(3000, 0, 60))).toBeNull()
  })

  it('returns the trace once a plausible full lap demonstrably closes', () => {
    const closed = buildClosedTrackPath(circlePoints(6000, 0, 60))
    expect(closed).not.toBeNull()
    expect(closed).toEqual(buildTrackPath(circlePoints(6000, 0, 60)))
  })
})

describe('positionCoordinatesAt', () => {
  const points: F1StreamPoint[] = [
    { t: 10, d: { Position: { '0': { Entries: { '1': { X: 0, Y: 100, Z: 5 } } } } } },
    { t: 11, d: { Position: { '0': { Entries: { '1': { X: 200, Y: 300, Z: 15 } } } } } }
  ]

  it('interpolates driver coordinates between surrounding frames', () => {
    expect(positionCoordinatesAt(points, 10.25)['1']).toEqual({ x: 50, y: 150, z: 7.5 })
    expect(positionCoordinatesAt(points, 10.5)['1']).toEqual({ x: 100, y: 200, z: 10 })
  })

  it('holds the latest frame at the live edge and exposes nothing before the first frame', () => {
    expect(positionCoordinatesAt(points, 12)['1']).toEqual({ x: 200, y: 300, z: 15 })
    expect(positionCoordinatesAt(points, 9)).toEqual({})
  })
})

describe('buildStints', () => {
  it('derives lap ranges from stint totals, last stint open-ended', () => {
    const appState = {
      Lines: {
        '4': { Stints: { '0': { Compound: 'MEDIUM', StartLaps: 0, TotalLaps: 15 }, '1': { Compound: 'HARD', StartLaps: 0, TotalLaps: 10 } } }
      }
    }
    const stints = buildStints(appState, drivers.filter((d) => d.number === 4))
    expect(stints).toHaveLength(2)
    expect(stints[0]).toMatchObject({ stintNumber: 1, lapStart: 1, lapEnd: 15 })
    expect(stints[0].tyre.compound).toBe('MEDIUM')
    expect(stints[1]).toMatchObject({ stintNumber: 2, lapStart: 16, lapEnd: null })
    expect(stints[1].tyre.compound).toBe('HARD')
  })

  it('selects the last defined stint from a sparse live update and exposes its age', () => {
    const sparse: unknown[] = []
    sparse[2] = { Compound: 'HARD', StartLaps: 0, TotalLaps: 9, New: 'true' }
    expect(currentStint({ Stints: sparse })).toMatchObject({
      compound: 'HARD',
      age: 9,
      lapsThisStint: 9
    })
  })

  it('separates total tyre age from laps run in the current stint on a USED set', () => {
    // F1's TotalLaps already counts the laps a scrubbed set carried before it was
    // fitted (StartLaps). Reporting 19 as "laps in this stint" made downstream
    // code slice 19 laps of history for a stint only 11 laps old, reaching back
    // into an earlier run on the same compound.
    const stints: unknown[] = [{ Compound: 'MEDIUM', StartLaps: 8, TotalLaps: 19, New: 'false' }]
    expect(currentStint({ Stints: stints })).toMatchObject({
      compound: 'MEDIUM',
      age: 19,
      lapsThisStint: 11
    })
  })
})

describe('provider availability and fastest-lap parity', () => {
  it('reports position capabilities only when actual coordinates or progress exist', () => {
    expect(positionAvailability([
      { driverNumber: 1, date: '', x: null, y: null, z: null, position: 1, lapProgress: null }
    ])).toEqual({ positions: false, positionProgress: false })
    expect(positionAvailability([
      { driverNumber: 1, date: '', x: null, y: null, z: null, position: 1, lapProgress: 0.5 },
      { driverNumber: 4, date: '', x: 10, y: 20, z: null, position: 2, lapProgress: null }
    ])).toEqual({ positions: true, positionProgress: true })
  })

  it('applies the same single credible fastest-lap rule to any provider field', () => {
    const field = buildTiming({
      Lines: {
        '1': { Position: '1', BestLapTime: { Value: '28.531' } },
        '4': { Position: '2', BestLapTime: { Value: '1:23.800' } }
      }
    }, { Lines: {} }, drivers)
    assignCredibleFastestLap(field)
    expect(field.some((entry) => entry.isFastestLap)).toBe(false)
  })
})

describe('collectRaceControl', () => {
  it('accumulates messages up to tMax, sorted by time', () => {
    const points: F1StreamPoint[] = [
      { t: 5, d: { Messages: { '0': { Utc: '2024-01-01T00:00:05Z', Category: 'Flag', Flag: 'GREEN', Message: 'GREEN LIGHT' } } } },
      { t: 60, d: { Messages: { '1': { Utc: '2024-01-01T00:01:00Z', Category: 'SafetyCar', Message: 'SAFETY CAR DEPLOYED' } } } },
      { t: 120, d: { Messages: { '2': { Utc: '2024-01-01T00:02:00Z', Category: 'Flag', Flag: 'YELLOW', Message: 'YELLOW' } } } }
    ]
    const rc = collectRaceControl(points, 90)
    expect(rc.map((m) => m.message)).toEqual(['GREEN LIGHT', 'SAFETY CAR DEPLOYED'])
    expect(rc[1].severity).toBe('critical')
  })

  it('collapses repeated blue flags for the same car and lap', () => {
    const points: F1StreamPoint[] = [
      {
        t: 5,
        d: {
          Messages: {
            '0': { Utc: '2024-01-01T00:00:05Z', Category: 'Flag', Flag: 'BLUE', Message: 'BLUE FLAG FOR CAR 23', RacingNumber: '23', Lap: 8 },
            '1': { Utc: '2024-01-01T00:00:25Z', Category: 'Flag', Flag: 'BLUE', Message: 'WAVED BLUE FLAG FOR CAR 23', RacingNumber: '23', Lap: 8 },
            '2': { Utc: '2024-01-01T00:01:05Z', Category: 'Flag', Flag: 'BLUE', Message: 'BLUE FLAG FOR CAR 23', RacingNumber: '23', Lap: 9 },
            '3': { Utc: '2024-01-01T00:01:06Z', Category: 'Flag', Flag: 'BLUE', Message: 'BLUE FLAG FOR CAR 44', RacingNumber: '44', Lap: 8 }
          }
        }
      }
    ]
    const rc = collectRaceControl(points, 90)
    expect(rc).toHaveLength(3)
    expect(rc.filter((message) => message.driverNumber === 23 && message.lapNumber === 8)).toHaveLength(1)
    expect(rc.some((message) => message.driverNumber === 23 && message.lapNumber === 9)).toBe(true)
    expect(rc.some((message) => message.driverNumber === 44 && message.lapNumber === 8)).toBe(true)
  })
})

describe('series readers', () => {
  it('weatherAt maps units and rainfall flag', () => {
    const w = weatherAt({ t: 100, d: { AirTemp: '26.5', TrackTemp: '41.2', Humidity: '48', Rainfall: '1', WindSpeed: '2.4' } })
    expect(w?.airTemp).toBeCloseTo(26.5, 2)
    expect(w?.trackTemp).toBeCloseTo(41.2, 2)
    expect(w?.rainfall).toBe(true)
    expect(weatherAt(null)).toBeNull()
  })

  it('trackStatusAt maps F1 status codes', () => {
    expect(trackStatusAt({ t: 0, d: { Status: '1' } })).toBe('CLEAR')
    expect(trackStatusAt({ t: 0, d: { Status: '4' } })).toBe('SAFETY_CAR')
    expect(trackStatusAt({ t: 0, d: { Status: '6' } })).toBe('VSC')
    expect(trackStatusAt({ t: 0, d: { Status: '5' } })).toBe('RED')
    expect(trackStatusAt(null)).toBe('UNKNOWN')
  })

  it('lapCountAt reads current/total', () => {
    expect(lapCountAt({ t: 0, d: { CurrentLap: 12, TotalLaps: 58 } })).toEqual({ current: 12, total: 58 })
    expect(lapCountAt(null)).toEqual({ current: null, total: null })
  })

  it('qualifyingPartAt reads Q1/Q2/Q3 and rejects invalid values', () => {
    expect(qualifyingPartAt({ SessionPart: '1' })).toBe(1)
    expect(qualifyingPartAt({ SessionPart: 3 })).toBe(3)
    expect(qualifyingPartAt({ SessionPart: 4 })).toBeNull()
  })
})

describe('sectorDisplayState', () => {
  const sector = (over: Partial<SectorTime>): SectorTime => ({ seconds: null, state: 'none', ...over })

  it('keeps purple for session best and green for personal best', () => {
    expect(sectorDisplayState(sector({ state: 'session-best', seconds: 25.5 }))).toBe('session-best')
    expect(sectorDisplayState(sector({ state: 'personal-best', seconds: 25.7 }))).toBe('personal-best')
  })

  it('colours a completed race sector yellow instead of grey (the "not coloured" bug)', () => {
    // Normal race lap: a posted time that is neither personal nor session best.
    // Previously this collapsed to state:"none" → grey; now it is a completed sector.
    expect(sectorDisplayState(sector({ state: 'none', seconds: 29.4 }))).toBe('complete')
  })

  it('marks a sector active while its marshalling segments are lighting up', () => {
    expect(
      sectorDisplayState(sector({ state: 'none', seconds: null, segments: ['green', 'green', 'not-set'] }))
    ).toBe('active')
  })

  it('stays grey only for a sector not yet run this lap', () => {
    expect(sectorDisplayState(sector({ state: 'none', seconds: null }))).toBe('none')
    expect(sectorDisplayState(sector({ state: 'none', seconds: null, segments: ['not-set', 'not-set'] }))).toBe('none')
  })
})
