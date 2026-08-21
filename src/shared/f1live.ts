/**
 * F1 official live-timing archive — shared types + pure parsers.
 *
 * RaceDeck reads Formula 1's OWN official timing data from the open archive at
 * `livetiming.formula1.com/static/…` — the same source MultiViewer and FastF1
 * use. It is public and requires NO login, token, or credential (F1 TV is only
 * needed for video, which RaceDeck handles separately via TOD). This module
 * holds the plain, unit-tested parsing pieces shared by the main-process fetcher
 * and the renderer provider. Decompression of the `.z` feeds needs Node's zlib,
 * so it lives in the main process; everything here is dependency-free.
 */

export const F1_LIVETIMING_BASE = 'https://livetiming.formula1.com/static'

/** Feeds we consume (timing/tyres/weather/etc.). `.z` feeds are zlib-packed. */
export const F1_FEEDS = [
  'SessionInfo',
  'DriverList',
  'TimingData',
  'TimingAppData',
  'WeatherData',
  'RaceControlMessages',
  'TrackStatus',
  'LapCount',
  'SessionData',
  'ExtrapolatedClock'
] as const

export const F1_Z_FEEDS = ['Position.z', 'CarData.z'] as const

/** CarData channel ids → meaning (the standard F1 telemetry channel map). */
export const CAR_CHANNELS = {
  rpm: '0',
  speed: '2',
  gear: '3',
  throttle: '4',
  brake: '5',
  drs: '45'
} as const

export interface F1SessionSummary {
  /** Archive path, e.g. "2024/2024-12-08_Abu_Dhabi_Grand_Prix/2024-12-08_Race/". Used as the session id. */
  path: string
  key: number
  year: number
  meetingName: string
  meetingOfficialName: string | null
  /** Session name, e.g. "Race", "Qualifying", "Practice 1". */
  name: string
  /** Session type from the archive, e.g. "Race", "Qualifying", "Practice". */
  type: string
  number: number | null
  circuitShortName: string | null
  countryName: string | null
  countryCode: string | null
  location: string | null
  startDate: string | null
  endDate: string | null
  gmtOffset: string | null
  /** "Complete" for finished sessions; anything else ⇒ still live/generating. */
  archiveStatus: string | null
  /** Evidence that the SignalR live feed is actively streaming updates right now. */
  liveStreamActive?: boolean
  /**
   * The live feed's OWN archive path for this session (`SessionInfo.Path`), e.g.
   * "2026/2026-08-23_Dutch_Grand_Prix/2026-08-21_Practice_1/".
   *
   * `path` is forced to the literal "live" for a live session because the whole
   * app keys behaviour off that id, which leaves nothing to identify WHICH event
   * is being streamed. This carries the real path alongside so meeting-scoped
   * caches (the circuit outline) work live too. Null for archive sessions, where
   * `path` already is the archive path.
   */
  feedPath?: string | null
}

/** One timestamped point in a feed stream (t = seconds since feed start). */
export interface F1StreamPoint {
  t: number
  d: unknown
}

/** Everything the renderer provider needs to reconstruct a session. */
export interface F1SessionData {
  summary: F1SessionSummary
  sessionInfo: unknown
  /** topic → ascending-by-time incremental points (already decoded). */
  streams: Record<string, F1StreamPoint[]>
  duration: number
  /**
   * True when TimingData was committed as a validated-usable prefix while its
   * tail was still downloading; the renderer streams the remainder through the
   * enrichment chunk channel (feed `timing`) before marking the session loaded.
   * Absent/false when the feed was already complete at commit (the warm path).
   */
  partialTiming?: boolean
}

/** High-rate archive feeds loaded after core timing is already interactive. */
export interface F1SessionEnrichment {
  carData: F1StreamPoint[]
  position: F1StreamPoint[]
  duration: number
}

export interface F1SessionEnrichmentRequest {
  path: string
  feed: 'position' | 'carData' | 'timing'
  carDataOffset: number
  positionOffset: number
  timingOffset?: number
  limit: number
}

export interface F1SessionEnrichmentChunk extends F1SessionEnrichment {
  timing?: F1StreamPoint[]
  nextCarDataOffset: number
  nextPositionOffset: number
  nextTimingOffset?: number
  done: boolean
}

export interface F1LiveDataDelta extends F1SessionData {
  /** Topic lengths after this delta; send these back to request only newer points. */
  cursors: Record<string, number>
  generation: number
}

// ── Live (SignalR) connection status ─────────────────────────────────────────────

export type LiveState = 'idle' | 'connecting' | 'connected' | 'error' | 'closed'

