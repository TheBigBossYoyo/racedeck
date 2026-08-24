import { describe, expect, it } from 'vitest'
import { buildPitStopHistory } from '@renderer/core/engines/PitHistory'
import type { RaceSnapshot } from '@renderer/core/providers/types'
import type {
  Driver,
  LapSample,
  PitLaneTime,
  RaceControlMessage,
  SectorTime,
  TimingEntry
} from '@shared/models'

const NO_SECTOR: SectorTime = { seconds: null, state: 'none' }

function driver(number: number): Driver {
  return {
    number,
    code: `D${number}`,
    firstName: null,
    lastName: null,
    fullName: `D${number}`,
    broadcastName: null,
    teamName: null,
    teamColour: null,
    headshotUrl: null,
    countryCode: null
  }
}

function entry(number: number): TimingEntry {
  return {
    driverNumber: number,
    position: 1,
    gapToLeader: 0,
    intervalAhead: null,
    lastLap: 90,
    bestLap: 90,
    lapNumber: 30,
    stintAge: 10,
    lapsThisStint: 10,
    compound: 'MEDIUM',
    sector1: NO_SECTOR,
    sector2: NO_SECTOR,
    sector3: NO_SECTOR,
    status: 'RUNNING',
    inPit: false,
    pitStops: 1,
    isFastestLap: false,
    isPersonalBestLap: false,
    penalty: null,
    underInvestigation: false,
    retired: false,
    energyPct: null,
    deployMode: null
  }
}

function pitInLap(driverNumber: number, lapNumber: number, sessionTime: number): LapSample {
  return {
    driverNumber,
    lapNumber,
    lapTime: 120,
    sector1: null,
    sector2: null,
    sector3: null,
    speedI1: null,
    speedI2: null,
    speedST: null,
    isPitOutLap: false,
    isPitInLap: true,
    compound: 'MEDIUM',
    dateStart: null,
    sessionTime
  }
}

function raceControl(overrides: Partial<RaceControlMessage>): RaceControlMessage {
  return {
    id: 'rc',
    date: '2026-01-01T00:00:00Z',
    sessionTime: 1000,
    category: 'Flag',
    message: 'SAFETY CAR DEPLOYED',
    flag: 'CLEAR',
    scope: null,
    sector: null,
    driverNumber: null,
    lapNumber: null,
    severity: 'notice',
    ...overrides
  }
}

function baseSnapshot(overrides: Partial<RaceSnapshot> = {}): RaceSnapshot {
  return {
    session: {
      id: 'pit-history',
      meetingId: null,
      name: 'Race',
      type: 'race',
      meetingName: 'Test GP',
      circuitName: null,
      circuitShortName: null,
      countryName: null,
      countryCode: null,
      location: null,
      dateStart: null,
      dateEnd: null,
      gmtOffset: null,
      year: 2026,
      totalLaps: 50,
      provider: 'test'
    },
    drivers: [driver(1)],
    timing: [entry(1)],
    laps: [],
    stints: [],
    raceControl: [],
    weather: null,
    weatherHistory: [],
    positions: [],
    availability: {
      timing: true,
      laps: true,
      stints: false,
      intervals: false,
      raceControl: true,
      weather: false,
      positions: false,
      positionProgress: true,
      telemetry: false,
      live: false
    },
    clock: 3000,
    currentLap: 30,
    totalLaps: 50,
    trackStatus: 'CLEAR',
    ...overrides
  }
}

describe('buildPitStopHistory', () => {
  it('returns nothing without pitLaneTimes', () => {
    expect(buildPitStopHistory(baseSnapshot())).toEqual([])
  })

  it('computes deltaVsMedianSec across multiple stops', () => {
    const pitLaneTimes: PitLaneTime[] = [
      { driverNumber: 1, duration: 22, lap: 10 },
      { driverNumber: 1, duration: 26, lap: 30 },
      { driverNumber: 1, duration: 24, lap: 40 }
    ]
    const result = buildPitStopHistory(baseSnapshot({ pitLaneTimes }))
    expect(result).toHaveLength(3)
    const median24 = result.find((r) => r.lap === 40)!
    expect(median24.deltaVsMedianSec).toBe(0)
    const slow = result.find((r) => r.lap === 30)!
    expect(slow.deltaVsMedianSec).toBe(2)
    const fast = result.find((r) => r.lap === 10)!
    expect(fast.deltaVsMedianSec).toBe(-2)
  })

  it('sorts stops by lap ascending', () => {
    const pitLaneTimes: PitLaneTime[] = [
      { driverNumber: 1, duration: 24, lap: 40 },
      { driverNumber: 1, duration: 22, lap: 10 }
    ]
    const result = buildPitStopHistory(baseSnapshot({ pitLaneTimes }))
    expect(result.map((r) => r.lap)).toEqual([10, 40])
  })

  it('flags underNeutralization when an SC/VSC message lands shortly before the stop', () => {
    const pitLaneTimes: PitLaneTime[] = [{ driverNumber: 1, duration: 12, lap: 30 }]
    const laps = [pitInLap(1, 30, 2700)]
    const snapshot = baseSnapshot({
      pitLaneTimes,
      laps,
      raceControl: [raceControl({ message: 'SAFETY CAR DEPLOYED', sessionTime: 2650 })]
    })
    const result = buildPitStopHistory(snapshot)
    expect(result[0].underNeutralization).toBe(true)
  })

  it('does not flag underNeutralization when the SC message is too far in the past', () => {
    const pitLaneTimes: PitLaneTime[] = [{ driverNumber: 1, duration: 12, lap: 30 }]
    const laps = [pitInLap(1, 30, 2700)]
    const snapshot = baseSnapshot({
      pitLaneTimes,
      laps,
      raceControl: [raceControl({ message: 'SAFETY CAR DEPLOYED', sessionTime: 1000 })]
    })
    const result = buildPitStopHistory(snapshot)
    expect(result[0].underNeutralization).toBe(false)
  })

  it('flags servedPenalty only for a matching driver mentioned nearby', () => {
    const pitLaneTimes: PitLaneTime[] = [
      { driverNumber: 1, duration: 12, lap: 30 },
      { driverNumber: 2, duration: 12, lap: 30 }
    ]
    const laps = [pitInLap(1, 30, 2700), pitInLap(2, 30, 2700)]
    const snapshot = baseSnapshot({
      pitLaneTimes,
      laps,
      raceControl: [
        raceControl({ message: '5s penalty served', driverNumber: 1, sessionTime: 2680 })
      ]
    })
    const result = buildPitStopHistory(snapshot)
    expect(result.find((r) => r.driverNumber === 1)?.servedPenalty).toBe(true)
    expect(result.find((r) => r.driverNumber === 2)?.servedPenalty).toBe(false)
  })

  it('reads positionBefore/positionAfter from lapPositions', () => {
    const pitLaneTimes: PitLaneTime[] = [{ driverNumber: 1, duration: 12, lap: 5 }]
    const positions = Array.from({ length: 10 }, (_, i) => (i === 3 ? 4 : i === 5 ? 6 : 5))
    const snapshot = baseSnapshot({
      pitLaneTimes,
      lapPositions: [{ driverNumber: 1, positions }]
    })
    const result = buildPitStopHistory(snapshot)
    // lap 4 (index 3) -> position 4; lap 6 (index 5) -> position 6
    expect(result[0].positionBefore).toBe(4)
    expect(result[0].positionAfter).toBe(6)
  })
})
