import { describe, expect, it } from 'vitest'
import { classifyTrackContamination } from '@renderer/core/engines/PitCycleModel'
import type { RaceSnapshot } from '@renderer/core/providers/types'
import type {
  Driver,
  RaceControlMessage,
  SectorTime,
  TimingEntry,
  TrackStatus
} from '@shared/models'

const NO_SECTOR: SectorTime = { seconds: null, state: 'none' }

interface EntryFixture {
  readonly number: number
  readonly position: number
  readonly gapToLeader: number | '+1 LAP'
  readonly intervalAhead?: number | null
  readonly inPit?: boolean
}

function buildSnapshot(
  entries: readonly EntryFixture[],
  opts: {
    readonly trackStatus?: TrackStatus
    readonly raceControl?: readonly RaceControlMessage[]
    readonly clock?: number
  } = {}
): RaceSnapshot {
  const drivers: Driver[] = entries.map((e) => ({
    number: e.number,
    code: `D${e.number}`,
    firstName: null,
    lastName: null,
    fullName: `D${e.number}`,
    broadcastName: null,
    teamName: null,
    teamColour: null,
    headshotUrl: null,
    countryCode: null
  }))
  const timing: TimingEntry[] = entries.map((e) => ({
    driverNumber: e.number,
    position: e.position,
    gapToLeader: e.gapToLeader,
    intervalAhead: e.intervalAhead ?? null,
    lastLap: 90,
    bestLap: 90,
    lapNumber: 20,
    stintAge: 10,
    lapsThisStint: 10,
    compound: 'MEDIUM',
    sector1: NO_SECTOR,
    sector2: NO_SECTOR,
    sector3: NO_SECTOR,
    status: e.inPit ? 'IN_PIT' : 'RUNNING',
    inPit: e.inPit ?? false,
    pitStops: 1,
    isFastestLap: false,
    isPersonalBestLap: false,
    penalty: null,
    underInvestigation: false,
    retired: false,
    energyPct: null,
    deployMode: null
  }))
  return {
    session: {
      id: 'contamination',
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
    drivers,
    timing,
    laps: [],
    stints: [],
    raceControl: opts.raceControl ?? [],
    weather: null,
    weatherHistory: [],
    positions: [],
    availability: {
      timing: true,
      laps: false,
      stints: false,
      intervals: true,
      raceControl: true,
      weather: false,
      positions: false,
      positionProgress: false,
      telemetry: false,
      live: false
    },
    clock: opts.clock ?? 1800,
    currentLap: 20,
    totalLaps: 50,
    trackStatus: opts.trackStatus ?? 'CLEAR'
  }
}

function raceControl(overrides: Partial<RaceControlMessage>): RaceControlMessage {
  return {
    id: 'rc-1',
    date: '2026-01-01T00:00:00Z',
    sessionTime: 1780,
    category: 'Flag',
    message: 'YELLOW FLAG',
    flag: 'YELLOW',
    scope: 'Sector',
    sector: 3,
    driverNumber: null,
    lapNumber: null,
    severity: 'notice',
    ...overrides
  }
}

describe('classifyTrackContamination', () => {
  it('reports no contamination in a clear gap on a green track', () => {
    const snapshot = buildSnapshot([
      { number: 1, position: 1, gapToLeader: 0 },
      { number: 2, position: 2, gapToLeader: 8, intervalAhead: 8 }
    ])
    const state = classifyTrackContamination(snapshot, snapshot.timing[1])
    expect(state.isContaminated).toBe(false)
    expect(state.reasons).toEqual([])
  })

  it('flags close-traffic for the single car ahead', () => {
    const snapshot = buildSnapshot([
      { number: 1, position: 1, gapToLeader: 0 },
      { number: 2, position: 2, gapToLeader: 1.2, intervalAhead: 1.2 }
    ])
    const state = classifyTrackContamination(snapshot, snapshot.timing[1])
    expect(state.reasons).toContain('close-traffic')
  })

  it('flags a train when two cars ahead are both within threshold', () => {
    const snapshot = buildSnapshot([
      { number: 1, position: 1, gapToLeader: 0 },
      { number: 2, position: 2, gapToLeader: 1.0, intervalAhead: 1.0 },
      { number: 3, position: 3, gapToLeader: 2.0, intervalAhead: 1.0 }
    ])
    const state = classifyTrackContamination(snapshot, snapshot.timing[2])
    expect(state.reasons).toContain('train')
  })

  it('flags lapped-traffic from the +1 LAP gap sentinel', () => {
    const snapshot = buildSnapshot([
      { number: 1, position: 1, gapToLeader: 0 },
      { number: 2, position: 2, gapToLeader: '+1 LAP' }
    ])
    const state = classifyTrackContamination(snapshot, snapshot.timing[1])
    expect(state.reasons).toContain('lapped-traffic')
  })

  it('flags pit-interaction when the car ahead is in the pits', () => {
    const snapshot = buildSnapshot([
      { number: 1, position: 1, gapToLeader: 0, inPit: true },
      { number: 2, position: 2, gapToLeader: 8, intervalAhead: 8 }
    ])
    const state = classifyTrackContamination(snapshot, snapshot.timing[1])
    expect(state.reasons).toContain('pit-interaction')
  })

  it('flags neutralized for the whole field under Safety Car', () => {
    const snapshot = buildSnapshot(
      [
        { number: 1, position: 1, gapToLeader: 0 },
        { number: 2, position: 2, gapToLeader: 8, intervalAhead: 8 }
      ],
      { trackStatus: 'SAFETY_CAR' }
    )
    const state = classifyTrackContamination(snapshot, snapshot.timing[1])
    expect(state.reasons).toContain('neutralized')
  })

  it('flags sector-yellow within the recency window and not once it expires', () => {
    const near = buildSnapshot(
      [
        { number: 1, position: 1, gapToLeader: 0 },
        { number: 2, position: 2, gapToLeader: 8, intervalAhead: 8 }
      ],
      { raceControl: [raceControl({ sessionTime: 1750 })], clock: 1800 }
    )
    expect(classifyTrackContamination(near, near.timing[1]).reasons).toContain('sector-yellow')

    const stale = buildSnapshot(
      [
        { number: 1, position: 1, gapToLeader: 0 },
        { number: 2, position: 2, gapToLeader: 8, intervalAhead: 8 }
      ],
      { raceControl: [raceControl({ sessionTime: 1000 })], clock: 1800 }
    )
    expect(classifyTrackContamination(stale, stale.timing[1]).reasons).not.toContain(
      'sector-yellow'
    )
  })

  it('ignores a green flag message for sector-yellow', () => {
    const snapshot = buildSnapshot(
      [
        { number: 1, position: 1, gapToLeader: 0 },
        { number: 2, position: 2, gapToLeader: 8, intervalAhead: 8 }
      ],
      { raceControl: [raceControl({ flag: 'GREEN', sessionTime: 1790 })], clock: 1800 }
    )
    expect(classifyTrackContamination(snapshot, snapshot.timing[1]).reasons).not.toContain(
      'sector-yellow'
    )
  })
})
