import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WeatherSample } from '@shared/models'
import type { RaceSnapshot } from '@renderer/core/providers/types'
import { emptyAvailability } from '@renderer/core/providers/types'
import {
  convertPressure,
  convertWind,
  defaultUnitsConfig,
  formatPressure,
  formatPressureValue,
  formatWind,
  formatWindValue,
  normalizeUnitsConfig,
  pressureUnitLabel,
  windUnitLabel
} from '@renderer/lib/units'
import { persist } from '@renderer/store/persist'
import { STORE_NS } from '@shared/ipc-contract'
import { useSessionStore } from '@renderer/store/sessionStore'
import { useSettingsStore } from '@renderer/store/settingsStore'
import { WeatherPanel } from '@renderer/widgets/WeatherPanel'
import { UnitsSection } from '@renderer/components/settings/UnitsSection'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  useSettingsStore.setState({ units: defaultUnitsConfig() })
})

describe('defaults keep the previous output byte-identical', () => {
  it('defaults to m/s and mbar', () => {
    expect(defaultUnitsConfig()).toEqual({
      temperature: 'c',
      speed: 'kmh',
      clock: 'local',
      wind: 'ms',
      pressure: 'mbar'
    })
  })

  // The old WeatherPanel rendered `windSpeed?.toFixed(1)` + "m/s" and
  // `pressure?.toFixed(0)` + "mb"; the defaults must reproduce those strings exactly.
  it.each([0, 0.4, 1.25, 3.05, 7.96, 12.3456, 33])('wind %s m/s renders as before', (v) => {
    const { wind } = defaultUnitsConfig()
    expect(formatWindValue(v, wind)).toBe(v.toFixed(1))
    expect(windUnitLabel(wind)).toBe('m/s')
    expect(formatWind(v, wind)).toBe(`${v.toFixed(1)} m/s`)
  })

  it.each([985, 1008.4, 1013.5, 1020.49, 999.5])('pressure %s mbar renders as before', (v) => {
    const { pressure } = defaultUnitsConfig()
    expect(formatPressureValue(v, pressure)).toBe(v.toFixed(0))
    expect(pressureUnitLabel(pressure)).toBe('mb')
  })

  it('shows the same placeholder for missing values', () => {
    const d = defaultUnitsConfig()
    expect(formatWindValue(null, d.wind)).toBe('—')
    expect(formatWindValue(undefined, d.wind)).toBe('—')
    expect(formatWindValue(NaN, d.wind)).toBe('—')
    expect(formatWind(null, d.wind)).toBe('—')
    expect(formatPressureValue(null, d.pressure)).toBe('—')
    expect(formatPressure(undefined, d.pressure)).toBe('—')
  })
})

describe('wind conversion', () => {
  it('converts from m/s', () => {
    expect(convertWind(10, 'ms')).toBe(10)
    expect(convertWind(10, 'kmh')).toBeCloseTo(36, 6)
    expect(convertWind(10, 'mph')).toBeCloseTo(22.36936, 4)
    expect(convertWind(10, 'kn')).toBeCloseTo(19.43844, 4)
  })

  it('formats with one decimal and the right label', () => {
    expect(formatWind(2.5, 'kmh')).toBe('9.0 km/h')
    expect(formatWind(2.5, 'mph')).toBe('5.6 mph')
    expect(formatWind(2.5, 'kn')).toBe('4.9 kn')
  })

  it('treats an unknown unit as the default rather than guessing', () => {
    expect(formatWind(2.5, 'furlongs' as never)).toBe('2.5 m/s')
    expect(formatWind(2.5, undefined as never)).toBe('2.5 m/s')
  })
})

describe('pressure conversion', () => {
  it('converts from mbar', () => {
    expect(convertPressure(1013.25, 'mbar')).toBe(1013.25)
    expect(convertPressure(1013.25, 'inHg')).toBeCloseTo(29.921, 3)
    expect(convertPressure(1013.25, 'kPa')).toBeCloseTo(101.325, 6)
  })

  it('formats with a precision that suits each unit', () => {
    expect(formatPressure(1013.25, 'mbar')).toBe('1013 mb')
    expect(formatPressure(1013.25, 'inHg')).toBe('29.92 inHg')
    expect(formatPressure(1013.25, 'kPa')).toBe('101.3 kPa')
  })

  it('treats an unknown unit as the default rather than guessing', () => {
    expect(formatPressure(1013.25, 'atm' as never)).toBe('1013 mb')
    expect(formatPressure(1013.25, undefined as never)).toBe('1013 mb')
  })
})

