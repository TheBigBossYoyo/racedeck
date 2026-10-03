/**
 * Unified error/recovery classification (APP_IMPROVEMENT_ROADMAP.md P2 item 28).
 *
 * Not a rewrite of the underlying stores — `sessionStore.error`, `liveStore`'s
 * `LiveStatus`/`notice`, `syncStore`'s `FollowState`, and `AppInfo`'s DRM flags
 * are already reasonably informative on their own. This normalizes them into
 * one list so a viewer doesn't have to hunt across widgets to see what's
 * currently degraded, what still works, and what to do about it.
 */
import { formatDuration } from '@renderer/lib/utils'
import type {
  EnrichmentFeedProgress,
  EnrichmentProgress,
  FeedAnomalies,
  FeedQualityReport
} from '@renderer/core/model/feedHealth'

export type StatusCategory =
  | 'provider'
  | 'auth'
  | 'archive'
  | 'live-socket'
  | 'telemetry-enrichment'
  | 'feed-quality'
  | 'drm'
  | 'sync'
  | 'persistence'

export type RecoveryActionId =
  | 'sign-in'
  | 'reconnect'
  | 'recalibrate-sync'
  | 'retry-session'
  | 'reset-corrupted-data'
  | 'dismiss-persist-recovery'

export interface SystemStatusEntry {
  category: StatusCategory
  severity: 'info' | 'warning' | 'danger'
  message: string
  whatStillWorks: string | null
  recoveryActionId: RecoveryActionId | null
  /**
   * A progress readout for work that is running normally, not a degraded state.
   * Listed with the rest but not counted as an "issue".
   */
  ongoing?: boolean
  /**
   * A note worth listing that is not a problem: shown in the panel but not counted
   * as an "issue", and not a progress readout either.
   */
  informational?: boolean
}

export interface SystemStatusInputs {
  sessionError: string | null
  liveStatus: { state: string; detail: string | null; subscription: boolean } | null
  loggedIn: boolean
  followStatus: 'following' | 'uncalibrated' | 'waiting' | 'needs-calibration' | 'off'
  followDetail: string | null
  drmCapable: boolean
  drmReady: boolean
  enrichmentIssue: string | null
  /** Chunked Position/CarData load progress; absent/null when none is running. */
  enrichmentProgress?: EnrichmentProgress | null
  /** Feed shape anomalies counted by the provider; absent/null/empty means none. */
  feedQuality?: FeedQualityReport | null
  /** Persisted entries that failed to parse (IMPROVEMENT_OPPORTUNITIES.md item #15). */
  persistCorruptions: readonly { namespace: string; key: string }[]
  /** Copy of a whole settings file that was unreadable at launch and reset. */
  persistRecoveredBackup: string | null
  /** Pending auto-reconnect countdown, if any (IMPROVEMENT_OPPORTUNITIES.md item #21). */
  reconnect: { attempt: number; remainingMs: number } | null
}

const ENRICHMENT_FEED_LABEL = { position: 'position', carData: 'car data' } as const

function describeFeed(
  label: string,
  feed: EnrichmentFeedProgress,
  totalSeconds: number | null
): string {
  if (feed.state === 'pending') return `${label} queued`
  if (feed.coveredSeconds != null) {
    if (totalSeconds == null) return `${label} through ${formatDuration(feed.coveredSeconds)}`
    const covered = Math.min(feed.coveredSeconds, totalSeconds)
    return `${label} ${formatDuration(covered)} of ${formatDuration(totalSeconds)}`
  }
  if (feed.pointsApplied > 0) return `${label} ${feed.pointsApplied.toLocaleString('en-US')} points`
  return `${label} starting`
}

/**
 * One line of enrichment progress, or null once no feed is still loading.
 * Only what the provider measured is shown: session time covered against the
 * session length core timing established, or just what has arrived when that
 * length is unknown. There is no percentage or ETA — the feed size is not known.
 */
