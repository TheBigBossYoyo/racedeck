import { createElement } from 'react'
import { act, cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Driver, RaceControlMessage, SectorTime, TimingEntry } from '@shared/models'
import type { RaceSnapshot } from '@renderer/core/providers/types'
import { emptyAvailability } from '@renderer/core/providers/types'
import type { AlertEvent } from '@renderer/core/engines/AlertEngine'
import type { QualifyingBoard } from '@renderer/core/engines/QualifyingEngine'
import type { PaceRival } from '@renderer/core/engines/StrategyEngine'
import { useSessionStore } from '@renderer/store/sessionStore'
import { useSettingsStore } from '@renderer/store/settingsStore'
import { useAlertStore } from '@renderer/store/alertStore'
import { StatusDot } from '@renderer/components/ui/primitives'
import { AlertCenter } from '@renderer/widgets/AlertCenter'
import { RaceControlFeed } from '@renderer/widgets/RaceControlFeed'
import { BattleLine } from '@renderer/widgets/driverDossier/DossierDetails'

const board = vi.hoisted(() => ({ current: null as QualifyingBoard | null }))

vi.mock('@renderer/core/engines/QualifyingEngine', () => ({
  buildQualifyingBoard: () => board.current,
  buildQualifyingFocusProjection: () => null,
  estimateTrackEvolution: () => null
}))

vi.mock('@renderer/widgets/trackMap/TrackMapDriverMarker', () => ({
  TrackMapDriverMarker: () => null
}))

import { QualifyingMonitor } from '@renderer/widgets/QualifyingMonitor'
import { TrackMap } from '@renderer/widgets/TrackMap'

const NO_SECTOR: SectorTime = { seconds: null, state: 'none' }

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
  } as unknown as Driver
}

function entry(driverNumber: number): TimingEntry {
  return {
    driverNumber,
    position: driverNumber,
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
  } as TimingEntry
}

function snapshot(over: Partial<RaceSnapshot> = {}): RaceSnapshot {
  const availability = emptyAvailability()
  availability.timing = true
  return {
    session: { id: 'live', type: 'race', year: 2026, provider: 'test' },
    drivers: [driver(1, 'AAA'), driver(2, 'BBB')],
    timing: [entry(1), entry(2)],
    laps: [],
    stints: [],
    raceControl: [],
    weather: null,
    weatherHistory: [],
    positions: [],
    availability,
    clock: 0,
    currentLap: 10,
    totalLaps: 50,
    trackStatus: 'CLEAR',
    ...over
  } as unknown as RaceSnapshot
}

afterEach(cleanup)

describe('StatusDot', () => {
  it('is hidden from assistive tech when adjacent text already says the state', () => {
    const { container } = render(createElement(StatusDot, { tone: 'good' }))
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true')
  })

  it('carries a text alternative when it stands alone', () => {
    render(createElement(StatusDot, { tone: 'danger', label: 'Disconnected' }))
    const dot = screen.getByRole('img', { name: 'Disconnected' })
    expect(dot).toHaveAttribute('title', 'Disconnected')
  })
})

