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
  sectorDisplayState,
  buildTyreStintHistory,
  reconcileTyreHistory
} from '@renderer/core/providers/f1normalize'
import type { CurrentTyre, Driver, RaceControlMessage, SectorTime } from '@shared/models'
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
      '1': {
        Stints: {
          '0': { Compound: 'MEDIUM', New: 'true', StartLaps: 0, TotalLaps: 12 },
          '1': { Compound: 'HARD', New: 'true', StartLaps: 0, TotalLaps: 8 }
        }
      },
      '4': { Stints: { '0': { Compound: 'SOFT', New: 'true', StartLaps: 0, TotalLaps: 20 } } }
    }
  }
  const stewardDrivers = normalizeDrivers({
    '41': {
      RacingNumber: '41',
      Tla: 'LIN',
      FirstName: 'Alex',
      LastName: 'Lindblad',
      FullName: 'Alex LINDBLAD',
      TeamName: 'Red Bull Racing',
      TeamColour: '3671C6'
    },
    '44': {
      RacingNumber: '44',
      Tla: 'HAM',
      FirstName: 'Lewis',
      LastName: 'Hamilton',
      FullName: 'Lewis HAMILTON',
      TeamName: 'Ferrari',
      TeamColour: 'DC0000'
    },
    '55': {
      RacingNumber: '55',
      Tla: 'SAI',
      FirstName: 'Carlos',
      LastName: 'Sainz',
      FullName: 'Carlos SAINZ',
      TeamName: 'Williams',
      TeamColour: '005AFF'
    },
    '81': {
      RacingNumber: '81',
      Tla: 'PIA',
      FirstName: 'Oscar',
      LastName: 'Piastri',
      FullName: 'Oscar PIASTRI',
      TeamName: 'McLaren',
      TeamColour: 'FF8000'
    }
  })
  const stewardTimingState = {
    Lines: {
      '41': {
        Position: '1',
        GapToLeader: '',
        IntervalToPositionAhead: { Value: '' },
        NumberOfLaps: 20,
        NumberOfPitStops: 1,
        InPit: false,
        LastLapTime: { Value: '1:24.100', OverallFastest: false, PersonalFastest: true },
        BestLapTime: { Value: '1:24.000' },
        Sectors: { '0': { Value: '28.0' }, '1': { Value: '30.0' }, '2': { Value: '26.0' } }
      },
      '44': {
        Position: '2',
        GapToLeader: '+1.000',
        IntervalToPositionAhead: { Value: '+1.000' },
        NumberOfLaps: 20,
        NumberOfPitStops: 1,
        InPit: false,
        LastLapTime: { Value: '1:24.200', OverallFastest: false, PersonalFastest: true },
        BestLapTime: { Value: '1:24.100' },
        Sectors: { '0': { Value: '28.1' }, '1': { Value: '30.1' }, '2': { Value: '26.0' } }
      },
      '55': {
        Position: '3',
        GapToLeader: '+2.000',
        IntervalToPositionAhead: { Value: '+1.000' },
        NumberOfLaps: 20,
        NumberOfPitStops: 1,
        InPit: false,
        LastLapTime: { Value: '1:24.300', OverallFastest: false, PersonalFastest: true },
        BestLapTime: { Value: '1:24.200' },
        Sectors: { '0': { Value: '28.2' }, '1': { Value: '30.1' }, '2': { Value: '26.0' } }
      },
      '81': {
        Position: '4',
        GapToLeader: '+3.000',
        IntervalToPositionAhead: { Value: '+1.000' },
        NumberOfLaps: 20,
        NumberOfPitStops: 1,
        InPit: false,
        LastLapTime: { Value: '1:24.400', OverallFastest: false, PersonalFastest: true },
        BestLapTime: { Value: '1:24.300' },
        Sectors: { '0': { Value: '28.3' }, '1': { Value: '30.1' }, '2': { Value: '26.0' } }
      }
    }
  }
  const stewardAppState = {
    Lines: {
      '41': { Stints: { '0': { Compound: 'MEDIUM', New: 'true', StartLaps: 0, TotalLaps: 20 } } },
      '44': { Stints: { '0': { Compound: 'MEDIUM', New: 'true', StartLaps: 0, TotalLaps: 20 } } },
      '55': { Stints: { '0': { Compound: 'MEDIUM', New: 'true', StartLaps: 0, TotalLaps: 20 } } },
      '81': { Stints: { '0': { Compound: 'MEDIUM', New: 'true', StartLaps: 0, TotalLaps: 20 } } }
    }
  }
  const rc = (
    id: string,
    date: string,
    message: string,
    driverNumber: number | null
  ): RaceControlMessage => ({
    id,
    date,
    category: 'Other',
    message,
    flag: 'NONE',
    scope: 'Driver',
    sector: null,
    driverNumber,
    lapNumber: null,
    severity: 'warning'
  })
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
    expect(result.filter((entry) => entry.isFastestLap).map((entry) => entry.driverNumber)).toEqual(
      [4]
    )
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

  it('retires a served drive-through while leaving unrelated sanctions active', () => {
    const result = buildTiming(stewardTimingState, stewardAppState, stewardDrivers, [
      rc(
        'dt-issued',
        '2026-08-23T14:40:00Z',
        'FIA STEWARDS: DRIVE THROUGH PENALTY FOR CAR 41 (LIN)',
        41
      ),
      rc(
        'sg-issued',
        '2026-08-23T14:41:00Z',
        'FIA STEWARDS: STOP-AND-GO PENALTY FOR CAR 55 (SAI)',
        55
      ),
      rc(
        'dt-served',
        '2026-08-23T14:42:00Z',
        'FIA STEWARDS: PENALTY SERVED - DRIVE THROUGH PENALTY FOR CAR 41 (LIN)',
        41
      )
    ])

    expect(result.find((entry) => entry.driverNumber === 41)?.penalty).toBeNull()
    expect(result.find((entry) => entry.driverNumber === 55)?.penalty).toBe('SG')
  })

  it('clears a stale incident after reviewed no further investigation', () => {
    const result = buildTiming(stewardTimingState, stewardAppState, stewardDrivers, [
      rc(
        'noted',
        '2026-08-23T14:50:00Z',
        'TURN 1 INCIDENT INVOLVING CARS 81 (PIA) AND 44 (HAM) NOTED',
        81
      ),
      rc(
        'under-investigation',
        '2026-08-23T14:51:00Z',
        'FIA STEWARDS: TURN 1 INCIDENT INVOLVING CARS 81 (PIA) AND 44 (HAM) UNDER INVESTIGATION',
        81
      ),
      rc(
        'reviewed',
        '2026-08-23T14:52:00Z',
        'FIA STEWARDS: TURN 1 INCIDENT INVOLVING CARS 81 (PIA) AND 44 (HAM) REVIEWED NO FURTHER INVESTIGATION',
        81
      )
    ])

    expect(result.find((entry) => entry.driverNumber === 81)?.underInvestigation).toBe(false)
    expect(result.find((entry) => entry.driverNumber === 44)?.underInvestigation).toBe(false)
  })

  it('applies active after-race investigations to every car named in plural wording', () => {
    const result = buildTiming(stewardTimingState, stewardAppState, stewardDrivers, [
      rc(
        'noted',
        '2026-08-23T14:53:00Z',
        'TURN 1 INCIDENT INVOLVING CARS 81 (PIA) AND 44 (HAM) NOTED',
        81
      ),
      rc(
        'after-race',
        '2026-08-23T14:54:00Z',
        'FIA STEWARDS: TURN 1 INCIDENT INVOLVING CARS 81 (PIA) AND 44 (HAM) WILL BE INVESTIGATED AFTER THE RACE',
        81
      )
    ])

    expect(result.find((entry) => entry.driverNumber === 81)?.underInvestigation).toBe(true)
    expect(result.find((entry) => entry.driverNumber === 44)?.underInvestigation).toBe(true)
  })
})

