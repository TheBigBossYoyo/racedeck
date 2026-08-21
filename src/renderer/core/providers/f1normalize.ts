import type {
  LapPositionSeries,
  RankedMark,
  DriverSessionBests,
  PitLaneTime,
  TeamRadioClip,
  CurrentTyre,
  Driver,
  LapSample,
  RaceControlMessage,
  PositionSample,
  SectorTime,
  SessionInfo,
  SessionType,
  Stint,
  TimingEntry,
  TrackStatus,
  TyreCompound,
  WeatherSample,
  DriverStatus
} from '@shared/models'
import { teamColorFor } from '@shared/constants'
import type { F1SessionSummary, F1StreamPoint } from '@shared/f1live'
import { F1_LIVETIMING_BASE, deepMergeF1, indexedToArray } from '@shared/f1live'
import { normalizeCompound, normalizeFlag, raceControlSeverity } from './normalize'

/**
 * Pure normalizers: merged F1 live-feed state → RaceDeck models. Kept side-effect
 * free and unit-tested (tests/unit/f1normalize.test.ts). The stateful merging /
 * timeline replay lives in F1LiveProvider; these functions only map shapes.
 */

// ── scalar parsers ──────────────────────────────────────────────────────────────

/** F1 lap-time string → seconds. "1:23.456"→83.456, "23.456"→23.456, ""→null. */
export function parseLapTime(v: unknown): number | null {
  if (typeof v === 'number') return v > 0 ? v : null
  if (typeof v !== 'string' || !v.trim()) return null
  const parts = v.split(':')
  let sec = 0
  for (const p of parts) sec = sec * 60 + parseFloat(p)
  return isFinite(sec) && sec > 0 ? sec : null
}

/** F1 gap/interval string → seconds | '+1 LAP' | null. */
export function parseGap(v: unknown): number | '+1 LAP' | null {
  if (v == null) return null
  if (typeof v === 'number') return isFinite(v) ? v : null
  const s = String(v).trim()
  if (!s) return null
  const up = s.toUpperCase()
  if (up.includes('LAP') || /^\d+L$/.test(up)) return '+1 LAP'
  const n = parseFloat(s.replace('+', ''))
  return isFinite(n) ? n : null
}

function numOrNull(v: unknown): number | null {
  if (typeof v === 'number') return isFinite(v) ? v : null
  if (typeof v === 'string' && v.trim()) {
    const n = parseFloat(v)
    return isFinite(n) ? n : null
  }
  return null
}

// ── session + drivers ───────────────────────────────────────────────────────────

const rec = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' ? (v as Record<string, unknown>) : {}

function mapSessionType(type: string): SessionType {
  const s = type.toLowerCase()
  if (s.includes('sprint') && s.includes('qual')) return 'sprint-qualifying'
  if (s.includes('sprint')) return 'sprint'
  if (s.includes('qual')) return 'qualifying'
  if (s.includes('practice')) return 'practice'
  if (s.includes('race')) return 'race'
  return 'unknown'
}

export function normalizeSessionInfo(summary: F1SessionSummary): SessionInfo {
  return {
    id: summary.path,
    meetingId: String(summary.key || summary.path),
    name: summary.name,
    type: mapSessionType(summary.type),
    meetingName: summary.meetingName,
    circuitName: summary.circuitShortName,
    circuitShortName: summary.circuitShortName,
    countryName: summary.countryName,
    countryCode: summary.countryCode,
    location: summary.location,
    dateStart: summary.startDate,
    dateEnd: summary.endDate,
    gmtOffset: summary.gmtOffset,
    year: summary.year,
    totalLaps: null,
    provider: 'f1live'
  }
}

