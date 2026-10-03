import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Driver, SectorTime, Stint, TimingEntry } from '@shared/models'
import type { RaceSnapshot } from '@renderer/core/providers/types'
import { emptyAvailability } from '@renderer/core/providers/types'
import { useSessionStore } from '@renderer/store/sessionStore'
import { useSettingsStore } from '@renderer/store/settingsStore'
import { useStrategyStore } from '@renderer/store/strategyStore'
import { Segmented } from '@renderer/components/ui/primitives'
import { Slider } from '@renderer/components/ui/controls'
import { DialogContent, Dialog } from '@renderer/components/ui/Dialog'
import { TimingTower } from '@renderer/widgets/TimingTower'
import { PitEventLogPanel, pitLogRowLabel } from '@renderer/widgets/PitEventLogPanel'
import { TyreStrategyTable, strategyRowLabel } from '@renderer/widgets/TyreStrategyTable'
import {
  TrackMapDriverMarker,
  trackMapMarkerLabel
} from '@renderer/widgets/trackMap/TrackMapDriverMarker'
import { DriverSelect } from '@renderer/widgets/DriverComparisonCard'
import { raceAt } from './fixtures/pit-log-race'

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

function stint(driverNumber: number, lapStart: number, lapEnd: number | null, compound: string): Stint {
  return {
    driverNumber,
    stintNumber: 1,
    lapStart,
    lapEnd,
    tyre: { compound, age: 0 },
    degradationPerLap: null
  } as unknown as Stint
}

