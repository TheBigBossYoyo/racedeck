/**
 * Centralized unit/format preferences (APP_IMPROVEMENT_ROADMAP.md P3 item 37).
 * Every temperature, speed, and wall-clock display in the app should read its
 * unit from `useSettingsStore().units` and format through these functions
 * instead of hardcoding °C/km/h/local-time inline.
 */

export type TemperatureUnit = 'c' | 'f'
export type SpeedUnit = 'kmh' | 'mph'
export type ClockUnit = 'local' | 'utc'

export interface UnitsConfig {
  temperature: TemperatureUnit
  speed: SpeedUnit
  clock: ClockUnit
}

export function defaultUnitsConfig(): UnitsConfig {
  return { temperature: 'c', speed: 'kmh', clock: 'local' }
}

export function normalizeUnitsConfig(value?: Partial<UnitsConfig> | null): UnitsConfig {
  const base = defaultUnitsConfig()
  return {
    temperature: value?.temperature === 'f' ? 'f' : base.temperature,
    speed: value?.speed === 'mph' ? 'mph' : base.speed,
    clock: value?.clock === 'utc' ? 'utc' : base.clock
  }
}

export function temperatureUnitLabel(unit: TemperatureUnit): string {
  return unit === 'f' ? '°F' : '°C'
}

/** Celsius (RaceSnapshot's native unit) → the display unit's numeric value. */
export function convertTemp(celsius: number, unit: TemperatureUnit): number {
  return unit === 'f' ? (celsius * 9) / 5 + 32 : celsius
}

/** null-safe: 23.4 → "23.4°C" or "74.1°F". */
export function formatTemp(celsius: number | null | undefined, unit: TemperatureUnit): string {
  if (celsius == null || !isFinite(celsius)) return '—'
  return `${convertTemp(celsius, unit).toFixed(1)}${temperatureUnitLabel(unit)}`
}

export function speedUnitLabel(unit: SpeedUnit): string {
  return unit === 'mph' ? 'mph' : 'km/h'
}

/** km/h (RaceSnapshot's native unit) → the display unit's numeric value. */
export function convertSpeed(kmh: number, unit: SpeedUnit): number {
  return unit === 'mph' ? kmh * 0.621371 : kmh
}

/** null-safe: 312 → "312 km/h" or "194 mph". */
export function formatSpeed(kmh: number | null | undefined, unit: SpeedUnit): string {
  if (kmh == null || !isFinite(kmh)) return '—'
  return `${convertSpeed(kmh, unit).toFixed(0)} ${speedUnitLabel(unit)}`
}

/**
 * ISO timestamp → "14:05:33" (24h). `unit` picks local device time (the
 * viewer's own timezone) or UTC (the feed's native timezone — no per-circuit
 * timezone data exists in the app, so "circuit time" isn't offered).
 */
export function formatClock(iso: string | null | undefined, unit: ClockUnit = 'local'): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleTimeString('en-GB', {
    hour12: false,
    timeZone: unit === 'utc' ? 'UTC' : undefined
  })
}