export function normalizeDrivers(driverState: unknown): Driver[] {
  const state = rec(driverState)
  const out: Driver[] = []
  for (const [num, raw] of Object.entries(state)) {
    if (!/^\d+$/.test(num)) continue
    const d = rec(raw)
    const teamName = (d.TeamName as string) ?? null
    out.push({
      number: +num,
      code: (d.Tla as string) ?? String(num),
      firstName: (d.FirstName as string) ?? null,
      lastName: (d.LastName as string) ?? null,
      fullName: (d.FullName as string) ?? `${d.FirstName ?? ''} ${d.LastName ?? ''}`.trim(),
      broadcastName: (d.BroadcastName as string) ?? null,
      teamName,
      teamColour: (d.TeamColour as string) ?? (teamName ? teamColorFor(teamName) : null),
      headshotUrl: (d.HeadshotUrl as string) ?? null,
      countryCode: (d.CountryCode as string) ?? null
    })
  }
  return out.sort((a, b) => a.number - b.number)
}

// ── stints / tyres ──────────────────────────────────────────────────────────────

interface DriverStint {
  compound: TyreCompound
  ageAtStart: number
  totalLaps: number
  isNew: boolean
}

/** Extract a driver's ordered stints from merged TimingAppData. */
export function driverStints(appLine: unknown): DriverStint[] {
  const stints = indexedToArray(rec(appLine).Stints)
  return stints.flatMap((raw) => {
    const s = rec(raw)
    if (Object.keys(s).length === 0) return []
    const total = numOrNull(s.TotalLaps) ?? 0
    const start = numOrNull(s.StartLaps) ?? 0
    return [{
      compound: normalizeCompound(s.Compound as string),
      ageAtStart: start,
      totalLaps: total,
      isNew: String(s.New).toLowerCase() === 'true' || start === 0
    }]
  })
}

/** Build Stint[] (with derived lap ranges) for all drivers from merged app state. */
export function buildStints(appState: unknown, drivers: Driver[]): Stint[] {
  const lines = rec(rec(appState).Lines)
  const out: Stint[] = []
  for (const d of drivers) {
    const stints = driverStints(lines[String(d.number)])
    let lapStart = 1
    stints.forEach((st, i) => {
      const lapsThisStint = Math.max(0, st.totalLaps - st.ageAtStart)
      const isLast = i === stints.length - 1
      const lapEnd = isLast ? null : lapStart + Math.max(0, lapsThisStint - 1)
      out.push({
        driverNumber: d.number,
        stintNumber: i + 1,
        lapStart,
        lapEnd,
        tyre: { compound: st.compound, ageAtStart: st.ageAtStart, isNew: st.isNew },
        degradationPerLap: null
      })
      lapStart += Math.max(1, lapsThisStint)
    })
  }
  return out
}

/**
 * Active stint for one driver from merged app state.
 *
 * `age` is the tyre SET's total age (F1's `TotalLaps` already counts laps run on
 * the set before this stint). `lapsThisStint` subtracts `StartLaps` to give laps
 * run since it was fitted — the two diverge on a used set, and conflating them
 * makes a stint appear to include laps from an earlier run on the same compound.
 */
export function currentStint(appLine: unknown): {
  compound: TyreCompound | null
  age: number | null
  lapsThisStint: number | null
  stops: number
} {
  const stints = driverStints(appLine)
  if (stints.length === 0)
    return { compound: null, age: null, lapsThisStint: null, stops: 0 }
  const active = stints[stints.length - 1]
  return {
    compound: active.compound,
    age: active.totalLaps,
    lapsThisStint: Math.max(0, active.totalLaps - active.ageAtStart),
    stops: stints.length - 1
  }
}

export function positionAvailability(positions: PositionSample[]): {
  positions: boolean
  positionProgress: boolean
} {
  return {
    positions: positions.some((position) => position.x != null && position.y != null),
    positionProgress: positions.some((position) => position.lapProgress != null)
  }
}

/** Assign at most one fastest lap once enough credible field data exists. */
export function assignCredibleFastestLap(entries: TimingEntry[]): void {
  for (const entry of entries) entry.isFastestLap = false
  const credibleBestLaps = entries.filter((entry) => entry.bestLap != null && entry.bestLap >= 40)
  const minimumCoverage = Math.max(2, Math.ceil(entries.length * 0.5))
  if (credibleBestLaps.length < minimumCoverage) return
  const fastestEntry = credibleBestLaps.reduce<TimingEntry | null>(
    (fastest, entry) =>
      entry.bestLap != null && (fastest?.bestLap == null || entry.bestLap < fastest.bestLap)
        ? entry
        : fastest,
    null
  )
  if (fastestEntry) fastestEntry.isFastestLap = true
}

