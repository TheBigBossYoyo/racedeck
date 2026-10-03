/**
 * Centralized unit/format preferences (APP_IMPROVEMENT_ROADMAP.md P3 item 37).
 * Every temperature, speed, wind, pressure, and wall-clock display in the app
 * should read its unit from `useSettingsStore().units` and format through these
 * functions instead of hardcoding °C/km/h/local-time inline.
 */

export type TemperatureUnit = 'c' | 'f'
export type SpeedUnit = 'kmh' | 'mph'
export type ClockUnit = 'local' | 'utc'
/** The feed reports wind in m/s; the rest are display conversions. */
export type WindUnit = 'ms' | 'kmh' | 'mph' | 'kn'
/** The feed reports pressure in millibar (numerically identical to hPa). */
export type PressureUnit = 'mbar' | 'inHg' | 'kPa'

export interface UnitsConfig {
  temperature: TemperatureUnit
  speed: SpeedUnit
  clock: ClockUnit
  wind: WindUnit
  pressure: PressureUnit
}

export function defaultUnitsConfig(): UnitsConfig {
  return { temperature: 'c', speed: 'kmh', clock: 'local', wind: 'ms', pressure: 'mbar' }
}

const WIND_UNITS: readonly WindUnit[] = ['ms', 'kmh', 'mph', 'kn']
const PRESSURE_UNITS: readonly PressureUnit[] = ['mbar', 'inHg', 'kPa']

/** Unknown values (and fields missing from older saved settings) fall back to the default. */
function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback
}

export function normalizeUnitsConfig(value?: Partial<UnitsConfig> | null): UnitsConfig {
  const base = defaultUnitsConfig()
  return {
    temperature: value?.temperature === 'f' ? 'f' : base.temperature,
    speed: value?.speed === 'mph' ? 'mph' : base.speed,
    clock: value?.clock === 'utc' ? 'utc' : base.clock,
    wind: oneOf(value?.wind, WIND_UNITS, base.wind),
    pressure: oneOf(value?.pressure, PRESSURE_UNITS, base.pressure)
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

export function windUnitLabel(unit: WindUnit): string {
  switch (unit) {
    case 'kmh':
      return 'km/h'
    case 'mph':
      return 'mph'
    case 'kn':
      return 'kn'
    default:
      return 'm/s'
  }
}

/** m/s (the feed's native unit) → the display unit's numeric value. */
export function convertWind(ms: number, unit: WindUnit): number {
  switch (unit) {
    case 'kmh':
      return ms * 3.6
    case 'mph':
      return ms * 2.236936
    case 'kn':
      return ms * 1.943844
    default:
      return ms
  }
}

/** null-safe number text only ("2.5"), for callers that render the unit label separately. */
export function formatWindValue(ms: number | null | undefined, unit: WindUnit): string {
  if (ms == null || !isFinite(ms)) return '—'
  return convertWind(ms, unit).toFixed(1)
}

/** null-safe: 2.5 → "2.5 m/s" or "9.0 km/h". */
export function formatWind(ms: number | null | undefined, unit: WindUnit): string {
  if (ms == null || !isFinite(ms)) return '—'
  return `${formatWindValue(ms, unit)} ${windUnitLabel(unit)}`
}

// "mb", not "mbar", to match the label the weather panel always showed.
export function pressureUnitLabel(unit: PressureUnit): string {
  switch (unit) {
    case 'inHg':
      return 'inHg'
    case 'kPa':
      return 'kPa'
    default:
      return 'mb'
  }
}

/** mbar (the feed's native unit) → the display unit's numeric value. */
export function convertPressure(mbar: number, unit: PressureUnit): number {
  switch (unit) {
    case 'inHg':
      return mbar * 0.029529983
    case 'kPa':
      return mbar / 10
    default:
      return mbar
  }
}

function pressureDecimals(unit: PressureUnit): number {
  return unit === 'inHg' ? 2 : unit === 'kPa' ? 1 : 0
}

/** null-safe number text only ("1013"), for callers that render the unit label separately. */
export function formatPressureValue(mbar: number | null | undefined, unit: PressureUnit): string {
  if (mbar == null || !isFinite(mbar)) return '—'
  return convertPressure(mbar, unit).toFixed(pressureDecimals(unit))
}

/** null-safe: 1013.25 → "1013 mb" or "29.92 inHg". */
export function formatPressure(mbar: number | null | undefined, unit: PressureUnit): string {
  if (mbar == null || !isFinite(mbar)) return '—'
  return `${formatPressureValue(mbar, unit)} ${pressureUnitLabel(unit)}`
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

/**
 * Compact "HH:MM" wall-clock label for a timestamp (team-radio capture time).
 * `local` keeps the viewer's own locale format; `utc` pins the feed's timezone.
 * '--:--' when the timestamp is missing or unparseable.
 */
export function formatClockShort(
  timestamp: string | number | null | undefined,
  unit: ClockUnit = 'local'
): string {
  if (timestamp == null) return '--:--'
  const ms = typeof timestamp === 'number' ? timestamp : Date.parse(timestamp)
  if (!Number.isFinite(ms)) return '--:--'
  return new Date(ms).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: unit === 'utc' ? 'UTC' : undefined
  })
}
