import type { RaceSnapshot } from '@renderer/core/providers/types'
import type {
  Driver,
  LapSample,
  PitLaneTime,
  SectorTime,
  Stint,
  TimingEntry,
  TyreCompound
} from '@shared/models'

const NO_SECTOR: SectorTime = { seconds: null, state: 'none' }

export function driver(number: number): Driver {
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

export function entry(number: number, overrides: Partial<TimingEntry> = {}): TimingEntry {
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
    pitStops: 1,
    isFastestLap: false,
    isPersonalBestLap: false,
    penalty: null,
    underInvestigation: false,
    retired: false,
    energyPct: null,
    deployMode: null,
    ...overrides
  }
}

export function lap(
  driverNumber: number,
  lapNumber: number,
  overrides: Partial<LapSample> = {}
): LapSample {
  return {
    driverNumber,
    lapNumber,
    lapTime: 90,
    sector1: null,
    sector2: null,
    sector3: null,
    speedI1: null,
    speedI2: null,
    speedST: null,
    isPitOutLap: false,
    isPitInLap: false,
    compound: null,
    dateStart: null,
    sessionTime: lapNumber * 100,
    ...overrides
  }
}

export function stint(
  driverNumber: number,
  stintNumber: number,
  lapStart: number,
  lapEnd: number | null,
  compound: TyreCompound
): Stint {
  return {
    driverNumber,
    stintNumber,
    lapStart,
    lapEnd,
    tyre: { compound, ageAtStart: 0, isNew: true },
    degradationPerLap: null
  }
}

export function baseSnapshot(overrides: Partial<RaceSnapshot> = {}): RaceSnapshot {
  return {
    session: {
      id: 'pit-event-log',
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
    drivers: [driver(1), driver(44)],
    timing: [entry(1), entry(44)],
    laps: [],
    stints: [],
    raceControl: [],
    weather: null,
    weatherHistory: [],
    positions: [],
    availability: {
      timing: true,
      laps: true,
      stints: true,
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

/**
 * A scrub-aware fixture that behaves like a real provider: laps and measured
 * pit times are clipped to the clock, but the stint list is the WHOLE session
 * (DemoProvider/OpenF1Provider hand out `stintCache` unclipped).
 *
 * Driver 1: in-lap 10 (completes at t=1000), pit-lane time 24.3s measured at
 * t=1025, SOFT -> HARD. Driver 44: in-lap 20 (completes at t=2000), no measured
 * pit time at all, MEDIUM -> HARD.
 */
export function raceAt(clock: number): RaceSnapshot {
  const laps: LapSample[] = []
  for (let n = 1; n <= 30; n++) {
    if (n * 100 <= clock) {
      laps.push(lap(1, n, { isPitInLap: n === 10, isPitOutLap: n === 11 }))
      laps.push(lap(44, n, { isPitInLap: n === 20, isPitOutLap: n === 21 }))
    }
  }
  const pitLaneTimes: PitLaneTime[] =
    clock >= 1025 ? [{ driverNumber: 1, duration: 24.3, lap: 10 }] : []
  const d1InPit = clock >= 1000 && clock < 1025
  const d44InPit = clock >= 2000 && clock < 2025
  return baseSnapshot({
    clock,
    laps,
    pitLaneTimes,
    stints: [
      stint(1, 1, 1, 10, 'SOFT'),
      stint(1, 2, 11, null, 'HARD'),
      stint(44, 1, 1, 20, 'MEDIUM'),
      stint(44, 2, 21, null, 'HARD')
    ],
    timing: [entry(1, { inPit: d1InPit }), entry(44, { inPit: d44InPit })]
  })
}