describe('normalizeUnitsConfig for wind and pressure', () => {
  it('gives old saved settings (no wind/pressure) the defaults and keeps their other fields', () => {
    expect(normalizeUnitsConfig({ temperature: 'f', speed: 'mph', clock: 'utc' })).toEqual({
      temperature: 'f',
      speed: 'mph',
      clock: 'utc',
      wind: 'ms',
      pressure: 'mbar'
    })
  })

  it('preserves every valid value', () => {
    for (const wind of ['ms', 'kmh', 'mph', 'kn'] as const) {
      expect(normalizeUnitsConfig({ wind }).wind).toBe(wind)
    }
    for (const pressure of ['mbar', 'inHg', 'kPa'] as const) {
      expect(normalizeUnitsConfig({ pressure }).pressure).toBe(pressure)
    }
  })

  it('falls back to defaults for unknown or wrongly typed values', () => {
    const bad = normalizeUnitsConfig({ wind: 'beaufort', pressure: 'psi' } as never)
    expect(bad.wind).toBe('ms')
    expect(bad.pressure).toBe('mbar')
    const wrongType = normalizeUnitsConfig({ wind: 3, pressure: null } as never)
    expect(wrongType.wind).toBe('ms')
    expect(wrongType.pressure).toBe('mbar')
  })

  it('normalises persisted settings through the store on hydrate', async () => {
    persist.set(STORE_NS.SETTINGS, 'units', { temperature: 'f', wind: 'kn', pressure: 'psi' })
    await useSettingsStore.getState().hydrate()
    expect(useSettingsStore.getState().units).toEqual({
      temperature: 'f',
      speed: 'kmh',
      clock: 'local',
      wind: 'kn',
      pressure: 'mbar'
    })
  })

  it('setUnits normalises a patch', () => {
    useSettingsStore.getState().setUnits({ wind: 'kmh', pressure: 'psi' as never })
    expect(useSettingsStore.getState().units.wind).toBe('kmh')
    expect(useSettingsStore.getState().units.pressure).toBe('mbar')
  })
})

describe('WeatherPanel wind / pressure display', () => {
  const sample = (minute: number, windSpeed: number): WeatherSample => ({
    date: `2026-03-01T14:0${minute}:00.000Z`,
    airTemp: 24,
    trackTemp: 40,
    humidity: 40,
    pressure: 1013.25,
    windSpeed,
    windDirection: 90.4,
    rainfall: false
  })

  const load = () => {
    const availability = emptyAvailability()
    availability.weather = true
    const history = [sample(1, 2), sample(2, 2.25), sample(3, 2.5)]
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
  }

  const statValue = (label: string): string => {
    const stat = screen.getByText(label, { selector: 'span' }).parentElement as HTMLElement
    return stat.textContent ?? ''
  }

  it('renders exactly what it did before under the default settings', () => {
    load()
    render(createElement(WeatherPanel))
    expect(statValue('Wind')).toBe('Wind2.5m/s')
    expect(statValue('Pressure')).toBe('Pressure1013mb')
    expect(statValue('Dir')).toBe('Dir90°')
    expect(screen.getByText('2.5 m/s')).toBeInTheDocument() // trend footer
  })

  it('follows the wind and pressure settings', () => {
    load()
    useSettingsStore.setState({ units: { ...defaultUnitsConfig(), wind: 'kmh', pressure: 'inHg' } })
    render(createElement(WeatherPanel))
    expect(statValue('Wind')).toBe('Wind9.0km/h')
    expect(statValue('Pressure')).toBe('Pressure29.92inHg')
    expect(screen.getByText('9.0 km/h')).toBeInTheDocument()
  })

  it('still renders when saved settings predate the new fields', () => {
    load()
    useSettingsStore.setState({
      units: { temperature: 'c', speed: 'kmh', clock: 'local' } as never
    })
    render(createElement(WeatherPanel))
    expect(statValue('Wind')).toBe('Wind2.5m/s')
    expect(statValue('Pressure')).toBe('Pressure1013mb')
  })

  it('keeps the unit next to the em dash when a reading is missing, as before', () => {
    load()
    const snap = useSessionStore.getState().snapshot as RaceSnapshot
    useSessionStore.setState({
      snapshot: { ...snap, weather: { ...snap.weather!, windSpeed: null, pressure: null } } as RaceSnapshot
    })
    render(createElement(WeatherPanel))
    expect(statValue('Wind')).toBe('Wind—m/s')
    expect(statValue('Pressure')).toBe('Pressure—mb')
  })
})

// Segmented's group has no accessible name of its own, so find it through its row label.
const rowGroup = (label: string): HTMLElement =>
  within(screen.getByText(label).parentElement as HTMLElement).getByRole('group')

describe('UnitsSection pickers', () => {
  it('offers wind and pressure choices and writes them to the store', () => {
    render(createElement(UnitsSection))

    const windGroup = rowGroup('Wind speed')
    for (const label of ['m/s', 'km/h', 'mph', 'kn']) {
      expect(within(windGroup).getByRole('button', { name: label })).toBeInTheDocument()
    }
    fireEvent.click(within(windGroup).getByRole('button', { name: 'kn' }))
    expect(useSettingsStore.getState().units.wind).toBe('kn')

    const pressureGroup = rowGroup('Pressure')
    for (const label of ['mbar', 'inHg', 'kPa']) {
      expect(within(pressureGroup).getByRole('button', { name: label })).toBeInTheDocument()
    }
    fireEvent.click(within(pressureGroup).getByRole('button', { name: 'inHg' }))
    expect(useSettingsStore.getState().units.pressure).toBe('inHg')
  })
})
