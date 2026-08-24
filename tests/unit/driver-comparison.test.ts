import { createElement } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  Driver,
  DriverSessionBests,
  RaceControlMessage,
  SectorTime,
  TimingEntry
} from '@shared/models'
import type { RaceSnapshot } from '@renderer/core/providers/types'
import { emptyAvailability } from '@renderer/core/providers/types'
import { useSessionStore } from '@renderer/store/sessionStore'
import { DriverComparisonCard } from '@renderer/widgets/DriverComparisonCard'

// APP_IMPROVEMENT_ROADMAP.md P1 item 11: rival speed deltas in driver comparison.

const NO_SECTOR: SectorTime = { seconds: null, state: 'none' }

function driver(number: number, code: string): Driver {
  return {
    number,
    code,
    firstName: null,
    lastName: null,
    fullName: code,
    broadcastName: null,
    teamName: `${code} Team`,
    teamColour: null,
    headshotUrl: null,
    countryCode: null
  }
}

function entry(driverNumber: number, position: number): TimingEntry {
  return {
    driverNumber,
    position,
    gapToLeader: position === 1 ? 0 : 5,
    intervalAhead: position === 1 ? null : 5,
    lastLap: 90,
    bestLap: 90,
    lapNumber: 10,
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

function bests(
  driverNumber: number,
  i1: number,
  i2: number,
  fl: number,
  st: number
): DriverSessionBests {
  return {
    driverNumber,
    bestLap: { value: 90, rank: 1 },
    bestSectors: [
      { value: 30, rank: 1 },
      { value: 30, rank: 1 },
      { value: 30, rank: 1 }
    ],
    speeds: {
      i1: { value: i1, rank: 1 },
      i2: { value: i2, rank: 1 },
      fl: { value: fl, rank: 1 },
      st: { value: st, rank: 1 }
    }
  }
}

function makeSnapshot(sessionBests: DriverSessionBests[]): RaceSnapshot {
  const availability = emptyAvailability()
  availability.timing = true
  return {
    session: {
      id: 's',
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
    drivers: [driver(1, 'AAA'), driver(2, 'BBB')],
    timing: [entry(1, 1), entry(2, 2)],
    laps: [],
    stints: [],
    raceControl: [] as RaceControlMessage[],
    weather: null,
    weatherHistory: [],
    positions: [],
    sessionBests,
    availability,
    clock: 0,
    currentLap: 10,
    totalLaps: 50,
    trackStatus: 'CLEAR'
  }
}

function renderCard(sessionBests: DriverSessionBests[]): void {
  useSessionStore.setState({
    snapshot: makeSnapshot(sessionBests),
    focusDriver: 1,
    getDriverLaps: vi.fn().mockReturnValue([])
  })
  render(createElement(DriverComparisonCard))
}

describe('DriverComparisonCard speed deltas', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("shows the speed-trap/intermediate delta on the faster driver's side", () => {
    // Distinct deltas per mark (5, 4, 3, 2) so each queried value is unambiguous.
    renderCard([bests(1, 300, 310, 320, 330), bests(2, 295, 306, 317, 328)])

    // Driver 1 (A) is faster on every mark.
    expect(screen.getByText('+5')).toBeVisible()
    expect(screen.getByText('+2')).toBeVisible()
    expect(screen.getByText('I1 km/h Δ')).toBeVisible()
    expect(screen.getByText('Trap km/h Δ')).toBeVisible()
  })

  it('omits the speed-delta rows entirely when neither driver has session bests', () => {
    renderCard([])

    expect(screen.queryByText('I1 km/h Δ')).toBeNull()
    expect(screen.queryByText('Trap km/h Δ')).toBeNull()
  })
})