// ── timing ──────────────────────────────────────────────────────────────────────

function sectorFrom(raw: unknown): SectorTime {
  const s = rec(raw)
  const seconds = parseLapTime(s.Value)
  // Segment mini-sector colours: F1 status 2048 = green, 2049 = purple(session best), 2064 = pit.
  const segments = indexedToArray(s.Segments).map((seg) => {
    const st = numOrNull(rec(seg).Status) ?? 0
    if (st === 2051 || st === 2049) return 'purple' as const
    if (st === 2048) return 'green' as const
    if (st === 2064) return 'pit' as const
    if (st === 2052) return 'yellow' as const
    return st === 0 ? ('not-set' as const) : ('unknown' as const)
  })
  const overall = s.OverallFastest === true
  const personal = s.PersonalFastest === true
  return {
    seconds,
    state: overall ? 'session-best' : personal ? 'personal-best' : 'none',
    segments: segments.length ? segments : undefined
  }
}

/**
 * Broadcast-accurate colour for a sector cell. The raw `SectorTime.state` only
 * distinguishes fastest sectors, so a normal race lap (no personal/overall best)
 * collapses to `'none'` and the whole timing tower renders grey. Real F1 timing
 * shows a *completed* sector in yellow, a personal best in green, the session
 * best in purple, and grey only for a sector not yet run this lap — with an
 * `'active'` tint while the car is mid-sector (segments lit, time not posted).
 */
export type SectorDisplayState =
  | 'session-best'
  | 'personal-best'
  | 'complete'
  | 'active'
  | 'none'

export function sectorDisplayState(sector: SectorTime): SectorDisplayState {
  if (sector.state === 'session-best') return 'session-best'
  if (sector.state === 'personal-best') return 'personal-best'
  // A posted time this lap that isn't a best → completed (yellow), the race norm.
  if (sector.seconds != null) return 'complete'
  // No time yet, but marshalling segments are lighting up → currently on it.
  if (sector.segments?.some((s) => s === 'green' || s === 'yellow' || s === 'purple' || s === 'pit')) {
    return 'active'
  }
  return 'none'
}

function driverStatus(line: Record<string, unknown>): DriverStatus {
  if (line.Retired === true) return 'RETIRED'
  if (line.Stopped === true) return 'STOPPED'
  if (line.InPit === true) return 'IN_PIT'
  if (line.PitOut === true) return 'OUT_LAP'
  return 'RUNNING'
}