describe('buildTrackPath', () => {
  it('precomputes one bounded reference-car trace from Position data', () => {
    const points: F1StreamPoint[] = [
      {
        t: 0,
        d: { Position: { '0': { Entries: { '1': { X: 50, Y: 20 }, '4': { X: 5, Y: 5 } } } } }
      },
      {
        t: 1,
        d: { Position: { '0': { Entries: { '1': { X: 100, Y: 0 }, '4': { X: 10, Y: 5 } } } } }
      },
      {
        t: 2,
        d: { Position: { '0': { Entries: { '1': { X: 200, Y: 100 }, '4': { X: 15, Y: 5 } } } } }
      },
      {
        t: 3,
        d: { Position: { '0': { Entries: { '1': { X: 300, Y: 100 }, '4': { X: 20, Y: 5 } } } } }
      }
    ]
    expect(buildTrackPath(points, 3, 0)).toEqual([
      { x: 50, y: 20 },
      { x: 100, y: 0 },
      { x: 200, y: 100 }
    ])
  })

  it('returns no trace when Position data has no usable coordinates', () => {
    expect(buildTrackPath([{ t: 0, d: { Position: { '0': { Entries: {} } } } }])).toEqual([])
  })

  it('never traces through a garaged car', () => {
    // F1 keeps every car in every frame; one that is not running is reported
    // OffTrack at the origin. Tracing those drags a spike to (0,0) through the
    // middle of the circuit.
    const points: F1StreamPoint[] = [
      { t: 0, d: { Position: { '0': { Entries: { '1': { Status: 'OnTrack', X: 50, Y: 20 } } } } } },
      { t: 1, d: { Position: { '0': { Entries: { '1': { Status: 'OffTrack', X: 0, Y: 0 } } } } } },
      {
        t: 2,
        d: { Position: { '0': { Entries: { '1': { Status: 'OnTrack', X: 200, Y: 100 } } } } }
      }
    ]
    expect(buildTrackPath(points, 10, 0)).toEqual([
      { x: 50, y: 20 },
      { x: 200, y: 100 }
    ])
  })

  it('picks a reference car that actually runs, not merely one that is listed', () => {
    // Car 1 sits in the garage for the whole sample; car 4 is on track. The
    // trace must follow car 4.
    const points: F1StreamPoint[] = Array.from({ length: 4 }, (_, i) => ({
      t: i,
      d: {
        Position: {
          '0': {
            Entries: {
              '1': { Status: 'OffTrack', X: 0, Y: 0 },
              '4': { Status: 'OnTrack', X: i * 100, Y: 5 }
            }
          }
        }
      }
    }))
    expect(buildTrackPath(points, 10, 0)).toEqual([
      { x: 0, y: 5 },
      { x: 100, y: 5 },
      { x: 200, y: 5 },
      { x: 300, y: 5 }
    ])
  })
})

