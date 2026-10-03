import { createElement } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Driver, SectorTime, TimingEntry } from '@shared/models'
import type { RaceSnapshot } from '@renderer/core/providers/types'
import { emptyAvailability } from '@renderer/core/providers/types'
import { useSessionStore } from '@renderer/store/sessionStore'
import { useSettingsStore } from '@renderer/store/settingsStore'
import { TimingTower } from '@renderer/widgets/TimingTower'

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

function entry(driverNumber: number, over: Partial<TimingEntry> = {}): TimingEntry {
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
    deployMode: null,
    ...over
  } as TimingEntry
}

function snapshot(over: Partial<RaceSnapshot>): RaceSnapshot {
  const availability = emptyAvailability()
  availability.timing = true
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

function mount(snap: RaceSnapshot): void {
  useSessionStore.setState({ snapshot: snap, focusDriver: null })
  useSettingsStore.setState({ favorites: [], toggleFavorite: vi.fn() })
  render(createElement(TimingTower))
}

const rowFor = (code: string): HTMLElement =>
  screen.getByRole('button', { name: `Focus ${code}` }).closest('div.group') as HTMLElement

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('TimingTower per-driver staleness', () => {
  it('marks only the driver whose own data is stale while the feed is live, with text not just colour', () => {
    mount(
      snapshot({
        feedFreshness: { TimingData: 300, CarData: 300, Position: 300 },
        driverFreshness: {
          1: { TimingData: 200 },
          2: { TimingData: 18_400 },
          3: { TimingData: 900 }
        }
      })
    )

    const marker = rowFor('BBB').querySelector('[data-testid="driver-stale"]')
    expect(marker).not.toBeNull()
    expect(marker?.getAttribute('role')).toBe('img')
    expect(marker?.getAttribute('aria-label')).toBe('Stale data: timing 18s old')
    // The visible text carries the age, so meaning never depends on hue.
    expect(marker?.textContent).toBe('18s')
    expect(rowFor('AAA').querySelector('[data-testid="driver-stale"]')).toBeNull()
    expect(rowFor('CCC').querySelector('[data-testid="driver-stale"]')).toBeNull()
  })

  it('names every stale feed for that driver', () => {
    mount(
      snapshot({
        feedFreshness: { TimingData: 100, CarData: 100, Position: 100 },
        driverFreshness: { 1: { TimingData: 20_000, CarData: 9_000 } }
      })
    )
    expect(
      rowFor('AAA').querySelector('[data-testid="driver-stale"]')?.getAttribute('aria-label')
    ).toBe('Stale data: timing 20s old, telemetry 9s old')
  })

  it('shows nothing for a replay, where no freshness exists', () => {
    mount(snapshot({ feedFreshness: undefined, driverFreshness: undefined }))
    expect(document.querySelector('[data-testid="driver-stale"]')).toBeNull()
  })

  it('does not repeat the feed-level stale badge on every row when the whole feed stopped', () => {
    mount(
      snapshot({
        feedFreshness: { TimingData: 30_000 },
        driverFreshness: { 1: { TimingData: 30_000 }, 2: { TimingData: 30_000 } }
      })
    )
    expect(document.querySelector('[data-testid="driver-stale"]')).toBeNull()
  })

  it('does not flag a retired or pitted car, whose silence is expected', () => {
    mount(
      snapshot({
        timing: [entry(1, { retired: true }), entry(2, { inPit: true }), entry(3)],
        feedFreshness: { TimingData: 100 },
        driverFreshness: {
          1: { TimingData: 60_000 },
          2: { TimingData: 60_000 },
          3: { TimingData: 60_000 }
        }
      })
    )
    expect(rowFor('AAA').querySelector('[data-testid="driver-stale"]')).toBeNull()
    expect(rowFor('BBB').querySelector('[data-testid="driver-stale"]')).toBeNull()
    expect(rowFor('CCC').querySelector('[data-testid="driver-stale"]')).not.toBeNull()
  })
})

describe('TimingTower staleness ignores cars that are legitimately silent', () => {
  it.each(['STOPPED', 'DNS', 'DSQ', 'FINISHED'] as const)(
    'does not flag a %s car while the feed is live, but still flags a running one',
    (status) => {
      mount(
        snapshot({
          timing: [entry(1, { status }), entry(2), entry(3)],
          feedFreshness: { TimingData: 100, CarData: 100, Position: 100 },
          driverFreshness: {
            1: { TimingData: 60_000, CarData: 60_000, Position: 60_000 },
            2: { TimingData: 60_000 },
            3: { TimingData: 100 }
          }
        })
      )
      expect(rowFor('AAA').querySelector('[data-testid="driver-stale"]')).toBeNull()
      expect(rowFor('BBB').querySelector('[data-testid="driver-stale"]')).not.toBeNull()
      expect(rowFor('CCC').querySelector('[data-testid="driver-stale"]')).toBeNull()
    }
  )
})
