import { describe, expect, it } from 'vitest'
import { buildComparisonSummary } from '@renderer/core/engines/ComparisonSummary'
import type { RaceSnapshot } from '@renderer/core/providers/types'
import type {
  Driver,
  DriverSessionBests,
  LapSample,
  PitLaneTime,
  RankedMark,
  SectorTime,
  TimingEntry,
  WeatherSample
} from '@shared/models'

const NO_SECTOR: SectorTime = { seconds: null, state: 'none' }
const NO_MARK: RankedMark = { value: null, rank: null }

function driver(number: number, team: string): Driver {
  return {
    number,
    code: `D${number}`,
    firstName: null,
    lastName: null,
    fullName: `D${number}`,
    broadcastName: null,
    teamName: team,
    teamColour: null,
    headshotUrl: null,
    countryCode: null
  }
}

function entry(number: number): TimingEntry {
  return {
    driverNumber: number,
    position: number,
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
    pitStops: 0,
    isFastestLap: false,
    isPersonalBestLap: false,
    penalty: null,
    underInvestigation: false,
    retired: false,
    energyPct: null,
    deployMode: null
  }
}

function lap(driverNumber: number, lapNumber: number, lapTime: number): LapSample {
  return {
    driverNumber,
    lapNumber,
    lapTime,
    sector1: null,
    sector2: null,
    sector3: null,
    speedI1: null,
    speedI2: null,
    speedST: null,
    isPitOutLap: false,
    isPitInLap: false,
    compound: 'MEDIUM',
    dateStart: null
  }
}

function weather(trackTemp: number, airTemp: number, rainfall: boolean): WeatherSample {
  return {
    date: '2026-03-01T14:00:00.000Z',
    airTemp,
    trackTemp,
    humidity: 45,
    pressure: 1012,
    windSpeed: 2,
    windDirection: 180,
    rainfall
  }
}

function bests(driverNumber: number, trapKmh: number | null): DriverSessionBests {
  return {
    driverNumber,
    bestLap: NO_MARK,
    bestSectors: [NO_MARK, NO_MARK, NO_MARK],
    speeds: { i1: NO_MARK, i2: NO_MARK, fl: NO_MARK, st: { value: trapKmh, rank: null } }
  }
}

function snapshot(overrides: Partial<RaceSnapshot> = {}): RaceSnapshot {
  return {
    session: {
      id: 'cmp-1',
      meetingId: null,
      name: 'Race',
      type: 'race',
      meetingName: 'Test GP',
      circuitName: null,
      circuitShortName: null,
      countryName: null,
      countryCode: null,
      location: null,
      dateStart: '2026-03-01T14:00:00.000Z',
      dateEnd: null,
      gmtOffset: null,
      year: 2026,
      totalLaps: 50,
      provider: 'test'
    },
    drivers: [driver(1, 'Alpha'), driver(2, 'Beta')],
    timing: [entry(1), entry(2)],
    laps: [],
    stints: [],
    raceControl: [],
    weather: null,
    weatherHistory: [],
    positions: [],
    availability: {
      timing: true,
      laps: false,
      stints: false,
      intervals: false,
      raceControl: false,
      weather: false,
      positions: false,
      positionProgress: false,
      telemetry: false,
      live: false
    },
    clock: 3600,
    currentLap: 30,
    totalLaps: 50,
    trackStatus: 'CLEAR',
    ...overrides
  }
}

describe('buildComparisonSummary', () => {
  it('is null-safe when no pit stops, speeds, or weather exist', () => {
    const summary = buildComparisonSummary(snapshot())
    expect(summary.pitLossMedianSec).toBeNull()
    expect(summary.topSpeedKmh).toBeNull()
    expect(summary.weather.avgTrackTempC).toBeNull()
    expect(summary.weather.avgAirTempC).toBeNull()
    expect(summary.weather.rainFraction).toBeNull()
  })

  it('computes the median pit-lane duration', () => {
    const pitLaneTimes: PitLaneTime[] = [
      { driverNumber: 1, duration: 20, lap: 10 },
      { driverNumber: 2, duration: 24, lap: 12 }
    ]
    const summary = buildComparisonSummary(snapshot({ pitLaneTimes }))
    expect(summary.pitLossMedianSec).toBe(22)
  })

  it('takes the field-wide max speed-trap value as topSpeedKmh', () => {
    const sessionBests = [bests(1, 310), bests(2, 325)]
    const summary = buildComparisonSummary(snapshot({ sessionBests }))
    expect(summary.topSpeedKmh).toBe(325)
  })

  it('computes track/air temp averages and rain fraction from weather history', () => {
    const weatherHistory = [weather(30, 20, false), weather(34, 22, true)]
    const summary = buildComparisonSummary(snapshot({ weatherHistory }))
    expect(summary.weather.avgTrackTempC).toBe(32)
    expect(summary.weather.avgAirTempC).toBe(21)
    expect(summary.weather.rainFraction).toBe(0.5)
  })

  it('carries session identity fields through unchanged', () => {
    const summary = buildComparisonSummary(snapshot())
    expect(summary.sessionId).toBe('cmp-1')
    expect(summary.meetingName).toBe('Test GP')
    expect(summary.sessionName).toBe('Race')
    expect(summary.dateStart).toBe('2026-03-01T14:00:00.000Z')
  })

  it('groups team pace by teamName from real laps', () => {
    const laps = [lap(1, 1, 90), lap(1, 2, 90.2), lap(2, 1, 92), lap(2, 2, 92.1)]
    const summary = buildComparisonSummary(snapshot({ laps }))
    expect(Object.keys(summary.teamPaceMs)).toEqual(expect.arrayContaining(['Alpha', 'Beta']))
    expect(summary.teamPaceMs.Alpha).toBeLessThan(summary.teamPaceMs.Beta)
  })
})