function snapshot(over: Partial<RaceSnapshot> = {}): RaceSnapshot {
  const availability = emptyAvailability()
  availability.timing = true
  availability.stints = true
  return {
    session: { id: 'live', type: 'race', year: 2026, provider: 'test' },
    drivers: [driver(1, 'AAA'), driver(2, 'BBB'), driver(3, 'CCC')],
    timing: [entry(1), entry(2), entry(3)],
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

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Timing tower row keyboard access', () => {
  beforeEach(() => {
    useSessionStore.setState({ snapshot: snapshot(), focusDriver: 2 })
    useSettingsStore.setState({ favorites: [], toggleFavorite: vi.fn() })
    useStrategyStore.setState({ selectedDriver: null })
  })

  it('renders each driver row as a real, tabbable button with a visible focus ring', () => {
    render(createElement(TimingTower))
    const row = screen.getByRole('button', { name: 'Focus AAA' })
    expect(row.tagName).toBe('BUTTON')
    expect(row.tabIndex).toBeGreaterThanOrEqual(0)
    expect(row.className).toContain('focus-visible:ring-2')
    // Inset, so the ring is not clipped by the scrolling panel body.
    expect(row.className).toContain('focus-visible:ring-inset')
  })

  it('exposes which driver is focused without relying on the row tint', () => {
    render(createElement(TimingTower))
    expect(screen.getByRole('button', { name: 'Focus BBB' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Focus AAA' })).toHaveAttribute(
      'aria-pressed',
      'false'
    )
  })

  it('keeps the row button before its favourite toggle in tab order, per row', () => {
    render(createElement(TimingTower))
    const focusable = screen
      .getAllByRole('button')
      .filter((b) => /^(Focus|Add) /.test(b.getAttribute('aria-label') ?? ''))
      .map((b) => b.getAttribute('aria-label'))
    expect(focusable).toEqual([
      'Focus AAA',
      'Add AAA to favorites',
      'Focus BBB',
      'Add BBB to favorites',
      'Focus CCC',
      'Add CCC to favorites'
    ])
  })

  it('picks a driver when the row is activated', () => {
    render(createElement(TimingTower))
    const row = screen.getByRole('button', { name: 'Focus CCC' })
    row.focus()
    expect(document.activeElement).toBe(row)
    fireEvent.click(row)
    expect(useSessionStore.getState().focusDriver).toBe(3)
  })
})

describe('Track map marker keyboard access', () => {
  const dot = {
    number: 4,
    code: 'NOR',
    color: '#ff8000',
    x: 10,
    y: 20,
    position: 3,
    isRetired: false,
    isInPit: false,
    isFastestLap: false
  }
  const renderMarker = (over: Partial<typeof dot & { extrapolated: boolean }>, onFocus = vi.fn()) => {
    render(
      createElement(
        'svg',
        null,
        createElement(TrackMapDriverMarker, {
          dot: { ...dot, ...over },
          focused: false,
          favorite: false,
          animate: false,
          durationMs: 0,
          onFocus
        })
      )
    )
    return { onFocus, marker: screen.getByRole('button') }
  }

  it('is focusable and activates on Enter and Space, but not on other keys', () => {
    const { onFocus, marker } = renderMarker({})
    expect(marker.getAttribute('tabindex')).toBe('0')
    fireEvent.keyDown(marker, { key: 'Enter' })
    fireEvent.keyDown(marker, { key: ' ' })
    fireEvent.keyDown(marker, { key: 'a' })
    expect(onFocus).toHaveBeenCalledTimes(2)
    expect(onFocus).toHaveBeenCalledWith(4)
  })

  it('spells out pit / retired / favourite state that the dot shows only by fade or ring', () => {
    expect(trackMapMarkerLabel(dot, false)).toBe('NOR, position 3')
    expect(trackMapMarkerLabel({ ...dot, isInPit: true }, false)).toBe('NOR, position 3, in the pits')
    expect(trackMapMarkerLabel({ ...dot, isRetired: true, isInPit: true }, false)).toBe(
      'NOR, position 3, retired'
    )
    expect(trackMapMarkerLabel({ ...dot, isFastestLap: true }, true)).toBe(
      'NOR, position 3, fastest lap, favourite'
    )
    expect(trackMapMarkerLabel({ ...dot, position: null, extrapolated: true }, false)).toBe(
      'NOR, position unknown, estimated position — feed stalled'
    )
  })

  it('reports whether it is the focused driver', () => {
    render(
      createElement(
        'svg',
        null,
        createElement(TrackMapDriverMarker, {
          dot,
          focused: true,
          favorite: false,
          animate: false,
          durationMs: 0,
          onFocus: vi.fn()
        })
      )
    )
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('Pit log row', () => {
  it('names the row with its stop details, not only the driver code', () => {
    const rows = raceAt(2100)
    const snap = rows
    useSessionStore.setState({ snapshot: snap, clock: 2100, currentSession: { id: 's1' } as never })
    render(createElement(PitEventLogPanel))
    const list = within(screen.getByRole('list', { name: /pit stops/i }))
    const buttons = list.getAllByRole('button')
    expect(buttons[1].getAttribute('aria-label')).toMatch(/^D1, lap \d+ to lap \d+/)
    expect(buttons[1].getAttribute('aria-label')).toContain('24.3 seconds in the pit lane')
    expect(buttons[1].className).toContain('focus-visible:ring-2')
  })

  it('leaves out fields the feed did not report instead of reading them as values', () => {
    const label = pitLogRowLabel(
      {
        key: 'k',
        driverNumber: 1,
        lapIn: null,
        lapOut: null,
        durationSec: null,
        compoundBefore: null,
        compoundAfter: null,
        ongoing: true
      } as never,
      'D1'
    )
    expect(label).toBe('D1, in the pits now')
  })
})

describe('Tyre strategy row', () => {
  beforeEach(() => {
    useSessionStore.setState({
      snapshot: snapshot({
        stints: [stint(1, 1, 12, 'MEDIUM'), stint(1, 13, null, 'HARD')],
        currentLap: 30
      }),
      focusDriver: 1
    })
  })

  it('states each stint in text so compound is not carried by bar colour alone', () => {
    render(createElement(TyreStrategyTable))
    const row = screen.getByRole('button', { name: /^AAA:/ })
    expect(row.getAttribute('aria-label')).toBe('AAA: MEDIUM laps 1 to 12, then HARD laps 13 to 30')
    expect(row).toHaveAttribute('aria-pressed', 'true')
    expect(row.className).toContain('focus-visible:ring-2')
  })

  it('uses the current lap for an open stint', () => {
    expect(strategyRowLabel('AAA', [stint(1, 5, null, 'SOFT')], 20)).toBe('AAA: SOFT laps 5 to 20')
  })
})

describe('Segmented control', () => {
  it('is a group of buttons whose pressed state is exposed and which take a focus ring', () => {
    const onChange = vi.fn()
    render(
      createElement(Segmented<'a' | 'b'>, {
        value: 'a',
        onChange,
        options: [
          { value: 'a', label: 'One' },
          { value: 'b', label: 'Two' }
        ]
      })
    )
    const group = screen.getByRole('group')
    const [one, two] = within(group).getAllByRole('button')
    expect(one).toHaveAttribute('aria-pressed', 'true')
    expect(two).toHaveAttribute('aria-pressed', 'false')
    expect(one.className).toContain('focus-visible:ring-2')
    fireEvent.click(two)
    expect(onChange).toHaveBeenCalledWith('b')
  })
})

describe('Icon-only and unlabeled controls', () => {
  it('gives the dialog close button an accessible name', () => {
    render(
      createElement(
        Dialog,
        { open: true },
        createElement(DialogContent, { title: 'Hello', description: 'World' })
      )
    )
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy()
  })

  it('names the slider thumb when a label is supplied', () => {
    // Radix measures the thumb with ResizeObserver, which jsdom does not provide.
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      }
    )
    render(
      createElement(Slider, {
        min: 0,
        max: 10,
        step: 1,
        defaultValue: [3],
        'aria-label': 'Playback position'
      })
    )
    expect(screen.getAllByLabelText('Playback position').length).toBeGreaterThan(0)
    expect(screen.getByRole('slider', { name: 'Playback position' })).toBeTruthy()
  })

  it('names each driver select so the two comparison sides are distinguishable', () => {
    const drivers = [driver(1, 'AAA'), driver(2, 'BBB')]
    render(
      createElement(
        'div',
        null,
        createElement(DriverSelect, {
          drivers,
          value: 1,
          onChange: vi.fn(),
          color: '#fff',
          label: 'First driver'
        }),
        createElement(DriverSelect, {
          drivers,
          value: 2,
          onChange: vi.fn(),
          color: '#000',
          label: 'Second driver'
        })
      )
    )
    expect(screen.getByRole('combobox', { name: 'First driver' })).toHaveValue('1')
    expect(screen.getByRole('combobox', { name: 'Second driver' })).toHaveValue('2')
  })
})