describe('buildClosedTrackPath', () => {
  const circlePoints = (
    radius: number,
    fromStep: number,
    toStep: number,
    steps = 60
  ): F1StreamPoint[] =>
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
    const trace = buildTrackPath(circlePoints(6000, 0, 60))
    const closed = buildClosedTrackPath(circlePoints(6000, 0, 60))
    expect(closed).not.toBeNull()
    if (!closed) throw new Error('Expected a closed track path.')
    // The closing PREFIX of the trace: it ends as soon as the car is back within
    // a sample's reach of where it started, which is a lap.
    expect(closed.length).toBeGreaterThan(trace.length - 3)
    expect(closed).toEqual([...trace.slice(0, closed.length - 1), trace[0]])
  })

  it('returns the accepted prefix plus the exact first point to eliminate the visible seam', () => {
    const trace = buildTrackPath(circlePoints(6000, 0, 60))
    const closed = buildClosedTrackPath(circlePoints(6000, 0, 60))

    expect(closed).not.toBeNull()
    if (!closed) throw new Error('Expected a closed track path.')
    expect(closed.at(-1)).toEqual(trace[0])
  })

  it('returns ONE lap, not every lap the reference car went on to drive', () => {
    // The search window holds several laps — at Zandvoort about seven. Returning
    // all of them drew each lap's slightly different racing line on top of the
    // last, so the circuit rendered as a thick scribble instead of a line.
    const threeLaps = circlePoints(6000, 0, 180)
    const oneLap = buildClosedTrackPath(circlePoints(6000, 0, 60))
    const closed = buildClosedTrackPath(threeLaps)
    if (!oneLap || !closed) throw new Error('Expected closed track paths.')
    expect(closed).toHaveLength(oneLap.length)
    expect(buildTrackPath(threeLaps).length).toBeGreaterThan(closed.length * 2)
  })

  it('closes the lap even when samples are far apart, as they really are', () => {
    // Position frames arrive about once a second, so at racing speed successive
    // points sit ~45 m apart — much further than the thinning distance. A
    // closure tolerance based on that thinning distance alone steps straight
    // over the start/finish line and never recognises the lap.
    const sparse = circlePoints(6000, 0, 24, 24) // 24 samples for a ~3.8 km lap
    const closed = buildClosedTrackPath(sparse)
    expect(closed).not.toBeNull()
    if (!closed) throw new Error('Expected a closed track path.')
    expect(closed.length).toBeLessThanOrEqual(25)
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
        '4': {
          Stints: {
            '0': { Compound: 'MEDIUM', StartLaps: 0, TotalLaps: 15 },
            '1': { Compound: 'HARD', StartLaps: 0, TotalLaps: 10 }
          }
        }
      }
    }
    const stints = buildStints(
      appState,
      drivers.filter((d) => d.number === 4)
    )
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