export interface LiveStatus {
  state: LiveState
  detail: string | null
  sessionName: string | null
  /** Number of feed messages received. */
  messages: number
  /** True when we PRESENTED F1 credentials on the connection (cookies and/or token). */
  subscription: boolean
  /**
   * True once the GATED feeds (CarData/Position) actually start ARRIVING — the
   * only honest proof the F1 TV subscription opened the gate. F1 omits gated
   * topics silently rather than erroring, so `subscription` (we SENT a token)
   * must never be reported as "full data" on its own.
   */
  gatedData?: boolean
  /**
   * True only when the connected feed is an ACTUALLY-live session. F1's feed
   * always serves the last event's final snapshot when nothing is racing, so
   * `state === 'connected'` alone does not mean a session is live — this does.
   */
  live: boolean
  updatedAt: string
}

/**
 * The HONEST live-data tier for UI.
 *
 * - 'offline' — not connected to a genuinely live session.
 * - 'public'  — a live session on F1's free public timing feed. Complete and
 *               useful; just no car telemetry or positions.
 * - 'waiting' — we presented a subscription token but the gated feeds are not
 *               arriving. Usually an expired token (F1 rotates them ~weekly),
 *               which signing in again fixes.
 * - 'full'    — public timing PLUS telemetry and positions actually arriving.
 *
 * Never infer 'full' from `subscription` alone: F1 accepts the negotiate and then
 * silently withholds the gated topics, so only their arrival proves the gate.
 */
export function liveDataTier(
  live: boolean,
  subscription: boolean,
  gatedData: boolean
): 'full' | 'waiting' | 'public' | 'offline' {
  if (!live) return 'offline'
  if (gatedData) return 'full'
  return subscription ? 'waiting' : 'public'
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure parsers
// ─────────────────────────────────────────────────────────────────────────────

/** Strip a leading UTF-8 BOM (the F1 archive serves files with one). */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

/** "HH:MM:SS.mmm" (feed-elapsed) → seconds. Returns null when unparseable. */
export function parseTimecode(tc: string): number | null {
  const m = /^(\d{2}):(\d{2}):(\d{2})\.(\d{3})$/.exec(tc)
  if (!m) return null
  return +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000
}

/** Split one `.jsonStream` line into its timecode prefix and JSON remainder. */
export function splitStreamLine(line: string): { t: number; rest: string } | null {
  const m = /^(\d{2}:\d{2}:\d{2}\.\d{3})(.*)$/.exec(line)
  if (!m) return null
  const t = parseTimecode(m[1])
  if (t == null) return null
  return { t, rest: m[2] }
}

/**
 * Parse a plain (non-`.z`) `.jsonStream` file into time-ordered points. The `.z`
 * feeds are decoded in the main process (they need zlib), then fed through
 * `parseZStreamLine` per line.
 */
export function parseJsonStream(text: string): F1StreamPoint[] {
  const out: F1StreamPoint[] = []
  for (const raw of stripBom(text).split('\n')) {
    const line = raw.replace(/\r$/, '')
    if (!line.trim()) continue
    const split = splitStreamLine(line)
    if (!split) continue
    try {
      out.push({ t: split.t, d: JSON.parse(split.rest) })
    } catch {
      /* skip malformed line */
    }
  }
  return out
}

/**
 * The F1 SignalR recursive merge: `patch` is applied onto `base` in place.
 * Objects merge key-by-key; anything else overwrites. This is exactly how the
 * live feed's incremental updates accumulate into a full state. Mutates and
 * returns `base`.
 */
export function deepMergeF1(base: unknown, patch: unknown): unknown {
  if (Array.isArray(patch)) {
    if (!Array.isArray(base)) return patch
    const keys = Object.keys(patch).filter((key) => /^\d+$/.test(key))
    for (const key of keys) {
      const index = Number(key)
      const next = patch[index]
      const current = base[index]
      base[index] = isMergeable(next) && isMergeable(current)
        ? deepMergeF1(current, next)
        : next
    }
    return base
  }
  if (!isObject(patch)) return patch
  // An INDEXED-OBJECT patch onto an ARRAY base means "update these indices", not
  // "replace the whole array". F1 patches array fields this way constantly —
  // `{"Sectors":{"2":{...}}}` every time a driver completes a sector — and
  // falling through to the object branch below rebuilt the value as a plain
  // object containing ONLY the patched index, silently discarding the other
  // sectors (and segments, lap positions, stints…) until the next keyframe.
  if (Array.isArray(base) && isIndexedPatch(patch)) {
    for (const [k, v] of Object.entries(patch)) {
      if (!/^\d+$/.test(k)) continue
      const index = Number(k)
      const current = base[index]
      base[index] = isMergeable(v) && isMergeable(current) ? deepMergeF1(current, v) : v
    }
    return base
  }
  if (!isObject(base)) base = {}
  const b = base as Record<string, unknown>
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    // Feed data is remote input. Reject prototype-mutating keys before reading
    // b[k] or recursing: even the inherited `__proto__` getter is unsafe here.
    if (k === '__proto__' || k === 'prototype' || k === 'constructor') continue
    // The feed marks removals with a "_deleted" list.
    if (k === '_deleted' && Array.isArray(v)) {
      for (const key of v) {
        const safeKey = String(key)
        if (safeKey === '__proto__' || safeKey === 'prototype' || safeKey === 'constructor') continue
        delete b[safeKey]
      }
      continue
    }
    const ownValue = Object.prototype.hasOwnProperty.call(b, k) ? b[k] : undefined
    if (isMergeable(v) && isMergeable(ownValue)) {
      b[k] = deepMergeF1(ownValue, v)
    } else {
      b[k] = v
    }
  }
  return b
}