/** Build the classification (TimingEntry[]) from merged timing + app state. */
export function buildTiming(
  timingState: unknown,
  appState: unknown,
  drivers: Driver[],
  raceControl: RaceControlMessage[] = []
): TimingEntry[] {
  const lines = rec(rec(timingState).Lines)
  const appLines = rec(rec(appState).Lines)
  const entries: TimingEntry[] = []

  for (const d of drivers) {
    const key = String(d.number)
    const line = rec(lines[key])
    if (Object.keys(line).length === 0) continue

    const position = numOrNull(line.Position)
    const isLeader = position === 1
    const interval = rec(line.IntervalToPositionAhead)
    const stint = currentStint(appLines[key])
    const last = rec(line.LastLapTime)
    const best = rec(line.BestLapTime)
    const sectors = indexedToArray(line.Sectors)

    entries.push({
      driverNumber: d.number,
      position,
      gapToLeader: isLeader ? 0 : parseGap(line.GapToLeader),
      intervalAhead: isLeader ? null : parseGap(interval.Value),
      lastLap: parseLapTime(last.Value),
      bestLap: parseLapTime(best.Value),
      lapNumber: numOrNull(line.NumberOfLaps),
      stintAge: stint.age,
      lapsThisStint: stint.lapsThisStint,
      compound: stint.compound,
      sector1: sectorFrom(sectors[0]),
      sector2: sectorFrom(sectors[1]),
      sector3: sectorFrom(sectors[2]),
      status: driverStatus(line),
      inPit: line.InPit === true,
      pitStops: numOrNull(line.NumberOfPitStops) ?? stint.stops,
      // Derived once across the completed classification below. Incremental F1
      // deltas can leave stale OverallFastest=true flags on multiple drivers.
      isFastestLap: false,
      isPersonalBestLap: last.PersonalFastest === true,
      penalty: null,
      underInvestigation: false,
      // `Stopped` is a transient timing state and does not mean the driver has
      // retired. Only the feed's explicit Retired flag should mark them OUT.
      retired: line.Retired === true,
      // The public F1 feed doesn't expose battery state of charge.
      energyPct: null,
      deployMode: null
    })
  }

  entries.sort((a, b) => {
    if (a.position != null && b.position != null && a.position !== b.position) {
      return a.position - b.position
    }
    if (a.position != null) return -1
    if (b.position != null) return 1
    const lapDelta = (b.lapNumber ?? 0) - (a.lapNumber ?? 0)
    if (lapDelta !== 0) return lapDelta
    const gapA = typeof a.gapToLeader === 'number' ? a.gapToLeader : Number.POSITIVE_INFINITY
    const gapB = typeof b.gapToLeader === 'number' ? b.gapToLeader : Number.POSITIVE_INFINITY
    if (gapA !== gapB) return gapA - gapB
    return a.driverNumber - b.driverNumber
  })
  // Partial timing deltas can temporarily contain duplicate/missing positions.
  // The sorted classification must still satisfy the UI invariant 1..N.
  entries.forEach((e, i) => {
    e.position = i + 1
    if (i === 0) {
      e.gapToLeader = 0
      e.intervalAhead = null
    }
  })
  // Sparse live deltas can repair the classification before their old gap fields
  // catch up. A leader gap must grow down the order and cannot be smaller than
  // the reported interval from the previous valid row.
  let previousGap = 0
  for (let index = 1; index < entries.length; index++) {
    const entry = entries[index]
    if (typeof entry.gapToLeader !== 'number') continue
    const interval = typeof entry.intervalAhead === 'number' ? entry.intervalAhead : null
    const minimumGap = previousGap + (interval != null ? Math.max(0.05, interval * 0.5) : 0.05)
    if (entry.gapToLeader + 0.01 < minimumGap) {
      entry.gapToLeader = null
    } else {
      previousGap = entry.gapToLeader
    }
  }
  assignCredibleFastestLap(entries)
  applyRaceControlState(entries, raceControl)
  return entries
}

/** Project issued penalties/investigations from Race Control onto timing rows. */
function applyRaceControlState(entries: TimingEntry[], messages: RaceControlMessage[]): void {
  const byDriver = new Map(entries.map((e) => [e.driverNumber, e]))
  const investigations = new Set<number>()
  const sanctions = new Map<number, { seconds: number; labels: Set<string> }>()
  for (const message of messages) {
    const text = message.message.toUpperCase()
    const driverNumber = message.driverNumber ?? extractCarNumber(text)
    if (driverNumber == null) continue
    const entry = byDriver.get(driverNumber)
    if (!entry) continue

    if (text.includes('NO FURTHER ACTION') || text.includes('NOT INVESTIGATED')) {
      investigations.delete(driverNumber)
    } else if (text.includes('INVESTIGAT')) {
      investigations.add(driverNumber)
    }

    const penaltySeconds = parseTimePenaltySeconds(text)
    if (penaltySeconds != null) {
      const sanction = sanctions.get(driverNumber) ?? { seconds: 0, labels: new Set<string>() }
      sanction.seconds += penaltySeconds
      sanctions.set(driverNumber, sanction)
      investigations.delete(driverNumber)
    } else if (text.includes('DRIVE THROUGH PENALTY')) {
      const sanction = sanctions.get(driverNumber) ?? { seconds: 0, labels: new Set<string>() }
      sanction.labels.add('DT')
      sanctions.set(driverNumber, sanction)
      investigations.delete(driverNumber)
    } else if (/STOP(?:\s|-)?GO PENALTY/.test(text)) {
      const sanction = sanctions.get(driverNumber) ?? { seconds: 0, labels: new Set<string>() }
      sanction.labels.add('SG')
      sanctions.set(driverNumber, sanction)
      investigations.delete(driverNumber)
    }
  }
  for (const entry of entries) {
    entry.underInvestigation = investigations.has(entry.driverNumber)
    const sanction = sanctions.get(entry.driverNumber)
    if (sanction) {
      entry.penalty = [sanction.seconds > 0 ? `${sanction.seconds}s` : '', ...sanction.labels]
        .filter(Boolean)
        .join(' · ')
    }
  }
}

