import type { PitLaneTime, TeamRadioClip, TrackStatus, WeatherSample } from '@shared/models'
import type { F1StreamPoint } from '@shared/f1live'
import { F1_LIVETIMING_BASE, indexedToArray } from '@shared/f1live'
import { numOrNull, rec } from './shared'

// ── series: weather / track status / lap count / race control ────────────────────

export function weatherAt(point: F1StreamPoint | null): WeatherSample | null {
  if (!point) return null
  const w = rec(point.d)
  return {
    date: new Date(point.t * 1000).toISOString(),
    airTemp: numOrNull(w.AirTemp),
    trackTemp: numOrNull(w.TrackTemp),
    humidity: numOrNull(w.Humidity),
    pressure: numOrNull(w.Pressure),
    windSpeed: numOrNull(w.WindSpeed),
    windDirection: numOrNull(w.WindDirection),
    rainfall: (numOrNull(w.Rainfall) ?? 0) > 0
  }
}

const TRACK_STATUS: Record<string, TrackStatus> = {
  '1': 'CLEAR',
  '2': 'YELLOW',
  '3': 'YELLOW',
  '4': 'SAFETY_CAR',
  '5': 'RED',
  '6': 'VSC',
  '7': 'VSC'
}

export function trackStatusAt(point: F1StreamPoint | null): TrackStatus {
  if (!point) return 'UNKNOWN'
  const s = String(rec(point.d).Status ?? '')
  // An unrecognized code must NEVER default to CLEAR — that's a false "all
  // clear" broadcast during whatever the unrecognized state actually is,
  // exactly backwards for a safety indicator. UNKNOWN honestly says "we
  // don't know" instead of asserting something that might be a red flag.
  return TRACK_STATUS[s] ?? 'UNKNOWN'
}

export function lapCountAt(point: F1StreamPoint | null): {
  current: number | null
  total: number | null
} {
  if (!point) return { current: null, total: null }
  const d = rec(point.d)
  return { current: numOrNull(d.CurrentLap), total: numOrNull(d.TotalLaps) }
}

/** Current qualifying segment from merged TimingData.SessionPart. */
export function qualifyingPartAt(timingState: unknown): 1 | 2 | 3 | null {
  const value = numOrNull(rec(timingState).SessionPart)
  return value === 1 || value === 2 || value === 3 ? value : null
}

/**
 * Accumulate measured pit-lane times from `PitLaneTimeCollection`.
 *
 * Deliberately NOT a merge: the feed publishes an entry while the car is in the
 * pit lane and then `_deleted`s it moments later, so merging would leave almost
 * nothing behind. Collecting every entry as it appears preserves the session's
 * full set of real pit-lane transits, keyed by driver + lap so repeats collapse.
 */
export function collectPitLaneTimes(points: F1StreamPoint[], tMax: number): PitLaneTime[] {
  const byKey = new Map<string, PitLaneTime>()
  for (const point of points) {
    if (point.t > tMax) break
    for (const [key, raw] of Object.entries(rec(rec(point.d).PitTimes))) {
      if (!/^\d+$/.test(key)) continue
      const entry = rec(raw)
      const duration = numOrNull(entry.Duration)
      if (duration == null || duration <= 0) continue
      const lap = numOrNull(entry.Lap)
      byKey.set(`${key}-${lap ?? '?'}`, { driverNumber: Number(key), duration, lap })
    }
  }
  return [...byKey.values()].sort((a, b) => (a.lap ?? 0) - (b.lap ?? 0))
}

/**
 * Team-radio captures with absolute, playable URLs.
 *
 * `sessionPath` is the feed's own archive path; the clips live beneath it on the
 * static host and ARE served during a live session (unlike the `.jsonStream`
 * files, which 403 until the archive is published).
 */
export function collectTeamRadio(
  points: F1StreamPoint[],
  tMax: number,
  sessionPath: string | null
): TeamRadioClip[] {
  if (!sessionPath) return []
  const base = `${F1_LIVETIMING_BASE}/${sessionPath.replace(/^\/+|\/+$/g, '')}/`
  const byPath = new Map<string, TeamRadioClip>()
  for (const point of points) {
    if (point.t > tMax) break
    const captures = rec(point.d).Captures
    for (const raw of indexedToArray(captures)) {
      const capture = rec(raw)
      const path = capture.Path
      const driverNumber = numOrNull(capture.RacingNumber)
      if (typeof path !== 'string' || !path || driverNumber == null) continue
      byPath.set(path, {
        driverNumber,
        utc: typeof capture.Utc === 'string' ? capture.Utc : '',
        url: base + path.replace(/^\/+/, '')
      })
    }
  }
  return [...byPath.values()].sort((a, b) => Date.parse(b.utc) - Date.parse(a.utc))
}

/** Latest short race-control ticker line (`TlaRcm`), e.g. "CLEAR IN TRACK SECTOR 12". */
export function latestTrackMessage(points: F1StreamPoint[], tMax: number): string | null {
  let message: string | null = null
  for (const point of points) {
    if (point.t > tMax) break
    const value = rec(point.d).Message
    if (typeof value === 'string' && value.trim()) message = value.trim()
  }
  return message
}
