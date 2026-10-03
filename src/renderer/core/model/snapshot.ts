import type {
  SessionInfo,
  Driver,
  TimingEntry,
  LapSample,
  Stint,
  RaceControlMessage,
  WeatherSample,
  PositionSample,
  DataAvailabilityMap,
  TrackStatus,
  LapPositionSeries,
  DriverSessionBests,
  PitLaneTime,
  TeamRadioClip,
  CurrentTyre,
  DriverTyreStintHistory
} from '@shared/models'
import type { SessionClockRemaining } from '@shared/f1live'

/**
 * The neutral data-shape contract engines, stores and widgets consume. Providers
 * PRODUCE a `RaceSnapshot`; nothing in here may import a provider, engine, store
 * or component (enforced by tests/unit/layering.test.ts).
 * `core/providers/types.ts` re-exports every symbol below.
 */

/** Raw feed topics whose points identify individual drivers. */
export type DriverFeedTopic = 'TimingData' | 'Position' | 'CarData'

/** Age in ms of one driver's newest data per feed; missing key = never seen. */
export type DriverFeedFreshness = Partial<Record<DriverFeedTopic, number>>

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
  /** F1's own per-driver tyre-set stint history (`TyreStintSeries`), when available. */
  tyreStintHistory?: DriverTyreStintHistory[]
  /**
   * Milliseconds since each raw feed topic (e.g. `Position`, `CarData`,
   * `TimingData`) last received new data. Wall-clock, so only meaningful for a
   * LIVE session — a replay's clock is the scrub position, not real time, so
   * there is nothing to be "stale" against. Absent/omitted outside live.
   */
  feedFreshness?: Record<string, number>
  /**
   * Per-driver counterpart of `feedFreshness`: milliseconds since each driver's
   * OWN data last arrived on each feed, keyed by driver number. A feed a driver
   * has never appeared on is simply absent (unknown, not "fresh"). Live only —
   * undefined for replay/archive. Deliberately separate from `drivers` so that
   * array keeps its identity across polls.
   */
  driverFreshness?: Record<number, DriverFeedFreshness>
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
