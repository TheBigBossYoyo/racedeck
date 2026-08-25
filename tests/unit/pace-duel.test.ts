import { describe, expect, it } from 'vitest'
import { paceBattleBetween } from '@renderer/core/engines/StrategyEngine'
import type { RaceSnapshot } from '@renderer/core/providers/types'
import type { Driver, LapSample, SectorTime, TimingEntry } from '@shared/models'

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

function entry(number: number, position: number, gapToLeader: number): TimingEntry {
  return {
    driverNumber: number,
    position,
    gapToLeader: position === 1 ? 0 : gapToLeader,
    intervalAhead: null,
    lastLap: 90,
    bestLap: 90,
    lapNumber: 30,
    stintAge: 6,
    lapsThisStint: 6,
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

/** Six laps of a given per-lap time sequence, all on the same compound/stint. */
function stintLaps(driverNumber: number, times: number[]): LapSample[] {
  return times.map((lapTime, i) => ({
    driverNumber,
    lapNumber: 25 + i,
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
  }))
}

function snapshot(overrides: Partial<RaceSnapshot> = {}): RaceSnapshot {
  return {
    session: {
      id: 'duel-1',
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
      totalLaps: 60,
      provider: 'test'
    },
    drivers: [driver(1), driver(2), driver(3)],
    timing: [entry(1, 1, 0), entry(2, 2, 5), entry(3, 3, 20)],
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
      raceControl: false,
      weather: false,
      positions: false,
      positionProgress: false,
      telemetry: false,
      live: false
    },
    clock: 3600,
    currentLap: 30,
    totalLaps: 60,
    trackStatus: 'CLEAR',
    ...overrides
  }
}

describe('paceBattleBetween', () => {
  it('reports unavailable when a driver is not in the field', () => {
    const duel = paceBattleBetween(snapshot(), 1, 99)
    expect(duel.available).toBe(false)
    expect(duel.gapSec).toBeNull()
    expect(duel.lapsToResolve).toBeNull()
  })

  it('orders ahead/behind by track position regardless of argument order', () => {
    const snap = snapshot({
      laps: [...stintLaps(1, [90, 90, 90, 90, 90, 90]), ...stintLaps(3, [90, 90, 90, 90, 90, 90])]
    })
    const forward = paceBattleBetween(snap, 1, 3)
    const reversed = paceBattleBetween(snap, 3, 1)
    expect(forward.ahead.number).toBe(1)
    expect(forward.behind.number).toBe(3)
    expect(reversed.ahead.number).toBe(1)
    expect(reversed.behind.number).toBe(3)
  })

  it('computes the gap between two non-adjacent drivers from gapToLeader', () => {
    const snap = snapshot({
      laps: [...stintLaps(1, [90, 90, 90, 90, 90, 90]), ...stintLaps(3, [90, 90, 90, 90, 90, 90])]
    })
    const duel = paceBattleBetween(snap, 1, 3)
    expect(duel.gapSec).toBe(20) // driver 3's gapToLeader, driver 1 is the leader
  })

  it('flags a closing trend when the trailing driver is genuinely faster', () => {
    const snap = snapshot({
      laps: [...stintLaps(1, [91, 91, 91, 91, 91, 91]), ...stintLaps(3, [90, 90, 90, 90, 90, 90])]
    })
    const duel = paceBattleBetween(snap, 1, 3)
    expect(duel.trend).toBe('closing')
    expect(duel.closingRatePerLap).toBeGreaterThan(0)
  })

  it('projects a faster laps-to-resolve when the ahead driver is degrading', () => {
    // Same current pace and gap in both scenarios (driver 2, gapToLeader 5s)
    // — only the ahead driver's stint trend differs. Degradation should pull
    // the resolution forward, not leave it identical to the flat projection.
    const flatAhead = stintLaps(1, [90, 90, 90, 90, 90, 90])
    const degradingAhead = stintLaps(1, [89, 89.4, 89.8, 90.2, 90.6, 91])
    const behindLaps = stintLaps(2, [89.5, 89.5, 89.5, 89.5, 89.5, 89.5])

    const flatSnap = snapshot({ laps: [...flatAhead, ...behindLaps] })
    const degradingSnap = snapshot({ laps: [...degradingAhead, ...behindLaps] })

    const flatDuel = paceBattleBetween(flatSnap, 1, 2)
    const degradingDuel = paceBattleBetween(degradingSnap, 1, 2)

    expect(flatDuel.ahead.degradationPerLap).not.toBeNull()
    expect(degradingDuel.ahead.degradationPerLap).not.toBeNull()
    expect(degradingDuel.ahead.degradationPerLap!).toBeGreaterThan(
      flatDuel.ahead.degradationPerLap!
    )

    expect(flatDuel.lapsToResolve).not.toBeNull()
    expect(degradingDuel.lapsToResolve).not.toBeNull()
    expect(degradingDuel.lapsToResolve!).toBeLessThanOrEqual(flatDuel.lapsToResolve!)
  })

  it('returns null lapsToResolve when the gap is not closing', () => {
    const snap = snapshot({
      laps: [...stintLaps(1, [89, 89, 89, 89, 89, 89]), ...stintLaps(3, [91, 91, 91, 91, 91, 91])]
    })
    const duel = paceBattleBetween(snap, 1, 3)
    expect(duel.trend).toBe('opening')
    expect(duel.lapsToResolve).toBeNull()
  })

  it('returns null lapsToResolve when the session has no laps left for it to resolve within', () => {
    const snap = snapshot({
      currentLap: 60,
      totalLaps: 60,
      laps: [...stintLaps(1, [91, 91, 91, 91, 91, 91]), ...stintLaps(3, [90, 90, 90, 90, 90, 90])]
    })
    const duel = paceBattleBetween(snap, 1, 3)
    expect(duel.trend).toBe('closing')
    expect(duel.lapsToResolve).toBeNull()
  })
})