describe('Alert Center', () => {
  // AlertCenter marks alerts seen from an effect, which updates the store on mount.
  const renderAlerts = (): void => {
    act(() => {
      render(createElement(AlertCenter))
    })
  }
  const alert = (id: string, severity: AlertEvent['severity'], title: string): AlertEvent => ({
    id,
    type: 'safety-car',
    title,
    detail: 'detail',
    severity,
    driverNumbers: [],
    at: '2026-01-01T00:00:00Z',
    seenAt: Date.now()
  })

  beforeEach(() => {
    useAlertStore.setState({
      alerts: [alert('a', 'critical', 'Red flag'), alert('b', 'notice', 'Fastest lap')],
      muted: false
    })
  })
  afterEach(() => {
    cleanup() // unmount first: resetting the store under a mounted widget updates it outside act
    useAlertStore.setState({ alerts: [], muted: false })
  })

  it('states severity in text, since the border and icon only carry colour and kind', () => {
    renderAlerts()
    expect(screen.getByText('Critical:', { exact: false })).toBeInTheDocument()
    expect(screen.getByText('Notice:', { exact: false })).toBeInTheDocument()
  })

  it('names the dismiss button by alert and keeps it reachable when not hovered', () => {
    renderAlerts()
    const dismiss = screen.getByRole('button', { name: 'Dismiss alert: Red flag' })
    // Hidden until hover for the mouse, but revealed by keyboard focus.
    expect(dismiss.className).toContain('opacity-0')
    expect(dismiss.className).toContain('focus-visible:opacity-100')
    expect(dismiss.className).toContain('focus-visible:ring-2')
  })

  it('exposes the mute toggle as a pressed state instead of only a bell swap', () => {
    renderAlerts()
    const mute = screen.getByRole('button', { name: 'Mute alerts' })
    expect(mute).toHaveAttribute('aria-pressed', 'false')
    act(() => useAlertStore.setState({ muted: true }))
    expect(screen.getByRole('button', { name: 'Unmute alerts' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
  })
})

describe('Race control feed', () => {
  it('prefixes warning and critical messages with their severity in text', () => {
    const msg = (id: string, severity: RaceControlMessage['severity']): RaceControlMessage =>
      ({
        id,
        date: '2026-01-01T00:00:00Z',
        category: 'Flag',
        message: `message ${id}`,
        flag: 'NONE',
        scope: null,
        sector: null,
        driverNumber: null,
        lapNumber: null,
        severity
      }) as RaceControlMessage
    const availability = emptyAvailability()
    availability.raceControl = true
    useSessionStore.setState({
      snapshot: snapshot({
        availability,
        raceControl: [msg('crit', 'critical'), msg('warn', 'warning'), msg('info', 'info')]
      })
    })
    render(createElement(RaceControlFeed))
    expect(screen.getByText('message crit').textContent).toBe('Critical: message crit')
    expect(screen.getByText('message warn').textContent).toBe('Warning: message warn')
    // Unmarked default: no invented label.
    expect(screen.getByText('message info').textContent).toBe('message info')
  })
})

describe('Dossier battle line', () => {
  const rival = (over: Partial<PaceRival>): PaceRival => ({
    number: 2,
    code: 'BBB',
    gapSec: 1.2,
    deltaPerLap: 0.15,
    rivalPace: 90,
    closing: true,
    lapsToResolve: null,
    ...over
  })

  it('says a closing rival is closing rather than only tinting the trend green or red', () => {
    render(createElement(BattleLine, { icon: null, label: 'ahead', rival: rival({}), side: 'ahead' }))
    expect(screen.getByText('closing,', { exact: false })).toHaveClass('sr-only')
  })

  it('adds nothing for a rival that is not closing', () => {
    render(
      createElement(BattleLine, {
        icon: null,
        label: 'ahead',
        rival: rival({ closing: false, deltaPerLap: -0.1 }),
        side: 'ahead'
      })
    )
    expect(screen.queryByText('closing,', { exact: false })).toBeNull()
  })
})

describe('Qualifying monitor', () => {
  const row = (over: Partial<QualifyingBoard['rows'][number]>) => ({
    driverNumber: 1,
    position: 1,
    bestLap: 80,
    gapToFastest: 0,
    deltaToCutoff: -0.2,
    sectors: ['session-best', 'personal-best', 'none'] as const,
    state: 'HOT LAP' as const,
    stateIsEstimate: false,
    atRisk: false,
    bubble: false,
    fastest: true,
    ...over
  })

  beforeEach(() => {
    board.current = {
      stage: 1,
      cutoffPosition: 1,
      cutoffTime: 80,
      fastestTime: 80,
      rows: [
        row({ sectors: ['session-best', 'personal-best', 'none'] }),
        row({
          driverNumber: 2,
          position: 2,
          fastest: false,
          bubble: true,
          atRisk: true,
          deltaToCutoff: 0.3,
          sectors: ['none', 'none', 'none']
        })
      ]
    } as unknown as QualifyingBoard
    useSessionStore.setState({
      snapshot: snapshot({ session: { id: 'q', type: 'qualifying', year: 2026 } as never }),
      focusDriver: 2,
      timeline: null
    })
  })

  it('labels every sector box with its state, not just a fill colour', () => {
    render(createElement(QualifyingMonitor))
    const first = screen.getByRole('button', { name: /AAA/ })
    const boxes = within(first).getAllByRole('img')
    expect(boxes.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Sector 1: session best',
      'Sector 2: personal best',
      'Sector 3: no time yet'
    ])
    // A pattern (ring), not only a different hue, separates session best from personal best.
    expect(boxes[0].className).toContain('ring-2')
    expect(boxes[1].className).not.toContain('ring-2')
  })

  it('says a driver is on the bubble and exposes the focused row with a focus ring', () => {
    render(createElement(QualifyingMonitor))
    const bubbleRow = screen.getByRole('button', { name: /BBB/ })
    expect(within(bubbleRow).getByText('on the cut-off bubble', { exact: false })).toHaveClass(
      'sr-only'
    )
    expect(bubbleRow).toHaveAttribute('aria-pressed', 'true')
    expect(bubbleRow.className).toContain('focus-visible:ring-2')
  })
})

describe('Track map', () => {
  it('names the map with the track status its amber/red halo would otherwise be the only sign of', () => {
    const availability = emptyAvailability()
    availability.timing = true
    availability.positions = true
    useSessionStore.setState({
      snapshot: snapshot({ availability, trackStatus: 'SAFETY_CAR' }),
      focusDriver: null,
      playing: false
    })
    useSettingsStore.setState({ favorites: [] })
    render(createElement(TrackMap))
    expect(screen.getByRole('group', { name: 'Track map, safety car deployed' })).toBeTruthy()
  })

  it('stays a plain "Track map" under green running', () => {
    const availability = emptyAvailability()
    availability.timing = true
    availability.positions = true
    useSessionStore.setState({
      snapshot: snapshot({ availability, trackStatus: 'CLEAR' }),
      focusDriver: null,
      playing: false
    })
    render(createElement(TrackMap))
    expect(screen.getByRole('group', { name: 'Track map' })).toBeTruthy()
  })
})