export function describeEnrichmentProgress(
  progress: EnrichmentProgress | null | undefined
): string | null {
  if (!progress) return null
  const parts: string[] = []
  for (const key of ['position', 'carData'] as const) {
    const feed = progress[key]
    if (feed.state === 'pending' || feed.state === 'loading') {
      parts.push(describeFeed(ENRICHMENT_FEED_LABEL[key], feed, progress.totalSeconds))
    }
  }
  return parts.length > 0 ? `Enriching telemetry: ${parts.join(', ')}` : null
}

/**
 * When feed anomalies stop being a footnote and become a warning.
 *
 * A remote feed occasionally sends an odd value and the normalizers already treat
 * it as unavailable, so a handful is noise and must not raise a badge. What is
 * worth a warning is drift: one kind of value wrong repeatedly (F1 changed a
 * field's format), which silently blanks that field. That takes BOTH a count high
 * enough not to be a fluke and a rate high enough to be systematic: at least
 * `FEED_DRIFT_MIN_COUNT` values of one kind, making up at least
 * `FEED_DRIFT_MIN_RATE` of the values of that kind inspected. A rate alone would
 * fire on the first bad value of a quiet feed; a count alone would fire on a long
 * session's tiny background rate.
 */
export const FEED_DRIFT_MIN_COUNT = 25
export const FEED_DRIFT_MIN_RATE = 0.05

const FEED_MESSAGE_MAX_FEEDS = 2
const FEED_MESSAGE_MAX_REASONS = 2

export function isFeedDrifting(report: FeedQualityReport): boolean {
  return report.feeds.some((feed) =>
    feed.reasons.some(
      (reason) =>
        reason.count >= FEED_DRIFT_MIN_COUNT &&
        reason.checked > 0 &&
        reason.count / reason.checked >= FEED_DRIFT_MIN_RATE
    )
  )
}

function describeFeedAnomalies(feed: FeedAnomalies): string {
  const reasons = feed.reasons
    .slice(0, FEED_MESSAGE_MAX_REASONS)
    .map((reason) => `${reason.problem} ×${reason.count.toLocaleString('en-US')}`)
  const more = feed.reasons.length - reasons.length
  if (more > 0) reasons.push(`+${more} more`)
  const unit = feed.anomalies === 1 ? 'value' : 'values'
  return `${feed.anomalies.toLocaleString('en-US')} unexpected ${unit} in ${feed.feed} (${reasons.join(', ')})`
}

/** One entry describing feed shape anomalies, or null when there are none. */
export function describeFeedQuality(report: FeedQualityReport | null | undefined): string | null {
  if (!report || report.totalAnomalies <= 0 || report.feeds.length === 0) return null
  const shown = report.feeds.slice(0, FEED_MESSAGE_MAX_FEEDS).map(describeFeedAnomalies)
  const hidden = report.feeds.length - shown.length
  if (hidden > 0) shown.push(`${hidden} more feed${hidden === 1 ? '' : 's'} affected`)
  const example = report.feeds[0].reasons[0]?.example
  return `Feed data quality: ${shown.join('; ')}.${example ? ` First seen: ${example}.` : ''}`
}

