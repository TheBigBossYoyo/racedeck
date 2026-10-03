import { createElement } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WeatherSample } from '@shared/models'
import type { RaceSnapshot } from '@renderer/core/providers/types'
import { emptyAvailability } from '@renderer/core/providers/types'
import { convertSpeed, defaultUnitsConfig, formatClockShort } from '@renderer/lib/units'
import { useSessionStore } from '@renderer/store/sessionStore'
import { useSettingsStore } from '@renderer/store/settingsStore'
import { useRadioPlaybackStore } from '@renderer/store/radioPlaybackStore'
import { speedTraceScale } from '@renderer/widgets/TelemetryTracePanel'
import { WeatherPanel } from '@renderer/widgets/WeatherPanel'
import { TeamRadioPanel } from '@renderer/widgets/TeamRadioPanel'

afterEach(() => {
  cleanup() // unmount before resetting stores, so widgets are not updated outside act
  vi.restoreAllMocks()
  useSettingsStore.setState({ units: defaultUnitsConfig() })
})

describe('formatClockShort', () => {
  const iso = '2026-03-01T14:05:33.000Z'

  it('is byte-identical to the previous inline radio-clip format under default (local) settings', () => {
    const previous = new Date(Date.parse(iso)).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit'
    })
    expect(formatClockShort(iso)).toBe(previous)
    expect(formatClockShort(iso, 'local')).toBe(previous)
  })

  it('pins the feed timezone for UTC regardless of the host zone', () => {
    const expected = new Date(iso).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'UTC'
    })
    expect(formatClockShort(iso, 'utc')).toBe(expected)
    expect(formatClockShort(iso, 'utc')).toMatch(/14:05|2:05/)
  })

  it('accepts epoch milliseconds', () => {
    expect(formatClockShort(Date.parse(iso), 'utc')).toBe(formatClockShort(iso, 'utc'))
  })

  it('is a placeholder, never a guess, for a missing or unparseable timestamp', () => {
    expect(formatClockShort(null)).toBe('--:--')
    expect(formatClockShort(undefined)).toBe('--:--')
    expect(formatClockShort('not a date')).toBe('--:--')
  })
})

describe('speedTraceScale', () => {
  it('passes the feed-native km/h through unchanged and keeps the 350 axis', () => {
    const scale = speedTraceScale('kmh')
    expect(scale.seriesName).toBe('Speed (km/h)')
    expect(scale.axisMax).toBe(350)
    for (const v of [0, 87, 312.4, 350]) expect(scale.convert(v)).toBe(v)
  })

  it('converts values and the axis ceiling together in mph so the trace is not clipped or squashed', () => {
    const scale = speedTraceScale('mph')
    expect(scale.seriesName).toBe('Speed (mph)')
    expect(scale.axisMax).toBe(Math.round(convertSpeed(350, 'mph')))
    expect(scale.axisMax).toBe(217)
    expect(scale.convert(350)).toBeLessThanOrEqual(scale.axisMax + 1)
    expect(scale.convert(100)).toBeCloseTo(62.1371, 3)
  })
})

describe('Weather sparkline colours', () => {
  const sample = (minute: number, trackTemp: number): WeatherSample => ({
    date: `2026-03-01T14:0${minute}:00.000Z`,
    airTemp: 24,
    trackTemp,
    humidity: 40,
    pressure: 1010,
    windSpeed: 2,
    windDirection: 90,
    rainfall: false
  })

  beforeEach(() => {
    const availability = emptyAvailability()
    availability.weather = true
    const history = [sample(1, 40), sample(2, 41), sample(3, 42)]
    useSessionStore.setState({
      snapshot: {
        session: { id: 's', type: 'race', year: 2026, provider: 'test' },
        drivers: [],
        timing: [],
        laps: [],
        stints: [],
        raceControl: [],
        weather: history[2],
        weatherHistory: history,
        positions: [],
        availability,
        clock: 0,
        currentLap: 1,
        totalLaps: 50,
        trackStatus: 'CLEAR'
      } as unknown as RaceSnapshot
    })
  })

  it('draws the track-temperature trace from the warn theme token, so it follows the light theme', () => {
    const { container } = render(createElement(WeatherPanel))
    const strokes = Array.from(container.querySelectorAll('svg[preserveAspectRatio="none"] path')).map(
      (p) => (p as SVGPathElement).getAttribute('style') ?? ''
    )
    // First sparkline is track temperature.
    expect(strokes[0]).toContain('rgb(var(--warn))')
    // `var()` cannot resolve in an SVG presentation attribute; it must not be set there.
    expect(container.querySelector('svg[preserveAspectRatio="none"] path')?.getAttribute('stroke')).toBeNull()
  })

  it('renders temperatures through the unit setting', () => {
    useSettingsStore.setState({
      units: { temperature: 'f', speed: 'kmh', clock: 'local' }
    })
    render(createElement(WeatherPanel))
    // 40°C track / 24°C air.
    expect(screen.getAllByText('75.2°F').length).toBeGreaterThan(0)
    expect(screen.getAllByText('107.6°F').length).toBeGreaterThan(0)
  })
})

describe('Team radio clip time', () => {
  const utc = '2026-03-01T14:05:33.000Z'

  beforeEach(() => {
    const availability = emptyAvailability()
    useSessionStore.setState({
      snapshot: {
        session: { id: 's', type: 'race', year: 2026, provider: 'test' },
        drivers: [
          {
            number: 1,
            code: 'AAA',
            firstName: null,
            lastName: null,
            fullName: 'AAA',
            broadcastName: null,
            teamName: null,
            teamColour: null,
            headshotUrl: null,
            countryCode: null
          }
        ],
        timing: [],
        laps: [],
        stints: [],
        raceControl: [],
        weather: null,
        weatherHistory: [],
        positions: [],
        teamRadio: [{ driverNumber: 1, utc, url: 'https://example.test/a.mp3' }],
        availability,
        clock: 0,
        currentLap: 1,
        totalLaps: 50,
        trackStatus: 'CLEAR'
      } as unknown as RaceSnapshot
    })
    useSettingsStore.setState({ favorites: [] })
    useRadioPlaybackStore.setState({ playingUrl: null })
  })

  it('follows the clock unit and names the play button with driver and time', () => {
    useSettingsStore.setState({ units: { temperature: 'c', speed: 'kmh', clock: 'utc' } })
    render(createElement(TeamRadioPanel))
    const time = formatClockShort(utc, 'utc')
    const button = screen.getByRole('button', { name: `Play radio clip from AAA at ${time}` })
    expect(button).toHaveAttribute('aria-pressed', 'false')
    expect(button.textContent).toContain(time)
  })

  it('shows the viewer-local time by default, matching the previous output', () => {
    render(createElement(TeamRadioPanel))
    const previous = new Date(Date.parse(utc)).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit'
    })
    expect(screen.getByRole('button', { name: /Play radio clip from AAA/ }).textContent).toContain(
      previous
    )
  })
})
