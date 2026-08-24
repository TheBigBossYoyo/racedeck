import { describe, expect, it } from 'vitest'
import { buildTyreRead } from '@renderer/core/engines/TyreRead'
import type { RaceSnapshot } from '@renderer/core/providers/types'
import type {
  Driver,
  LapSample,
  SectorTime,
  Stint,
  TimingEntry,
  TyreCompound
} from '@shared/models'

const NO_SECTOR: SectorTime = { seconds: null, state: 'none' }

type Fixture = {
  readonly number: number
  readonly code: string
  readonly position: number
  readonly gapToLeader: number
  readonly intervalAhead?: number | null
  readonly compound: TyreCompound
  readonly stintAge: number
  readonly lapsThisStint?: number | null
  /** Lap times for this driver, oldest first, ending at the current lap. */
  readonly laps?: readonly number[]
}

const CURRENT_LAP = 30

function entryFor(fixture: Fixture, index: number, sorted: readonly Fixture[]): TimingEntry {
  return {
    driverNumber: fixture.number,
    position: fixture.position,
    gapToLeader: index === 0 ? 0 : fixture.gapToLeader,
    intervalAhead:
      index === 0
        ? null
        : (fixture.intervalAhead ?? fixture.gapToLeader - sorted[index - 1].gapToLeader),
    lastLap: fixture.laps?.[fixture.laps.length - 1] ?? 90,
    bestLap: fixture.laps?.[0] ?? 90,
    lapNumber: CURRENT_LAP,
    stintAge: fixture.stintAge,
    lapsThisStint: fixture.lapsThisStint ?? fixture.stintAge,
    compound: fixture.compound,
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
    energyPct: 60,
    deployMode: 'BALANCED'
  }
}

function buildSnapshot(fixtures: readonly Fixture[]): RaceSnapshot {
  const sorted = [...fixtures].sort((a, b) => a.position - b.position)
  const drivers: Driver[] = sorted.map((f) => ({
    number: f.number,
    code: f.code,
    firstName: null,
    lastName: null,
    fullName: f.code,
    broadcastName: null,
    teamName: `${f.code} Team`,
    teamColour: null,
    headshotUrl: null,
    countryCode: null
  }))
  const timing = sorted.map(entryFor)
  const laps: LapSample[] = sorted.flatMap((f) => {
    const times = f.laps ?? []
    return times.map((lapTime, i) => ({
      driverNumber: f.number,
      lapNumber: CURRENT_LAP - times.length + i + 1,
      lapTime,
      sector1: null,
      sector2: null,
      sector3: null,
      speedI1: null,
      speedI2: null,
      speedST: null,
      isPitOutLap: false,
      isPitInLap: false,
      compound: f.compound,
      dateStart: null,
      sessionTime: (CURRENT_LAP - times.length + i + 1) * 90
    }))
  })
  const stints: Stint[] = sorted.map((f, i) => ({
    driverNumber: f.number,
    stintNumber: 1,
    lapStart: Math.max(1, CURRENT_LAP - Math.max(1, f.stintAge) + 1),
    lapEnd: null,
    tyre: { compound: f.compound, ageAtStart: 0, isNew: true },
    degradationPerLap: null
  }))
  return {
    session: {
      id: 'tyre-read',
      meetingId: null,
      name: 'Race',
      type: 'race',
      meetingName: 'Dutch Grand Prix',
      circuitName: 'Zandvoort',
      circuitShortName: null,
      countryName: null,
      countryCode: null,
      location: null,
      dateStart: '2026-08-30T13:00:00Z',
      dateEnd: null,
      gmtOffset: null,
      year: 2026,
      totalLaps: 72,
      provider: 'test'
    },
    drivers,
    timing,
    laps,
    stints,
    raceControl: [],
    weather: null,
    weatherHistory: [],
    positions: [],
    availability: {
      timing: true,
      laps: true,
      stints: true,
      intervals: true,
      raceControl: true,
      weather: false,
      positions: false,
      positionProgress: true,
      telemetry: false,
      live: false
    },
    clock: CURRENT_LAP * 90,
    currentLap: CURRENT_LAP,
    totalLaps: 72,
    trackStatus: 'CLEAR'
  }
}