function extractCarNumber(message: string): number | null {
  const match = /\bCAR\s+(\d{1,2})\b/i.exec(message)
  return match ? Number(match[1]) : null
}

function parseTimePenaltySeconds(message: string): number | null {
  if (!message.includes('PENALTY')) return null
  const match = /\b(\d+)\s*(?:SECOND|SECONDS|SEC|S)\b/i.exec(message)
  return match ? Number(match[1]) : null
}

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
  return TRACK_STATUS[s] ?? 'CLEAR'
}

export function lapCountAt(point: F1StreamPoint | null): { current: number | null; total: number | null } {
  if (!point) return { current: null, total: null }
  const d = rec(point.d)
  return { current: numOrNull(d.CurrentLap), total: numOrNull(d.TotalLaps) }
}

/** Current qualifying segment from merged TimingData.SessionPart. */
export function qualifyingPartAt(timingState: unknown): 1 | 2 | 3 | null {
  const value = numOrNull(rec(timingState).SessionPart)
  return value === 1 || value === 2 || value === 3 ? value : null
}

/** Accumulate race-control messages with timecode ≤ tMax into sorted models. */
export function collectRaceControl(points: F1StreamPoint[], tMax: number): RaceControlMessage[] {
  const byKey = new Map<string, RaceControlMessage>()
  let auto = 0
  for (const p of points) {
    if (p.t > tMax) break
    const msgs = rec(p.d).Messages
    const list = Array.isArray(msgs) ? msgs : indexedToArray(msgs)
    const keys = Array.isArray(msgs)
      ? msgs.map((_, i) => `arr-${i}`)
      : Object.keys(rec(msgs)).filter((k) => /^\d+$/.test(k))
    list.forEach((raw, i) => {
      const m = rec(raw)
      const flag = normalizeFlag(m.Flag as string)
      const key = keys[i] ?? `auto-${auto++}`
      byKey.set(key, {
        id: `rc-${key}`,
        date: (m.Utc as string) ?? new Date(p.t * 1000).toISOString(),
        sessionTime: p.t,
        category: (m.Category as string) ?? 'Other',
        message: (m.Message as string) ?? '',
        flag,
        scope: (m.Scope as string) ?? null,
        sector: numOrNull(m.Sector),
        driverNumber: numOrNull(m.RacingNumber),
        lapNumber: numOrNull(m.Lap),
        severity: raceControlSeverity(m.Category as string, flag, m.Message as string)
      })
    })
  }
  const ordered = [...byKey.values()].sort((a, b) => Date.parse(a.date) - Date.parse(b.date))
  const semantic = new Map<string, RaceControlMessage>()
  for (const message of ordered) {
    const key = raceControlSemanticKey(message)
    if (!semantic.has(key)) semantic.set(key, { ...message, id: `rc-${stableKey(key)}` })
  }
  return [...semantic.values()]
}

function raceControlSemanticKey(message: RaceControlMessage): string {
  if (message.flag === 'BLUE' || /\bBLUE FLAG\b/i.test(message.message)) {
    const car = message.driverNumber ?? extractCarNumber(message.message)
    // F1 may repeat an unchanged blue flag every few seconds. Collapse only for
    // the same target and lap; a new driver or lap remains a distinct event.
    return `blue|${car ?? 'field'}|${message.lapNumber ?? 'unknown'}|${message.scope ?? ''}|${message.sector ?? ''}`
  }
  return [
    message.date,
    message.category,
    message.flag,
    message.driverNumber ?? '',
    message.lapNumber ?? '',
    message.message.trim().toUpperCase()
  ].join('|')
}

