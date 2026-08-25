import { createElement } from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Driver, PositionSample, SessionInfo, TimingEntry } from '@shared/models'
import type { RaceSnapshot } from '@renderer/core/providers/types'
import { emptyAvailability } from '@renderer/core/providers/types'
import { DEFAULT_THEME } from '@renderer/core/engines/ThemeEngine'
import { useSessionStore } from '@renderer/store/sessionStore'
import { useSettingsStore } from '@renderer/store/settingsStore'

const markerCalls = vi.hoisted(
  (): Array<{
    animate: boolean
    driverNumber: number
    durationMs: number
    x: number
    y: number
  }> => []
)

vi.mock('@renderer/widgets/trackMap/TrackMapDriverMarker', () => ({
  TrackMapDriverMarker: ({
    animate,
    dot,
    durationMs
  }: {
    animate: boolean
    dot: { number: number; x: number; y: number }
    durationMs: number
  }) => {
    markerCalls.push({ animate, driverNumber: dot.number, durationMs, x: dot.x, y: dot.y })
    return createElement('g', { 'data-testid': `marker-${dot.number}` })
  }
}))

import { TrackMap } from '@renderer/widgets/TrackMap'

const SESSION: SessionInfo = {
  id: 'session-a',
  meetingId: 'meeting-a',
  name: 'Race',
  type: 'race',
  meetingName: 'Test Grand Prix',
  circuitName: 'Test Circuit',
  circuitShortName: 'Test',
  countryName: 'Test',
  countryCode: 'TST',
  location: 'Test',
  dateStart: '2026-01-01T00:00:00Z',
  dateEnd: '2026-01-01T02:00:00Z',
  gmtOffset: '+00:00:00',
  year: 2026,
  totalLaps: 50,
  provider: 'f1live'
}

const DRIVER: Driver = {
  number: 4,
  code: 'NOR',
  firstName: 'Lando',
  lastName: 'Norris',
  fullName: 'Lando Norris',
  broadcastName: 'L. Norris',
  teamName: 'McLaren',
  teamColour: 'FF8000',
  headshotUrl: null,
  countryCode: 'GBR'
}

const EMPTY_SECTOR = { seconds: null, state: 'none' as const }

const TIMING_ENTRY: TimingEntry = {
  driverNumber: 4,
  position: 1,
  gapToLeader: 0,
  intervalAhead: null,
  lastLap: null,
  bestLap: null,
  lapNumber: 1,
  stintAge: null,
  lapsThisStint: null,
  compound: 'MEDIUM',
  sector1: EMPTY_SECTOR,
  sector2: EMPTY_SECTOR,
  sector3: EMPTY_SECTOR,
  status: 'RUNNING',
  inPit: false,
  pitStops: null,
  isFastestLap: false,
  isPersonalBestLap: false,
  penalty: null,
  underInvestigation: false,
  retired: false,
  energyPct: null,
  deployMode: null
}

function makePosition(position: Partial<PositionSample>): PositionSample {
  return {
    driverNumber: 4,
    date: '2026-01-01T00:00:00Z',
    x: null,
    y: null,
    z: null,
    position: 1,
    lapProgress: null,
    ...position
  }
}

function makeSnapshot(options: {
  live: boolean
  positions: readonly PositionSample[]
  trackPath?: readonly { x: number; y: number }[]
}): RaceSnapshot {
  const availability = emptyAvailability()
  availability.timing = true
  availability.laps = true
  availability.stints = true
  availability.intervals = true
  availability.positions = true
  availability.live = options.live
  return {
    session: SESSION,
    drivers: [DRIVER],
    timing: [TIMING_ENTRY],
    laps: [],
    stints: [],
    raceControl: [],
    weather: null,
    weatherHistory: [],
    positions: [...options.positions],
    trackPath: [
      ...(options.trackPath ?? [
        { x: 0, y: 0 },
        { x: 1_000, y: 1_000 }
      ])
    ],
    availability,
    clock: 0,
    currentLap: 1,
    totalLaps: 50,
    trackStatus: 'CLEAR'
  }
}