describe('buildTyreStintHistory', () => {
  it('parses per-driver stint history keyed directly under Stints (no Lines wrapper)', () => {
    const points: F1StreamPoint[] = [
      {
        t: 5,
        d: {
          Stints: {
            '1': {
              '0': {
                Compound: 'MEDIUM',
                New: 'true',
                TyresNotChanged: '0',
                StartLaps: 0,
                TotalLaps: 12
              },
              '1': {
                Compound: 'HARD',
                New: 'false',
                TyresNotChanged: '0',
                StartLaps: 8,
                TotalLaps: 8
              }
            }
          }
        }
      }
    ]
    const history = buildTyreStintHistory(points, 100)
    expect(history).toHaveLength(1)
    expect(history[0].driverNumber).toBe(1)
    expect(history[0].stints).toEqual([
      { stintNumber: 1, compound: 'MEDIUM', isNew: true, ageAtStart: 0, totalLaps: 12 },
      { stintNumber: 2, compound: 'HARD', isNew: false, ageAtStart: 8, totalLaps: 8 }
    ])
  })

  it('merges deltas that patch by stint index and respects tMax', () => {
    const points: F1StreamPoint[] = [
      {
        t: 5,
        d: {
          Stints: { '4': { '0': { Compound: 'SOFT', New: 'true', StartLaps: 0, TotalLaps: 0 } } }
        }
      },
      {
        t: 40,
        d: {
          Stints: { '4': { '0': { Compound: 'SOFT', New: 'true', StartLaps: 0, TotalLaps: 18 } } }
        }
      },
      {
        t: 90,
        d: {
          Stints: { '4': { '1': { Compound: 'MEDIUM', New: 'true', StartLaps: 0, TotalLaps: 3 } } }
        }
      }
    ]
    const midRace = buildTyreStintHistory(points, 50)
    expect(midRace[0].stints).toHaveLength(1)
    expect(midRace[0].stints[0]).toMatchObject({ totalLaps: 18 })

    const afterPit = buildTyreStintHistory(points, 200)
    expect(afterPit[0].stints).toHaveLength(2)
    expect(afterPit[0].stints[1]).toMatchObject({ compound: 'MEDIUM', ageAtStart: 0 })
  })

  it('ignores empty per-driver stint objects and non-driver keys', () => {
    const points: F1StreamPoint[] = [
      { t: 1, d: { Stints: { '1': {}, notADriver: { '0': { Compound: 'SOFT' } } } } }
    ]
    expect(buildTyreStintHistory(points, 10)).toEqual([])
  })
})

