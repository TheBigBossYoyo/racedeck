import { describe, expect, it } from 'vitest'
import {
  convertTemp,
  convertSpeed,
  formatTemp,
  formatSpeed,
  formatClock,
  normalizeUnitsConfig,
  defaultUnitsConfig
} from '@renderer/lib/units'

describe('convertTemp', () => {
  it('passes Celsius through unchanged', () => {
    expect(convertTemp(20, 'c')).toBe(20)
  })
  it('converts to Fahrenheit correctly', () => {
    expect(convertTemp(0, 'f')).toBe(32)
    expect(convertTemp(100, 'f')).toBe(212)
  })
})

describe('formatTemp', () => {
  it('formats with the right suffix per unit', () => {
    expect(formatTemp(23.4, 'c')).toBe('23.4°C')
    expect(formatTemp(0, 'f')).toBe('32.0°F')
  })
  it('returns an em dash for null/undefined/non-finite', () => {
    expect(formatTemp(null, 'c')).toBe('—')
    expect(formatTemp(undefined, 'c')).toBe('—')
    expect(formatTemp(NaN, 'c')).toBe('—')
  })
})

describe('convertSpeed', () => {
  it('passes km/h through unchanged', () => {
    expect(convertSpeed(300, 'kmh')).toBe(300)
  })
  it('converts to mph correctly', () => {
    expect(convertSpeed(100, 'mph')).toBeCloseTo(62.1371, 3)
  })
})

describe('formatSpeed', () => {
  it('formats with the right suffix per unit', () => {
    expect(formatSpeed(320, 'kmh')).toBe('320 km/h')
    expect(formatSpeed(100, 'mph')).toBe('62 mph')
  })
  it('returns an em dash for null/undefined/non-finite', () => {
    expect(formatSpeed(null, 'kmh')).toBe('—')
    expect(formatSpeed(undefined, 'kmh')).toBe('—')
  })
})

describe('formatClock', () => {
  const iso = '2026-03-01T14:05:33.000Z'

  it('defaults to local time when no unit is given', () => {
    expect(formatClock(iso)).toBe(formatClock(iso, 'local'))
  })
  it('formats UTC as 24h HH:MM:SS regardless of host timezone', () => {
    expect(formatClock(iso, 'utc')).toBe('14:05:33')
  })
  it('returns an em dash for null/invalid input', () => {
    expect(formatClock(null)).toBe('—')
    expect(formatClock('not-a-date')).toBe('—')
  })
})

describe('normalizeUnitsConfig', () => {
  it('falls back to defaults for missing/invalid fields', () => {
    expect(normalizeUnitsConfig(null)).toEqual(defaultUnitsConfig())
    expect(normalizeUnitsConfig({})).toEqual(defaultUnitsConfig())
    expect(normalizeUnitsConfig({ temperature: 'kelvin' as unknown as 'f' })).toEqual(
      defaultUnitsConfig()
    )
  })
  it('preserves valid values', () => {
    expect(normalizeUnitsConfig({ temperature: 'f', speed: 'mph', clock: 'utc' })).toEqual({
      temperature: 'f',
      speed: 'mph',
      clock: 'utc',
      wind: 'ms',
      pressure: 'mbar'
    })
  })
})
