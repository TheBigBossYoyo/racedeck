import { createElement, type ReactElement } from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Driver, RaceControlMessage, SectorTime, TimingEntry } from '@shared/models'
import type { RaceSnapshot } from '@renderer/core/providers/types'
import { emptyAvailability } from '@renderer/core/providers/types'
import { useSessionStore } from '@renderer/store/sessionStore'
import { useSettingsStore } from '@renderer/store/settingsStore'
import { DEFAULT_THEME } from '@renderer/core/engines/ThemeEngine'
import { DiagnosticProfiler } from '@renderer/lib/renderDiagnostics'
import { TimingTower } from '@renderer/widgets/TimingTower'
import { TrackMap } from '@renderer/widgets/TrackMap'
import { DriverDossier } from '@renderer/widgets/DriverDossier'

/**
 * APP_IMPROVEMENT_ROADMAP.md P1 items 16-17: dev render diagnostics + a
 * deterministic render budget. Deliberately a COMMIT-COUNT budget, not a
 * wall-clock millisecond one — CI runner speed varies run to run, so a
 * millisecond assertion is a well-known source of flaky tests; a commit count
 * from React's own Profiler is stable across machines.
 *
 * Chart widgets (echarts-for-react) are out of scope here: this test
 * environment has no canvas/ResizeObserver polyfill, and adding one just for
 * this budget check is a bigger change than this pass warrants — flagged as a
 * follow-up rather than risked as a flaky/broken test.
 */

const NO_SECTOR: SectorTime = { seconds: null, state: 'none' }
const COMMIT_BUDGET = 2

function driver(number: number, code: string): Driver {
  return {
    number,
    code,
    firstName: null,
    lastName: null,
    fullName: code,
    broadcastName: null,
    teamName: null,
    teamColour: null,
    headshotUrl: null,
    countryCode: null
  }
}

function entry(driverNumber: number): TimingEntry {
  return {
    driverNumber,
    position: 1,
    gapToLeader: 0,
    intervalAhead: null,
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

function makeSnapshot(): RaceSnapshot {
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
    drivers: [driver(1, 'AAA')],
    timing: [entry(1)],
    laps: [],
    stints: [],
    raceControl: [] as RaceControlMessage[],
    weather: null,
    weatherHistory: [],
    positions: [],
    availability,
    clock: 0,
    currentLap: 10,
    totalLaps: 50,
    trackStatus: 'CLEAR'
  }
}

/** Mount `node` under a counting Profiler and return how many times it committed. */
function countCommits(node: ReactElement): number {
  let commits = 0
  render(
    createElement(
      DiagnosticProfiler,
      {
        id: 'budget-test',
        onRender: () => {
          commits++
        }
      },
      node
    )
  )
  return commits
}

describe('render budget (commit count, not wall-clock)', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('TimingTower mounts within the commit budget', () => {
    useSessionStore.setState({ snapshot: makeSnapshot(), focusDriver: null })
    useSettingsStore.setState({ favorites: [], toggleFavorite: vi.fn() })

    expect(countCommits(createElement(TimingTower))).toBeLessThanOrEqual(COMMIT_BUDGET)
  })

  it('TrackMap mounts within the commit budget', () => {
    useSessionStore.setState({
      snapshot: makeSnapshot(),
      playing: false,
      focusDriver: null,
      setFocusDriver: vi.fn()
    })
    useSettingsStore.setState({
      favorites: [],
      performanceMode: false,
      theme: { ...DEFAULT_THEME, reducedMotion: false }
    })

    expect(countCommits(createElement(TrackMap))).toBeLessThanOrEqual(COMMIT_BUDGET)
  })

  it('DriverDossier mounts within the commit budget', () => {
    useSessionStore.setState({
      snapshot: makeSnapshot(),
      focusDriver: 1,
      getDriverLaps: vi.fn().mockReturnValue([]),
      getTelemetry: vi.fn().mockReturnValue([])
    })

    expect(countCommits(createElement(DriverDossier))).toBeLessThanOrEqual(COMMIT_BUDGET)
  })
})