function renderTrackMap(snapshot: RaceSnapshot, playing: boolean, reducedMotion: boolean): void {
  useSessionStore.setState({
    snapshot,
    playing,
    focusDriver: null,
    setFocusDriver: vi.fn()
  })
  useSettingsStore.setState({
    favorites: [],
    performanceMode: false,
    theme: { ...DEFAULT_THEME, reducedMotion }
  })
  render(createElement(TrackMap))
}

describe('TrackMap interpolation', () => {
  beforeEach(() => {
    markerCalls.length = 0
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('animates genuine live position updates even when replay playback is paused', () => {
    const snapshot = makeSnapshot({
      live: true,
      positions: [makePosition({ x: 100, y: 200 })]
    })

    renderTrackMap(snapshot, false, false)

    expect(markerCalls).toMatchObject([{ animate: true, driverNumber: 4, durationMs: 900 }])
  })

  it('keeps paused replay coordinates static when the snapshot is not live', () => {
    const snapshot = makeSnapshot({
      live: false,
      positions: [makePosition({ x: 100, y: 200 })]
    })

    renderTrackMap(snapshot, false, false)

    expect(markerCalls).toMatchObject([{ animate: false, driverNumber: 4, durationMs: 280 }])
  })

  it('keeps the shorter replay interpolation while playback is running', () => {
    const snapshot = makeSnapshot({
      live: false,
      positions: [makePosition({ x: 100, y: 200 })]
    })

    renderTrackMap(snapshot, true, false)

    expect(markerCalls).toMatchObject([{ animate: true, driverNumber: 4, durationMs: 280 }])
  })

  it('disables live interpolation when reduced motion is enabled', () => {
    const snapshot = makeSnapshot({
      live: true,
      positions: [makePosition({ x: 100, y: 200 })]
    })

    renderTrackMap(snapshot, false, true)

    expect(markerCalls).toMatchObject([{ animate: false, driverNumber: 4, durationMs: 900 }])
  })

  it('still renders driver dots before a closed track outline exists', () => {
    // Live positions are real even before the outline traces — hiding the
    // whole field for however long closure takes is worse than a map with
    // no track shape yet: it looks like the map broke, not like it's working.
    const snapshot = makeSnapshot({
      live: true,
      positions: [makePosition({ x: 100, y: 200 })],
      trackPath: []
    })

    renderTrackMap(snapshot, false, false)

    expect(markerCalls).toMatchObject([{ animate: true, driverNumber: 4, durationMs: 900 }])
  })

  it('does not shrink the frame (and strand cars outside it) when the outline first appears', () => {
    // Reproduces a real reported case: cars already tracked far from the
    // origin suddenly rendered outside the drawn outline the moment it first
    // appeared. Cause: the frame's sticky bounds were reset to the outline's
    // OWN (narrower, newly-adopted) bounds instead of being unioned with
    // whatever had already been accumulated from live car positions.
    const farDriver = makePosition({ x: 5_000, y: 5_000 })

    // Tick 1: no outline yet. Bounds accumulate from this car's real position.
    renderTrackMap(
      makeSnapshot({ live: true, positions: [farDriver], trackPath: [] }),
      false,
      false
    )
    const beforeOutline = markerCalls.at(-1)!
    expect(beforeOutline.x).toBeGreaterThan(0)
    expect(beforeOutline.x).toBeLessThan(300)
    expect(beforeOutline.y).toBeGreaterThan(0)
    expect(beforeOutline.y).toBeLessThan(200)

    // Tick 2: a small outline near the origin — far from where this car has
    // been the whole time — becomes available. The car must still render
    // inside the viewBox, not snap outside it because the frame reset to fit
    // only the new, narrower outline.
    act(() => {
      useSessionStore.setState({
        snapshot: makeSnapshot({
          live: true,
          positions: [farDriver],
          trackPath: [
            { x: 0, y: 0 },
            { x: 10, y: 10 },
            { x: 20, y: 0 }
          ]
        })
      })
    })

    const afterOutline = markerCalls.at(-1)!
    expect(afterOutline.x).toBeGreaterThanOrEqual(0)
    expect(afterOutline.x).toBeLessThanOrEqual(300)
    expect(afterOutline.y).toBeGreaterThanOrEqual(0)
    expect(afterOutline.y).toBeLessThanOrEqual(200)
  })
})
