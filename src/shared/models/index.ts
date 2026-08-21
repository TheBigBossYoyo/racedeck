/**
 * RaceDeck core data models.
 *
 * These are the internal, provider-agnostic representations used across the
 * whole app. Every DataProvider (OpenF1, Demo, or a user-connected live
 * provider) normalizes its raw payloads into THESE shapes. UI + engines only
 * ever see these types — never a provider's raw JSON.
 *
 * Design rules:
 *  - Times are seconds (number) unless a field name says otherwise (ms/ISO).
 *  - `null` means "known to be absent"; `undefined`/omitted means "not yet loaded".
 *  - Nothing here is faked: if a provider can't supply a field, it stays null
 *    and the DataAvailabilityMap flags the capability as unavailable.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Enumerations / unions
// ─────────────────────────────────────────────────────────────────────────────

export type SessionType =
  | 'practice'
  | 'qualifying'
  | 'sprint-qualifying'
  | 'sprint'
  | 'race'
  | 'testing'
  | 'unknown'

export type TyreCompound =
  | 'SOFT'
  | 'MEDIUM'
  | 'HARD'
  | 'INTERMEDIATE'
  | 'WET'
  | 'UNKNOWN'

export type FlagType =
  | 'GREEN'
  | 'YELLOW'
  | 'DOUBLE_YELLOW'
  | 'RED'
  | 'BLUE'
  | 'WHITE'
  | 'CHEQUERED'
  | 'BLACK'
  | 'BLACK_WHITE'
  | 'BLACK_ORANGE'
  | 'NONE'

export type TrackStatus =
  | 'CLEAR'
  | 'YELLOW'
  | 'VSC'
  | 'SAFETY_CAR'
  | 'RED'
  | 'UNKNOWN'

export type DriverStatus =
  | 'RUNNING'
  | 'IN_PIT'
  | 'OUT_LAP'
  | 'STOPPED'
  | 'RETIRED'
  | 'DNF'
  | 'DNS'
  | 'DSQ'
  | 'FINISHED'
  | 'UNKNOWN'

export type SectorState = 'none' | 'personal-best' | 'session-best'

/** Quality of the segment mini-marshalling colour from timing feeds. */
export type SegmentState =
  | 'not-set'
  | 'yellow'
  | 'green'
  | 'purple' // session best
  | 'pit'
  | 'unknown'

// ─────────────────────────────────────────────────────────────────────────────
// Session + driver
// ─────────────────────────────────────────────────────────────────────────────

export interface SessionInfo {
  /** Stable provider key (e.g. OpenF1 session_key as string). */
  id: string
  meetingId: string | null
  name: string
  type: SessionType
  /** Human meeting/GP name, e.g. "Belgian Grand Prix". */
  meetingName: string | null
  circuitName: string | null
  circuitShortName: string | null
  countryName: string | null
  countryCode: string | null
  location: string | null
  /** ISO timestamps. */
  dateStart: string | null
  dateEnd: string | null
  /** GMT offset like "+02:00:00". */
  gmtOffset: string | null
  year: number | null
  /** Total scheduled laps for a race (null for time-based / practice). */
  totalLaps: number | null
  provider: string
}