function isMergeable(v: unknown): v is Record<string, unknown> | unknown[] {
  return Array.isArray(v) || isObject(v)
}

/**
 * Is this patch addressing array positions? True when it has at least one key
 * and every key is a non-negative integer. A patch carrying any named key is a
 * real object and legitimately replaces an array base.
 */
function isIndexedPatch(patch: Record<string, unknown>): boolean {
  const keys = Object.keys(patch)
  return keys.length > 0 && keys.every((k) => /^\d+$/.test(k))
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Map a CarData channel-45 raw value to the 2026 active-aero mode.
 *
 * Channel-45 legacy values:
 *   0, 1        → closed             → Corner Mode (high downforce)
 *   8           → eligible           → Corner Mode (still closed)
 *   10, 12, 14  → open / active      → Straight Mode (low drag)
 *   other / null/undefined → unknown → null
 *
 * Return type is structurally compatible with the AeroMode union in shared/models.
 * Keep this function pure and dependency-free — it is unit-tested directly.
 */
export function ch45ToAeroMode(value: number | null | undefined): 'STRAIGHT' | 'CORNER' | null {
  if (value == null) return null
  if (value === 10 || value === 12 || value === 14) return 'STRAIGHT'
  if (value === 0 || value === 1 || value === 8) return 'CORNER'
  return null
}

// ── Session countdown (ExtrapolatedClock) ────────────────────────────────────
//
// F1's `ExtrapolatedClock` topic carries the SAME countdown shown on the world
// broadcast: `Remaining` ("HH:MM:SS"), `Extrapolating` (is the clock running),
// and `Utc`. During qualifying it resets per segment (Q1 18:00 / Q2 15:00 /
// Q3 12:00) and — crucially — FREEZES on a red flag (`Extrapolating: false`),
// which a duration-minus-elapsed estimate cannot do. We evaluate it against the
// playback clock (feed-elapsed seconds), so it is correct for live AND replay.

export interface SessionClockPoint {
  /** Feed-elapsed seconds when this clock value was published. */
  t: number
  /** Session/segment time remaining in seconds at time `t`. */
  remaining: number
  /** True while the clock is counting down; false when held (e.g. red flag). */
  extrapolating: boolean
}

export interface SessionClockRemaining {
  remaining: number
  extrapolating: boolean
}

/** Parse a clock string ("HH:MM:SS" / "H:MM:SS" / "MM:SS", optional ".mmm") → seconds. */
export function parseClockRemaining(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?$/.exec(value.trim())
  if (!m) return null
  const hours = m[1] ? +m[1] : 0
  const mins = +m[2]
  const secs = +m[3]
  const frac = m[4] ? +m[4].padEnd(3, '0') / 1000 : 0
  return hours * 3600 + mins * 60 + secs + frac
}

/**
 * Fold the incremental ExtrapolatedClock stream into time-ordered clock points.
 * The feed publishes deltas (e.g. just `{ Extrapolating: true }`), so we carry
 * state forward with the same recursive merge the live feed uses.
 */
export function parseSessionClock(points: F1StreamPoint[]): SessionClockPoint[] {
  const out: SessionClockPoint[] = []
  let state: Record<string, unknown> = {}
  for (const p of points) {
    state = deepMergeF1(state, p.d) as Record<string, unknown>
    const remaining = parseClockRemaining(state.Remaining)
    if (remaining == null) continue
    out.push({ t: p.t, remaining, extrapolating: state.Extrapolating === true })
  }
  return out
}

/**
 * Remaining session/segment time at playback time `t` (feed-elapsed seconds).
 * While extrapolating, we subtract the elapsed feed time since the last update;
 * while held (red flag / not running), the last published value stands.
 */
export function sessionClockRemainingAt(
  points: SessionClockPoint[],
  t: number
): SessionClockRemaining | null {
  let chosen: SessionClockPoint | null = null
  for (const p of points) {
    if (p.t > t + 1e-6) break
    chosen = p
  }
  if (!chosen) return null
  const elapsed = chosen.extrapolating ? Math.max(0, t - chosen.t) : 0
  return { remaining: Math.max(0, chosen.remaining - elapsed), extrapolating: chosen.extrapolating }
}

/** A numeric-string-keyed object (e.g. `{ "0": …, "1": … }`) → ordered array. */
export function indexedToArray<T = unknown>(obj: unknown): T[] {
  if (!Array.isArray(obj) && !isObject(obj)) return []
  return Object.keys(obj)
    .filter((k) => /^\d+$/.test(k))
    .sort((a, b) => +a - +b)
    .map((k) => (obj as Record<string, unknown>)[k] as T)
    .filter((value) => value != null)
}
