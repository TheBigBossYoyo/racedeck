import type {
  SessionInfo,
  Driver,
  TimingEntry,
  LapSample,
  Stint,
  RaceControlMessage,
  WeatherSample,
  PositionSample,
  TelemetrySample,
  DataAvailabilityMap,
  TrackStatus,
  LapPositionSeries,
  DriverSessionBests,
  PitLaneTime,
  TeamRadioClip,
  CurrentTyre
} from '@shared/models'
import type { SessionTimeline } from '@renderer/core/engines/SessionPhaseEngine'
import type { SessionClockRemaining } from '@shared/f1live'

/**
 * Capability descriptor. Providers advertise what they can legally/technically
 * do; the UI uses these flags to enable/disable features and show risk badges.
 * (Directly informed by the "safe provider abstraction" research.)
 */
export interface ProviderCapabilities {
  id: string
  label: string
  description: string
  supportsHistorical: boolean
  supportsLive: boolean
  supportsReplay: boolean
  requiresAuth: boolean
  requiresSubscription: boolean
  /** Compliance/ToS risk surfaced to the user. */
  riskLevel: 'none' | 'low' | 'medium'
  latencyClass: 'instant' | 'near-real-time' | 'delayed' | 'historical'
}

/** A complete, normalized view of the session at one moment (session-clock t). */
export interface RaceSnapshot {
  session: SessionInfo
  drivers: Driver[]
  timing: TimingEntry[]
  laps: LapSample[]
  stints: Stint[]
  raceControl: RaceControlMessage[]
  weather: WeatherSample | null
  weatherHistory: WeatherSample[]
  positions: PositionSample[]
  /** Stable session-wide x/y circuit trace when the provider can precompute it. */
  trackPath?: { x: number; y: number }[]
  /**
   * F1's own per-lap classification. Covers the whole session even on a mid-
   * session live connect, unlike anything derived from observed laps.
   */
  lapPositions?: LapPositionSeries[]
  /** Per-driver session bests incl. speed-trap/intermediate speeds. */
  sessionBests?: DriverSessionBests[]
  /** Measured pit-lane transits — real time lost, not a model estimate. */
  pitLaneTimes?: PitLaneTime[]
  /** Team-radio captures, newest first, with playable URLs. */
  teamRadio?: TeamRadioClip[]
  /** F1's direct statement of the tyre set fitted right now, per driver. */
  currentTyres?: CurrentTyre[]
  /** Latest short race-control ticker line, e.g. "CLEAR IN TRACK SECTOR 12". */
  trackMessage?: string | null
  availability: DataAvailabilityMap
  /** Session clock (seconds since session start) this snapshot represents. */
  clock: number
  currentLap: number | null
  totalLaps: number | null
  trackStatus: TrackStatus
  /** Active qualifying segment from TimingData (Q1/Q2/Q3), when available. */
  qualifyingPart?: 1 | 2 | 3 | null
  /**
   * Authoritative session/segment countdown from the feed's ExtrapolatedClock
   * (the broadcast clock — it freezes on red flags), evaluated at `clock`.
   * Null when the feed carries no clock (e.g. providers without it).
   */
  sessionClock?: SessionClockRemaining | null
}

/**
 * DataProvider — the abstraction every source implements. loadSession pulls &
 * normalizes everything; getSnapshotAt reconstructs state at a session time
 * (enabling replay + sync). Live providers can ignore `t` and return latest.
 */
export interface DataProvider {
  readonly capabilities: ProviderCapabilities
  /** List selectable sessions (historical catalog, or [current] for live). */
  listSessions(): Promise<SessionInfo[]>
  /** Load & normalize a session by id. Resolves when snapshots are servable. */
  loadSession(sessionId: string): Promise<SessionInfo>
  /** Total session length in seconds (for scrubber). */
  getDuration(): number
  /** Earliest session time with a usable snapshot; defaults to zero. */
  getInitialClock?(): number
  /** Reconstruct the normalized snapshot at session time `t` (seconds). */
  getSnapshotAt(t: number): RaceSnapshot
  /** Optional richer telemetry for a driver near time `t`. */
  getTelemetry?(driverNumber: number, t: number, windowSec?: number): TelemetrySample[]
  /** Full lap history for a driver (for lap-time charts). */
  getDriverLaps?(driverNumber: number): LapSample[]
  /** Optional race-phase timeline (pre/green/SC/…/post) for the scrubber. */
  getTimeline?(): SessionTimeline
  /** Subscribe to background enrichment (for example positions/telemetry). */
  onUpdate?(listener: () => void): () => void
  /** Invalidate provider-local asynchronous work when switching sources. */
  cancelPendingLoads?(): void
  dispose?(): void
}

/** Empty availability with everything off — a safe default. */
export function emptyAvailability(): DataAvailabilityMap {
  return {
    timing: false,
    laps: false,
    stints: false,
    intervals: false,
    raceControl: false,
    weather: false,
    positions: false,
    positionProgress: false,
    telemetry: false,
    live: false
  }
}

export type {
  SessionInfo,
  Driver,
  TimingEntry,
  LapSample,
  Stint,
  RaceControlMessage,
  WeatherSample,
  PositionSample,
  TelemetrySample,
  DataAvailabilityMap,
  TrackStatus
}
export type { SessionTimeline }