export interface Driver {
  /** Permanent car number as the stable id. */
  number: number
  /** 3-letter acronym, e.g. "VER". */
  code: string
  firstName: string | null
  lastName: string | null
  fullName: string
  broadcastName: string | null
  teamName: string | null
  /** Hex without leading '#', e.g. "3671C6". */
  teamColour: string | null
  headshotUrl: string | null
  countryCode: string | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Timing
// ─────────────────────────────────────────────────────────────────────────────

export interface SectorTime {
  /** Seconds, or null if not set this lap. */
  seconds: number | null
  state: SectorState
  /** Per-marshalling-segment colours (mini-sectors) if available. */
  segments?: SegmentState[]
}

export interface TimingEntry {
  driverNumber: number
  position: number | null
  /** Gap to leader in seconds; string for lapped ("+1 LAP"); null unknown. */
  gapToLeader: number | '+1 LAP' | null
  /** Interval to car ahead in seconds; string for lapped; null unknown. */
  intervalAhead: number | '+1 LAP' | null
  lastLap: number | null
  bestLap: number | null
  lapNumber: number | null
  /** Age (laps) of the current tyre SET, including laps run on it before this stint. */
  stintAge: number | null
  /**
   * Laps completed in the CURRENT stint (`stintAge` minus the set's age when the
   * stint began). Differs from `stintAge` whenever a used set is fitted, and is
   * the right number for slicing this stint's laps out of a driver's history —
   * `stintAge` would reach back into an earlier stint on the same compound.
   */
  lapsThisStint: number | null
  compound: TyreCompound | null
  sector1: SectorTime
  sector2: SectorTime
  sector3: SectorTime
  status: DriverStatus
  inPit: boolean
  pitStops: number | null
  /** True if this lap is the session's fastest lap holder. */
  isFastestLap: boolean
  isPersonalBestLap: boolean
  /** Active penalty text if any (e.g. "5s"). */
  penalty: string | null
  underInvestigation: boolean
  /** True if retired/stopped for good. */
  retired: boolean
  /**
   * Battery state of charge, 0–100 (2026's ~50%-electric power unit). null when
   * the source can't provide it (the public F1 feed doesn't expose battery, so
   * this is real only for providers that model it, e.g. the demo).
   */
  energyPct: number | null
  /** Current battery deployment mode. null when unavailable. */
  deployMode: EnergyMode | null
  /**
   * True when energyPct/deployMode are derived estimates (computed from
   * throttle/braking telemetry) rather than real battery telemetry. The public
   * F1 feed doesn't expose battery state, so real sessions use this model.
   * Absent (undefined) or false for the demo which uses a proper synthetic model.
   */
  energyIsEstimate?: boolean
}

/**
 * 2026 battery deployment modes. HARVEST recovers (MGU-K under braking/lift),
   * DEPLOY is normal electrical deployment, BOOST is the driver's manual
   * deployment control, and OVERTAKE is the separate within-1s overtaking aid
   * that replaced DRS.
 */
export type EnergyMode = 'HARVEST' | 'BALANCED' | 'DEPLOY' | 'BOOST' | 'OVERTAKE'

/**
 * 2026 active-aero mode derived from CarData channel 45.
 * STRAIGHT = low drag; CORNER = high downforce.
 * null = data absent or channel value unrecognised.
 */
export type AeroMode = 'STRAIGHT' | 'CORNER'

// ─────────────────────────────────────────────────────────────────────────────
// Laps / stints / tyres
// ─────────────────────────────────────────────────────────────────────────────

export interface LapSample {
  driverNumber: number
  lapNumber: number
  /** Total lap time in seconds; null if incomplete/invalid. */
  lapTime: number | null
  sector1: number | null
  sector2: number | null
  sector3: number | null
  /** Speed-trap / intermediate speeds (km/h). */
  speedI1: number | null
  speedI2: number | null
  speedST: number | null
  isPitOutLap: boolean
  isPitInLap: boolean
  compound: TyreCompound | null
  /** ISO timestamp the lap started. */
  dateStart: string | null
  /** Provider session-clock time (seconds) when the lap completed, when known. */
  sessionTime?: number | null
}

export interface TyreInfo {
  compound: TyreCompound
  /** Laps already on the set when the stint began. */
  ageAtStart: number
  isNew: boolean
}

export interface Stint {
  driverNumber: number
  stintNumber: number
  lapStart: number
  lapEnd: number | null
  tyre: TyreInfo
  /** Estimated degradation slope (s/lap); null if not computable. */
  degradationPerLap: number | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Race control / weather / positions / telemetry
// ─────────────────────────────────────────────────────────────────────────────

export interface RaceControlMessage {
  id: string
  /** ISO timestamp. */
  date: string
  /** Provider-normalized seconds since session feed start, when available. */
  sessionTime?: number
  category: string
  message: string
  flag: FlagType
  scope: string | null
  sector: number | null
  driverNumber: number | null
  lapNumber: number | null
  /** Derived importance for alerting/highlighting. */
  severity: 'info' | 'notice' | 'warning' | 'critical'
}

export interface WeatherSample {
  /** ISO timestamp. */
  date: string
  airTemp: number | null
  trackTemp: number | null
  humidity: number | null
  pressure: number | null
  windSpeed: number | null
  windDirection: number | null
  /** True when rainfall detected. */
  rainfall: boolean
}

export interface PositionSample {
  driverNumber: number
  /** ISO timestamp. */
  date: string
  /** Track-space coordinates (provider units). May be null if unavailable. */
  x: number | null
  y: number | null
  z: number | null
  /** Classification position at this time, if provided. */
  position: number | null
  /**
   * Normalized 0..1 progress around the lap when x/y are unavailable.
   * Enables the "simplified position-progress" track fallback — never faked,
   * only set when derivable from real lap/sector timing.
   */
  lapProgress: number | null
}

export interface TelemetrySample {
  driverNumber: number
  /** ISO timestamp. */
  date: string
  speed: number | null
  throttle: number | null
  brake: number | null
  gear: number | null
  rpm: number | null
  /** DRS raw code from feed (>=10 typically means active). */
  drs: number | null
  drsActive: boolean
  /**
   * 2026 active-aero mode derived from channel 45.
   * STRAIGHT = low-drag/open (ch45 10/12/14); CORNER = high-downforce/closed (0/1/8).
   * null when the provider cannot supply it or the value is unrecognised.
   */
  aeroMode: AeroMode | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Availability / sync / video state
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Declares, per capability, whether the CURRENT active provider+session can
 * supply that data. UI reads this to gracefully hide/disable widgets rather
 * than render fake data.
 */
export interface DataAvailabilityMap {
  timing: boolean
  laps: boolean
  stints: boolean
  intervals: boolean
  raceControl: boolean
  weather: boolean
  /** Real x/y track positions (live map). */
  positions: boolean
  /** Fallback progress-based positions from timing. */
  positionProgress: boolean
  telemetry: boolean
  /** Live (streaming) vs on-demand/historical. */
  live: boolean
}

export interface SyncState {
  /** Broadcast delay offset in seconds applied to align data → video. */
  offsetSeconds: number
  /** Which broadcaster this offset belongs to (e.g. "TOD"). */
  broadcaster: string
  /** Optional per-device / per-layout scoping key. */
  scopeKey: string | null
  /** ISO timestamp the offset was last set/confirmed. */
  updatedAt: string
  /** True while the user is actively running the sync wizard. */
  calibrating: boolean
}

export type VideoMode = 'embedded' | 'companion' | 'external' | 'none'

export type Tristate = 'yes' | 'no' | 'unknown'

export interface VideoModeState {
  mode: VideoMode
  /** The URL currently targeted (default TOD). */
  url: string
  playbackActive: Tristate
  /** Whether embedded (WebContentsView) mode is viable on this system/site. */
  embeddedSupported: Tristate
  /** Human-readable reason the app fell back from a richer mode. */
  fallbackReason: string | null
  /** True when the castLabs Widevine CDM is present & ready. */
  drmReady: boolean
  /** Last lifecycle event for diagnostics. */
  lastEvent: string | null
  updatedAt: string
}

// ── Feeds unlocked from F1's live timing stream ────────────────────────────────

/** One driver's classified position at the end of each lap (F1 `LapSeries`). */
export interface LapPositionSeries {
  driverNumber: number
  /** `positions[i]` is the position after lap `i + 1`; null when unclassified. */
  positions: (number | null)[]
}

/** A best mark plus where it ranks in the field. */
export interface RankedMark {
  value: number | null
  /** 1-based rank across the field, when the feed provides one. */
  rank: number | null
}

/**
 * Session bests for one driver from F1's `TimingStats` feed: personal best lap,
 * per-sector bests, and the four speed measurements (two intermediates, finish
 * line, and the speed trap) — none of which the app could derive from timing.
 */
export interface DriverSessionBests {
  driverNumber: number
  bestLap: RankedMark
  bestSectors: [RankedMark, RankedMark, RankedMark]
  /** Speeds in km/h: I1/I2 intermediates, FL finish line, ST speed trap. */
  speeds: { i1: RankedMark; i2: RankedMark; fl: RankedMark; st: RankedMark }
}

/**
 * A measured pit-lane transit (F1 `PitLaneTimeCollection`) — the REAL time lost,
 * entry to exit, rather than a modelled estimate. The feed publishes each entry
 * only briefly and then deletes it, so these must be accumulated as they appear.
 */
export interface PitLaneTime {
  driverNumber: number
  /** Total pit-lane time in seconds (typically ~20-35s). */
  duration: number
  lap: number | null
}

/** A team-radio capture (F1 `TeamRadio`), with a playable absolute URL. */
export interface TeamRadioClip {
  driverNumber: number
  /** Broadcast timestamp (ISO 8601, UTC). */
  utc: string
  /** Absolute URL of the mp3 on F1's static host. */
  url: string
}

/** Live tyre-set state for one driver (F1 `CurrentTyres`). */
export interface CurrentTyre {
  driverNumber: number
  compound: TyreCompound
  isNew: boolean
}