function stableKey(value: string): string {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

/** Build one stable, bounded circuit trace from the decoded Position feed. */
export function buildTrackPath(
  points: F1StreamPoint[],
  maxPoints = 400,
  minDistance = 150
): { x: number; y: number }[] {
  if (points.length === 0) return []
  const presence = new Map<number, number>()
  for (const point of points.slice(0, 120)) {
    const entries = positionEntries(point.d)
    for (const [key, raw] of Object.entries(entries)) {
      if (!/^\d+$/.test(key)) continue
      const position = rec(raw)
      if (numOrNull(position.X) == null || numOrNull(position.Y) == null) continue
      const driverNumber = Number(key)
      presence.set(driverNumber, (presence.get(driverNumber) ?? 0) + 1)
    }
  }
  const referenceDriver = [...presence.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
  if (referenceDriver == null) return []

  const path: { x: number; y: number }[] = []
  for (const point of points) {
    const raw = rec(positionEntries(point.d)[String(referenceDriver)])
    const x = numOrNull(raw.X)
    const y = numOrNull(raw.Y)
    if (x == null || y == null) continue
    const previous = path[path.length - 1]
    if (!previous || Math.hypot(previous.x - x, previous.y - y) > minDistance) {
      path.push({ x, y })
      if (path.length >= maxPoints) break
    }
  }
  return path
}

/**
 * Shortest current F1 lap (Monaco) is ≈ 3.3 km; feed world coordinates are
 * ~decimetres, so a genuine full lap must cover well over 30,000 units.
 */
const MIN_CLOSED_LAP_UNITS = 30_000

/**
 * Build the circuit trace from a PARTIALLY downloaded Position feed, but only
 * once the reference car has demonstrably closed a full lap: the trace must
 * return near its starting point after covering at least a plausible F1 lap
 * distance. Returns null until then, so a partial download can never render a
 * partial circuit. Once accepted, the path is kept for the whole session (the
 * later data only re-traces the same circuit).
 */
export function buildClosedTrackPath(
  points: F1StreamPoint[],
  maxPoints = 400,
  minDistance = 150
): { x: number; y: number }[] | null {
  const path = buildTrackPath(points, maxPoints, minDistance)
  const closeDistance = Math.max(1, minDistance * 2)
  let travelled = 0
  for (let i = 1; i < path.length; i++) {
    travelled += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y)
    if (travelled < MIN_CLOSED_LAP_UNITS) continue
    if (Math.hypot(path[i].x - path[0].x, path[i].y - path[0].y) <= closeDistance) return path
  }
  return null
}

export interface PositionCoordinates {
  x: number | null
  y: number | null
  z: number | null
}

/** Interpolate one complete Position frame at an arbitrary replay clock. */
export function positionCoordinatesAt(
  points: F1StreamPoint[],
  clock: number
): Record<string, PositionCoordinates> {
  if (points.length === 0) return {}
  let lo = 0
  let hi = points.length - 1
  let previousIndex = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (points[mid].t <= clock) {
      previousIndex = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  if (previousIndex < 0) return {}

  const previous = points[previousIndex]
  const next = points[previousIndex + 1] ?? null
  const previousEntries = positionEntries(previous.d)
  const nextEntries = next ? positionEntries(next.d) : {}
  const fraction = next && next.t > previous.t
    ? Math.max(0, Math.min(1, (clock - previous.t) / (next.t - previous.t)))
    : 0
  const result: Record<string, PositionCoordinates> = {}

  for (const [driverNumber, raw] of Object.entries(previousEntries)) {
    if (!/^\d+$/.test(driverNumber)) continue
    const from = rec(raw)
    const to = rec(nextEntries[driverNumber])
    result[driverNumber] = {
      x: interpolateCoordinate(numOrNull(from.X), numOrNull(to.X), fraction),
      y: interpolateCoordinate(numOrNull(from.Y), numOrNull(to.Y), fraction),
      z: interpolateCoordinate(numOrNull(from.Z), numOrNull(to.Z), fraction)
    }
  }
  return result
}

function interpolateCoordinate(from: number | null, to: number | null, fraction: number): number | null {
  if (from == null) return null
  return to == null ? from : from + (to - from) * fraction
}

function positionEntries(value: unknown): Record<string, unknown> {
  const batches = indexedToArray(rec(value).Position)
  return rec(rec(batches[batches.length - 1]).Entries)
}

// ── lap history (from a forward scan) ────────────────────────────────────────────

export interface LapRecord {
  driverNumber: number
  lapNumber: number
  lapTime: number | null
  sector1: number | null
  sector2: number | null
  sector3: number | null
  compound: TyreCompound | null
  tComplete: number
}

export function lapRecordToSample(r: LapRecord): LapSample {
  return {
    driverNumber: r.driverNumber,
    lapNumber: r.lapNumber,
    lapTime: r.lapTime,
    sector1: r.sector1,
    sector2: r.sector2,
    sector3: r.sector3,
    speedI1: null,
    speedI2: null,
    speedST: null,
    isPitOutLap: false,
    isPitInLap: false,
    compound: r.compound,
    dateStart: null,
    sessionTime: r.tComplete
  }
}

// ── LapSeries / TimingStats / PitLaneTimeCollection / TeamRadio / CurrentTyres ──
//
// These feeds are pure additions from F1's live stream. Each is normalized here
// so both the live and archive providers get them from one tested place.

/**
 * F1's own per-lap classification (`LapSeries`), merged across deltas.
 *
 * Strictly better than deriving positions from accumulated lap times: it is the
 * official classification, and it covers the WHOLE session — so connecting to a
 * live feed part-way through still yields the full history rather than starting
 * from the moment we happened to connect.
 */
export function buildLapPositions(points: F1StreamPoint[], tMax: number): LapPositionSeries[] {
  let merged: unknown = {}
  for (const point of points) {
    if (point.t > tMax) break
    merged = deepMergeF1(merged, point.d)
  }
  const out: LapPositionSeries[] = []
  for (const [key, raw] of Object.entries(rec(merged))) {
    if (!/^\d+$/.test(key)) continue
    const line = rec(raw)
    // LapPosition starts as an array but deltas patch it as an INDEXED OBJECT
    // ({"12": "3"}). deepMergeF1 replaces the array wholesale in that case, so
    // the merged value may be either shape — indexedToArray accepts both.
    const laps = indexedToArray(line.LapPosition)
    if (laps.length === 0) continue
    out.push({
      driverNumber: Number(key),
      positions: laps.map((v) => {
        const n = numOrNull(v)
        return n != null && n > 0 ? n : null
      })
    })
  }
  return out
}

/** One `{Value, Position}` mark from TimingStats. */
function rankedMark(raw: unknown, parse: (v: unknown) => number | null): RankedMark {
  const m = rec(raw)
  return { value: parse(m.Value), rank: numOrNull(m.Position) }
}

/**
 * Per-driver session bests from `TimingStats` — including the speed-trap and
 * intermediate speeds, which cannot be derived from lap/sector timing at all.
 */
export function buildSessionBests(points: F1StreamPoint[], tMax: number): DriverSessionBests[] {
  let merged: unknown = {}
  for (const point of points) {
    if (point.t > tMax) break
    merged = deepMergeF1(merged, point.d)
  }
  const lines = rec(rec(merged).Lines)
  const out: DriverSessionBests[] = []
  for (const [key, raw] of Object.entries(lines)) {
    if (!/^\d+$/.test(key)) continue
    const line = rec(raw)
    const sectors = indexedToArray(line.BestSectors)
    const speeds = rec(line.BestSpeeds)
    out.push({
      driverNumber: Number(key),
      bestLap: rankedMark(line.PersonalBestLapTime, parseLapTime),
      bestSectors: [
        rankedMark(sectors[0], parseLapTime),
        rankedMark(sectors[1], parseLapTime),
        rankedMark(sectors[2], parseLapTime)
      ],
      speeds: {
        i1: rankedMark(speeds.I1, numOrNull),
        i2: rankedMark(speeds.I2, numOrNull),
        fl: rankedMark(speeds.FL, numOrNull),
        st: rankedMark(speeds.ST, numOrNull)
      }
    })
  }
  return out
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

/**
 * Live tyre-set state from `CurrentTyres`. This is F1's direct statement of what
 * is fitted right now, independent of the stint history reconstructed from
 * TimingAppData — useful both on its own and as a cross-check.
 */
export function buildCurrentTyres(points: F1StreamPoint[], tMax: number): CurrentTyre[] {
  let merged: unknown = {}
  for (const point of points) {
    if (point.t > tMax) break
    merged = deepMergeF1(merged, point.d)
  }
  const out: CurrentTyre[] = []
  for (const [key, raw] of Object.entries(rec(rec(merged).Tyres))) {
    if (!/^\d+$/.test(key)) continue
    const tyre = rec(raw)
    out.push({
      driverNumber: Number(key),
      compound: normalizeCompound(tyre.Compound as string),
      isNew: String(tyre.New).toLowerCase() === 'true'
    })
  }
  return out
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

/**
 * Fill in tyre compound from `CurrentTyres` where the stint reconstruction has
 * none.
 *
 * Stints are rebuilt from TimingAppData, which describes the session's stint
 * HISTORY — connect to a live feed part-way through and a driver's compound can
 * be missing or stale. `CurrentTyres` is F1 stating outright what is fitted right
 * now, so it is the better answer whenever the reconstruction has no opinion.
 * Deliberately only fills gaps: a known stint carries age with it, which this
 * feed does not, so it must not overwrite a good reconstruction.
 */
export function applyCurrentTyres(entries: TimingEntry[], tyres: CurrentTyre[]): void {
  if (tyres.length === 0) return
  const byDriver = new Map(tyres.map((t) => [t.driverNumber, t]))
  for (const entry of entries) {
    if (entry.compound != null && entry.compound !== 'UNKNOWN') continue
    const tyre = byDriver.get(entry.driverNumber)
    if (tyre && tyre.compound !== 'UNKNOWN') entry.compound = tyre.compound
  }
}

/**
 * Fill gaps in the driver list from `TopThree`.
 *
 * `TopThree` carries the same identity fields as DriverList (Tla, broadcast
 * name, team, colour) for the session's leading three. It is therefore mostly
 * redundant — but it is a genuinely independent copy, so it recovers identity for
 * a driver the DriverList keyframe has not (or not yet) described, which does
 * happen for stand-in entries in practice sessions. Gap-fill only: DriverList
 * stays authoritative wherever it has an entry.
 */
export function mergeTopThreeDrivers(
  drivers: Driver[],
  points: F1StreamPoint[],
  tMax: number
): Driver[] {
  let merged: unknown = {}
  for (const point of points) {
    if (point.t > tMax) break
    merged = deepMergeF1(merged, point.d)
  }
  // Same array-vs-indexed-object hazard as LapSeries: deltas patch Lines by index.
  const lines = indexedToArray(rec(merged).Lines)
  if (lines.length === 0) return drivers
  const known = new Set(drivers.map((d) => d.number))
  const added: Driver[] = []
  for (const raw of lines) {
    const line = rec(raw)
    const number = numOrNull(line.RacingNumber)
    if (number == null || known.has(number)) continue
    known.add(number)
    const teamName = (line.Team as string) ?? null
    added.push({
      number,
      code: (line.Tla as string) ?? String(number),
      firstName: (line.FirstName as string) ?? null,
      lastName: (line.LastName as string) ?? null,
      fullName:
        (line.FullName as string) ??
        `${line.FirstName ?? ''} ${line.LastName ?? ''}`.trim(),
      broadcastName: (line.BroadcastName as string) ?? null,
      teamName,
      teamColour: (line.TeamColour as string) ?? (teamName ? teamColorFor(teamName) : null),
      headshotUrl: null,
      countryCode: null
    })
  }
  return added.length > 0 ? [...drivers, ...added] : drivers
}