/** Build the current list of degraded-state entries from the app's scattered status signals. */
export function buildSystemStatus(inputs: SystemStatusInputs): SystemStatusEntry[] {
  const entries: SystemStatusEntry[] = []

  if (inputs.sessionError) {
    entries.push({
      category: 'provider',
      severity: 'danger',
      message: inputs.sessionError,
      whatStillWorks: 'Switching sessions or providers should still work.',
      recoveryActionId: 'retry-session'
    })
  }

  if (inputs.reconnect) {
    const seconds = Math.max(0, Math.ceil(inputs.reconnect.remainingMs / 1000))
    entries.push({
      category: 'live-socket',
      severity: 'warning',
      message: `F1 Live reconnecting in ${seconds}s… (attempt ${inputs.reconnect.attempt})`,
      whatStillWorks: 'Archive/replay sessions remain fully usable.',
      recoveryActionId: 'reconnect'
    })
  } else if (inputs.liveStatus?.state === 'error') {
    entries.push({
      category: 'live-socket',
      severity: 'danger',
      message: inputs.liveStatus.detail ?? 'The live timing connection failed.',
      whatStillWorks: 'Archive/replay sessions remain fully usable.',
      recoveryActionId: 'reconnect'
    })
  }

  const subscriptionRejected = inputs.liveStatus?.detail
    ?.toLowerCase()
    .includes('subscription rejected')
  if (subscriptionRejected) {
    entries.push({
      category: 'auth',
      severity: 'warning',
      message: 'F1 TV session expired.',
      whatStillWorks: 'Public timing continues; car telemetry and positions need a fresh sign-in.',
      recoveryActionId: 'sign-in'
    })
  } else if (
    !inputs.loggedIn &&
    inputs.liveStatus?.state === 'connected' &&
    !inputs.liveStatus.subscription
  ) {
    entries.push({
      category: 'auth',
      severity: 'info',
      message: 'Not signed in to F1 TV.',
      whatStillWorks: 'Public timing continues; sign in for car telemetry and positions.',
      recoveryActionId: 'sign-in'
    })
  }

  if (inputs.followStatus !== 'following' && inputs.followStatus !== 'off' && inputs.followDetail) {
    entries.push({
      category: 'sync',
      severity: 'warning',
      message: inputs.followDetail,
      whatStillWorks: 'The dashboard keeps working; only TOD video-follow is affected.',
      recoveryActionId: 'recalibrate-sync'
    })
  }

  if (inputs.enrichmentIssue) {
    entries.push({
      category: 'telemetry-enrichment',
      severity: 'info',
      message: inputs.enrichmentIssue,
      whatStillWorks:
        'Core timing and the map remain fully usable; only extended telemetry/position enrichment is affected.',
      recoveryActionId: null
    })
  }

  const enriching = describeEnrichmentProgress(inputs.enrichmentProgress)
  if (enriching) {
    entries.push({
      category: 'telemetry-enrichment',
      severity: 'info',
      message: enriching,
      whatStillWorks:
        'Core timing stays fully usable; positions and car telemetry appear as they finish loading.',
      recoveryActionId: null,
      ongoing: true
    })
  }

  const feedQuality = describeFeedQuality(inputs.feedQuality)
  if (feedQuality && inputs.feedQuality) {
    const drifting = isFeedDrifting(inputs.feedQuality)
    entries.push({
      category: 'feed-quality',
      severity: drifting ? 'warning' : 'info',
      message: feedQuality,
      whatStillWorks: 'The dashboard keeps using the feed as received; this is a diagnostic note.',
      recoveryActionId: null,
      informational: !drifting
    })
  }

  if (inputs.persistCorruptions.length > 0) {
    const n = inputs.persistCorruptions.length
    entries.push({
      category: 'persistence',
      severity: 'warning',
      message: `${n} saved setting${n === 1 ? '' : 's'} could not be read and ${n === 1 ? 'is' : 'are'} using defaults.`,
      whatStillWorks: 'Everything else keeps working; only the affected saved data was reset.',
      recoveryActionId: 'reset-corrupted-data'
    })
  }

  if (inputs.persistRecoveredBackup) {
    entries.push({
      category: 'persistence',
      severity: 'warning',
      message: `Your saved settings file could not be read, so settings were reset to defaults. The unreadable file was kept at ${inputs.persistRecoveredBackup}.`,
      whatStillWorks: 'The app runs normally; layouts, sync offsets and AI settings start fresh.',
      recoveryActionId: 'dismiss-persist-recovery'
    })
  }

  if (inputs.drmCapable && !inputs.drmReady) {
    entries.push({
      category: 'drm',
      severity: 'info',
      message: 'Widevine has not provisioned on this build.',
      whatStillWorks: 'Companion-window or external TOD playback modes still work.',
      recoveryActionId: null
    })
  }

  return entries
}
