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
  TrackStatus
} from '@shared/models'
import type { RaceSnapshot } from '@renderer/core/model/snapshot'
import type { EnrichmentProgress, FeedQualityReport } from '@renderer/core/model/feedHealth'
import type { SessionTimeline } from '@renderer/core/model/timeline'

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
  /** Cache/enrichment status for a diagnostics surface. Absent providers show "N/A". */
  getDiagnostics?(): ProviderDiagnostics
}

/**
 * Session-level cache/enrichment visibility (APP_IMPROVEMENT_ROADMAP.md P2
 * item 32) — so an invalidation or a slow rebuild is visible instead of
 * silently doing work that reads as a freeze.
 */
export interface ProviderDiagnostics {
  trackPathCacheStatus: 'hit' | 'miss' | 'unavailable'
  cacheSchemaVersion: number
  enrichmentProcessedPoints: number
  enrichmentIssue: string | null
  /**
   * Archive enrichment (Position + CarData loaded in chunks after core timing).
   * Null when no enrichment is under way for the loaded session — live sessions,
   * nothing loaded yet, or the load was cancelled.
   */
  enrichmentProgress: EnrichmentProgress | null
  /** Raw Position stream points accumulated so far (live map outline). */
  trackRawPointCount: number
  /** Driver number the outline trace follows, or null if none found yet. */
  trackReferenceDriver: number | null
  /** Length of the current downsampled-but-not-yet-adopted trace. */
  trackOpenTraceLength: number
  /** Length of the ADOPTED trace (open fallback or closed), 0 if neither yet. */
  trackAdoptedLength: number
  trackPathClosed: boolean
  /** Feed shape anomalies seen since the session (or live connection) began. */
  feedQuality: FeedQualityReport
}

// The data-shape types moved to the neutral `core/model/` layer (engines, stores and
// widgets import them from there); re-exported so provider-side imports keep resolving.
export { emptyAvailability } from '@renderer/core/model/snapshot'
export type { RaceSnapshot, DriverFeedTopic, DriverFeedFreshness } from '@renderer/core/model/snapshot'
export type {
  EnrichmentFeedProgress,
  EnrichmentProgress,
  FeedAnomalyReason,
  FeedAnomalies,
  FeedQualityReport
} from '@renderer/core/model/feedHealth'

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