function lapsOf(snapshot: RaceSnapshot, driverNumber: number): LapSample[] {
  return snapshot.laps.filter((l) => l.driverNumber === driverNumber)
}

function readFor(snapshot: RaceSnapshot, driverNumber: number) {
  const entry = snapshot.timing.find((t) => t.driverNumber === driverNumber)!
  return buildTyreRead(snapshot, entry, lapsOf(snapshot, driverNumber))
}

/** A stint whose times climb by a fixed amount per lap. */
function risingLaps(base: number, perLap: number, count: number): number[] {
  return Array.from({ length: count }, (_, i) => base + perLap * i)
}

describe('buildTyreRead', () => {
  it('measures the degradation slope over the current stint', () => {
    const snapshot = buildSnapshot([
      {
        number: 1,
        code: 'LEAD',
        position: 1,
        gapToLeader: 0,
        compound: 'MEDIUM',
        stintAge: 8,
        laps: risingLaps(90, 0.2, 8)
      },
      // Far enough back that the leader is not in close traffic.
      {
        number: 2,
        code: 'P2',
        position: 2,
        gapToLeader: 12,
        compound: 'HARD',
        stintAge: 8,
        laps: risingLaps(91, 0.05, 8)
      }
    ])
    const read = readFor(snapshot, 1)
    expect(read.degradationBlocker).toBeNull()
    // The raw times climb 0.2s/lap, but fuel burn was making later laps faster
    // by the default 0.055s/lap — so the tyre is actually losing 0.255s/lap.
    expect(read.degradationPerLap).toBeCloseTo(0.255, 2)
    expect(read.condition).toBe('spent')
    expect(read.slopeSampleLaps).toBeGreaterThanOrEqual(3)
  })

  it('refuses to call traffic-limited pace degradation', () => {
    // The user's HAM-behind-LEC case: rising lap times, but the car is stuck
    // within a second of the car ahead, so the trend is not the tyre.
    const snapshot = buildSnapshot([
      {
        number: 1,
        code: 'LEC',
        position: 1,
        gapToLeader: 0,
        compound: 'MEDIUM',
        stintAge: 16,
        laps: risingLaps(90, 0.08, 8)
      },
      {
        number: 44,
        code: 'HAM',
        position: 2,
        gapToLeader: 0.7,
        intervalAhead: 0.7,
        compound: 'MEDIUM',
        stintAge: 16,
        laps: risingLaps(90.3, 0.08, 8)
      }
    ])
    const read = readFor(snapshot, 44)
    expect(read.degradationPerLap).toBeNull()
    expect(read.degradationBlocker).toBe('traffic')
    expect(read.condition).toBeNull()
    expect(read.latestLapLossSec).toBeNull()
  })

  it('restores the wear trend once the car has clear air again', () => {
    const snapshot = buildSnapshot([
      {
        number: 1,
        code: 'LEC',
        position: 1,
        gapToLeader: 0,
        compound: 'MEDIUM',
        stintAge: 16,
        laps: risingLaps(90, 0.08, 8)
      },
      {
        number: 44,
        code: 'HAM',
        position: 2,
        gapToLeader: 4.5,
        intervalAhead: 4.5,
        compound: 'MEDIUM',
        stintAge: 16,
        laps: risingLaps(90.3, 0.08, 8)
      }
    ])
    const read = readFor(snapshot, 44)
    expect(read.degradationBlocker).toBeNull()
    // Raw 0.08s/lap plus the 0.055s/lap of fuel burn the raw trend was hiding.
    expect(read.degradationPerLap).toBeCloseTo(0.135, 2)
  })

  it('reports insufficient laps rather than a slope from two laps', () => {
    const snapshot = buildSnapshot([
      {
        number: 1,
        code: 'LEAD',
        position: 1,
        gapToLeader: 0,
        compound: 'SOFT',
        stintAge: 2,
        laps: [90, 90.2]
      },
      {
        number: 2,
        code: 'P2',
        position: 2,
        gapToLeader: 15,
        compound: 'HARD',
        stintAge: 20,
        laps: risingLaps(91, 0.05, 8)
      }
    ])
    const read = readFor(snapshot, 1)
    expect(read.degradationPerLap).toBeNull()
    expect(read.degradationBlocker).toBe('insufficient-laps')
  })

  it('separates set age from stint laps on a used set', () => {
    const snapshot = buildSnapshot([
      {
        number: 1,
        code: 'LEAD',
        position: 1,
        gapToLeader: 0,
        compound: 'MEDIUM',
        stintAge: 14,
        lapsThisStint: 6,
        laps: risingLaps(90, 0.1, 6)
      },
      {
        number: 2,
        code: 'P2',
        position: 2,
        gapToLeader: 15,
        compound: 'HARD',
        stintAge: 20,
        laps: risingLaps(91, 0.05, 8)
      }
    ])
    const read = readFor(snapshot, 1)
    expect(read.setAge).toBe(14)
    expect(read.stintLaps).toBe(6)
    expect(read.usedSet).toBe(true)
  })

  it('uses no historical same-compound laps when the current stint has zero laps', () => {
    const snapshot = buildSnapshot([
      {
        number: 1,
        code: 'LEAD',
        position: 1,
        gapToLeader: 0,
        compound: 'MEDIUM',
        stintAge: 12,
        lapsThisStint: 0,
        // These belong to an earlier stint on the same compound and must not
        // become the new set's degradation trend immediately after fitting it.
        laps: risingLaps(90, 0.2, 8)
      },
      {
        number: 2,
        code: 'P2',
        position: 2,
        gapToLeader: 15,
        compound: 'HARD',
        stintAge: 8,
        laps: risingLaps(91, 0.05, 8)
      }
    ])

    const read = readFor(snapshot, 1)

    expect(read.stintLaps).toBe(0)
    expect(read.slopeSampleLaps).toBe(0)
    expect(read.degradationPerLap).toBeNull()
    expect(read.degradationBlocker).toBe('insufficient-laps')
  })

  it('treats a brand-new set as fresh regardless of early lap-time noise', () => {
    const snapshot = buildSnapshot([
      {
        number: 1,
        code: 'LEAD',
        position: 1,
        gapToLeader: 0,
        compound: 'SOFT',
        stintAge: 2,
        lapsThisStint: 4,
        // Early-stint noise would otherwise read as a steep slope; a set this
        // young has no meaningful wear trend to report either way.
        laps: [90.1, 90.2, 90.4, 92.5]
      },
      {
        number: 2,
        code: 'P2',
        position: 2,
        gapToLeader: 15,
        compound: 'HARD',
        stintAge: 20,
        laps: risingLaps(91, 0.05, 8)
      }
    ])
    const read = readFor(snapshot, 1)
    expect(read.condition).toBe('fresh')
  })

  it('reports the latest-lap pace loss without claiming cumulative loss or stop payback', () => {
    const snapshot = buildSnapshot([
      {
        number: 1,
        code: 'LEAD',
        position: 1,
        gapToLeader: 0,
        compound: 'MEDIUM',
        stintAge: 6,
        laps: risingLaps(90, 0.1, 6)
      },
      {
        number: 2,
        code: 'P2',
        position: 2,
        gapToLeader: 15,
        compound: 'HARD',
        stintAge: 20,
        laps: risingLaps(91, 0.05, 8)
      }
    ])
    const read = readFor(snapshot, 1)
    expect(read.latestLapLossSec).toBeCloseTo(0.775, 2)
  })

  it('reports no latest-lap wear loss when the tyre is improving', () => {
    const snapshot = buildSnapshot([
      {
        number: 1,
        code: 'LEAD',
        position: 1,
        gapToLeader: 0,
        compound: 'HARD',
        stintAge: 10,
        // Improving by MORE than fuel burn explains (the default coefficient is
        // 0.055s/lap), so what is left after the correction is a set genuinely
        // coming to the car rather than a lighter car flattering a worn tyre.
        laps: risingLaps(90.5, -0.12, 8)
      },
      {
        number: 2,
        code: 'P2',
        position: 2,
        gapToLeader: 15,
        compound: 'MEDIUM',
        stintAge: 20,
        laps: risingLaps(91, 0.05, 8)
      }
    ])
    const read = readFor(snapshot, 1)
    expect(read.degradationPerLap).not.toBeNull()
    expect(read.degradationPerLap).toBeLessThan(0)
    expect(read.latestLapLossSec).toBe(0)
    expect(read.condition).toBe('steady')
  })

  it('carries the field-wide figure for this compound', () => {
    const snapshot = buildSnapshot([
      {
        number: 1,
        code: 'LEAD',
        position: 1,
        gapToLeader: 0,
        compound: 'MEDIUM',
        stintAge: 10,
        laps: risingLaps(90, 0.12, 10)
      },
      {
        number: 2,
        code: 'P2',
        position: 2,
        gapToLeader: 15,
        compound: 'MEDIUM',
        stintAge: 10,
        laps: risingLaps(90.4, 0.05, 10)
      }
    ])
    const read = readFor(snapshot, 1)
    expect(read.fieldDegradationPerLap).not.toBeNull()
  })

  it('exposes the exact fuel-corrected series behind the slope, for a sparkline', () => {
    const snapshot = buildSnapshot([
      {
        number: 1,
        code: 'LEAD',
        position: 1,
        gapToLeader: 0,
        compound: 'MEDIUM',
        stintAge: 6,
        laps: risingLaps(90, 0.1, 6)
      },
      {
        number: 2,
        code: 'P2',
        position: 2,
        gapToLeader: 15,
        compound: 'HARD',
        stintAge: 20,
        laps: risingLaps(91, 0.05, 8)
      }
    ])
    const read = readFor(snapshot, 1)
    expect(read.sparklineLaps).toHaveLength(6)
    expect(read.sparklineLaps.map((l) => l.lapNumber)).toEqual([25, 26, 27, 28, 29, 30])
    // The series is fuel-corrected the same way the scalar slope is, so its
    // own endpoints should reflect the same rising trend `degradationPerLap` reports.
    const first = read.sparklineLaps[0].correctedSec
    const last = read.sparklineLaps[read.sparklineLaps.length - 1].correctedSec
    expect(last).toBeGreaterThan(first)
  })

  it('still populates the sparkline series even when traffic blocks the slope claim', () => {
    const snapshot = buildSnapshot([
      {
        number: 1,
        code: 'LEC',
        position: 1,
        gapToLeader: 0,
        compound: 'MEDIUM',
        stintAge: 16,
        laps: risingLaps(90, 0.08, 8)
      },
      {
        number: 44,
        code: 'HAM',
        position: 2,
        gapToLeader: 0.7,
        intervalAhead: 0.7,
        compound: 'MEDIUM',
        stintAge: 16,
        laps: risingLaps(90.3, 0.08, 8)
      }
    ])
    const read = readFor(snapshot, 44)
    expect(read.degradationBlocker).toBe('traffic')
    expect(read.degradationPerLap).toBeNull()
    expect(read.sparklineLaps.length).toBeGreaterThan(0)
  })

  it('returns an empty sparkline series when there are no clean laps yet', () => {
    const snapshot = buildSnapshot([
      {
        number: 1,
        code: 'LEAD',
        position: 1,
        gapToLeader: 0,
        compound: 'SOFT',
        stintAge: 0,
        laps: []
      },
      {
        number: 2,
        code: 'P2',
        position: 2,
        gapToLeader: 15,
        compound: 'HARD',
        stintAge: 0,
        laps: []
      }
    ])
    const read = readFor(snapshot, 1)
    expect(read.sparklineLaps).toEqual([])
  })

  it('returns a null-safe read when the driver has no laps yet', () => {
    const snapshot = buildSnapshot([
      {
        number: 1,
        code: 'LEAD',
        position: 1,
        gapToLeader: 0,
        compound: 'SOFT',
        stintAge: 0,
        laps: []
      },
      {
        number: 2,
        code: 'P2',
        position: 2,
        gapToLeader: 15,
        compound: 'HARD',
        stintAge: 0,
        laps: []
      }
    ])
    const read = readFor(snapshot, 1)
    expect(read.degradationPerLap).toBeNull()
    expect(read.degradationBlocker).toBe('insufficient-laps')
    expect(read.latestLapLossSec).toBeNull()
    expect(read.condition).toBeNull()
  })
})