describe('reconcileTyreHistory', () => {
  const activeMedium = {
    stintNumber: 2,
    compound: 'MEDIUM' as const,
    isNew: false,
    ageAtStart: 8,
    totalLaps: 8
  }
  const history = {
    driverNumber: 44,
    stints: [
      { stintNumber: 1, compound: 'SOFT' as const, isNew: true, ageAtStart: 0, totalLaps: 15 },
      activeMedium
    ]
  }

  it('prefers TyreStintSeries as the direct source when it agrees with TimingAppData', () => {
    const result = reconcileTyreHistory(
      history,
      { compound: 'MEDIUM', age: 8 },
      { driverNumber: 44, compound: 'MEDIUM', isNew: false }
    )
    expect(result.activeStint).toEqual(activeMedium)
    expect(result.inferred).toBe(false)
    expect(result.disagreesWithAppData).toBe(false)
  })

  it('flags a disagreement but still prefers TyreStintSeries when TimingAppData disagrees', () => {
    // TimingAppData/CurrentTyres think HARD; TyreStintSeries is the more direct
    // statement and must win, with the disagreement surfaced for diagnostics.
    const result = reconcileTyreHistory(
      history,
      { compound: 'HARD', age: 8 },
      { driverNumber: 44, compound: 'HARD', isNew: false }
    )
    expect(result.activeStint).toEqual(activeMedium)
    expect(result.disagreesWithAppData).toBe(true)
  })

  it('falls back to inferred when TyreStintSeries has not reported this driver yet', () => {
    const result = reconcileTyreHistory(undefined, { compound: 'MEDIUM', age: 8 }, undefined)
    expect(result.activeStint).toBeNull()
    expect(result.inferred).toBe(true)
    expect(result.disagreesWithAppData).toBe(false)
  })

  it('does not flag disagreement when the other sources are simply unknown', () => {
    const unknownCurrentTyre: CurrentTyre = { driverNumber: 44, compound: 'UNKNOWN', isNew: false }
    const result = reconcileTyreHistory(history, { compound: null, age: null }, unknownCurrentTyre)
    expect(result.disagreesWithAppData).toBe(false)
  })
})

describe('provider availability and fastest-lap parity', () => {
  it('reports position capabilities only when actual coordinates or progress exist', () => {
    expect(
      positionAvailability([
        { driverNumber: 1, date: '', x: null, y: null, z: null, position: 1, lapProgress: null }
      ])
    ).toEqual({ positions: false, positionProgress: false })
    expect(
      positionAvailability([
        { driverNumber: 1, date: '', x: null, y: null, z: null, position: 1, lapProgress: 0.5 },
        { driverNumber: 4, date: '', x: 10, y: 20, z: null, position: 2, lapProgress: null }
      ])
    ).toEqual({ positions: true, positionProgress: true })
  })

  it('applies the same single credible fastest-lap rule to any provider field', () => {
    const field = buildTiming(
      {
        Lines: {
          '1': { Position: '1', BestLapTime: { Value: '28.531' } },
          '4': { Position: '2', BestLapTime: { Value: '1:23.800' } }
        }
      },
      { Lines: {} },
      drivers
    )
    assignCredibleFastestLap(field)
    expect(field.some((entry) => entry.isFastestLap)).toBe(false)
  })
})

describe('collectRaceControl', () => {
  it('accumulates messages up to tMax, sorted by time', () => {
    const points: F1StreamPoint[] = [
      {
        t: 5,
        d: {
          Messages: {
            '0': {
              Utc: '2024-01-01T00:00:05Z',
              Category: 'Flag',
              Flag: 'GREEN',
              Message: 'GREEN LIGHT'
            }
          }
        }
      },
      {
        t: 60,
        d: {
          Messages: {
            '1': {
              Utc: '2024-01-01T00:01:00Z',
              Category: 'SafetyCar',
              Message: 'SAFETY CAR DEPLOYED'
            }
          }
        }
      },
      {
        t: 120,
        d: {
          Messages: {
            '2': {
              Utc: '2024-01-01T00:02:00Z',
              Category: 'Flag',
              Flag: 'YELLOW',
              Message: 'YELLOW'
            }
          }
        }
      }
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
            '0': {
              Utc: '2024-01-01T00:00:05Z',
              Category: 'Flag',
              Flag: 'BLUE',
              Message: 'BLUE FLAG FOR CAR 23',
              RacingNumber: '23',
              Lap: 8
            },
            '1': {
              Utc: '2024-01-01T00:00:25Z',
              Category: 'Flag',
              Flag: 'BLUE',
              Message: 'WAVED BLUE FLAG FOR CAR 23',
              RacingNumber: '23',
              Lap: 8
            },
            '2': {
              Utc: '2024-01-01T00:01:05Z',
              Category: 'Flag',
              Flag: 'BLUE',
              Message: 'BLUE FLAG FOR CAR 23',
              RacingNumber: '23',
              Lap: 9
            },
            '3': {
              Utc: '2024-01-01T00:01:06Z',
              Category: 'Flag',
              Flag: 'BLUE',
              Message: 'BLUE FLAG FOR CAR 44',
              RacingNumber: '44',
              Lap: 8
            }
          }
        }
      }
    ]
    const rc = collectRaceControl(points, 90)
    expect(rc).toHaveLength(3)
    expect(
      rc.filter((message) => message.driverNumber === 23 && message.lapNumber === 8)
    ).toHaveLength(1)
    expect(rc.some((message) => message.driverNumber === 23 && message.lapNumber === 9)).toBe(true)
    expect(rc.some((message) => message.driverNumber === 44 && message.lapNumber === 8)).toBe(true)
  })
})

describe('series readers', () => {
  it('weatherAt maps units and rainfall flag', () => {
    const w = weatherAt({
      t: 100,
      d: { AirTemp: '26.5', TrackTemp: '41.2', Humidity: '48', Rainfall: '1', WindSpeed: '2.4' }
    })
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
    expect(lapCountAt({ t: 0, d: { CurrentLap: 12, TotalLaps: 58 } })).toEqual({
      current: 12,
      total: 58
    })
    expect(lapCountAt(null)).toEqual({ current: null, total: null })
  })

  it('qualifyingPartAt reads Q1/Q2/Q3 and rejects invalid values', () => {
    expect(qualifyingPartAt({ SessionPart: '1' })).toBe(1)
    expect(qualifyingPartAt({ SessionPart: 3 })).toBe(3)
    expect(qualifyingPartAt({ SessionPart: 4 })).toBeNull()
  })
})

describe('sectorDisplayState', () => {
  const sector = (over: Partial<SectorTime>): SectorTime => ({
    seconds: null,
    state: 'none',
    ...over
  })

  it('keeps purple for session best and green for personal best', () => {
    expect(sectorDisplayState(sector({ state: 'session-best', seconds: 25.5 }))).toBe(
      'session-best'
    )
    expect(sectorDisplayState(sector({ state: 'personal-best', seconds: 25.7 }))).toBe(
      'personal-best'
    )
  })

  it('colours a completed race sector yellow instead of grey (the "not coloured" bug)', () => {
    // Normal race lap: a posted time that is neither personal nor session best.
    // Previously this collapsed to state:"none" → grey; now it is a completed sector.
    expect(sectorDisplayState(sector({ state: 'none', seconds: 29.4 }))).toBe('complete')
  })

  it('marks a sector active while its marshalling segments are lighting up', () => {
    expect(
      sectorDisplayState(
        sector({ state: 'none', seconds: null, segments: ['green', 'green', 'not-set'] })
      )
    ).toBe('active')
  })

  it('stays grey only for a sector not yet run this lap', () => {
    expect(sectorDisplayState(sector({ state: 'none', seconds: null }))).toBe('none')
    expect(
      sectorDisplayState(sector({ state: 'none', seconds: null, segments: ['not-set', 'not-set'] }))
    ).toBe('none')
  })
})
