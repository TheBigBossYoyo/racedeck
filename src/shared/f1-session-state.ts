export interface F1SessionLiveDecisionInput {
  path: string
  archiveStatus: string | null
  startDate: string | null
  endDate: string | null
  liveStreamActive?: boolean | null
  nowMs?: number
}

const EXPLICIT_LIVE_ARCHIVE_STATUSES = new Set([
  'live',
  'generating',
  'inprogress',
  'in-progress',
  'in progress',
  'running',
  'streaming'
])

const MAX_SESSION_DURATION_MS = 12 * 60 * 60 * 1000
const EARLY_LIVE_WINDOW_MS = 6 * 60 * 60 * 1000
const LATE_LIVE_WINDOW_MS = 6 * 60 * 60 * 1000

/** The current SignalR buffer edge grows over time, so it is not a replay end. */
export function shouldPauseAtDataEdge(providerId: string, sessionId: string | null): boolean {
  return providerId !== 'f1live' || sessionId !== 'live'
}

export function isF1SessionLive(input: F1SessionLiveDecisionInput): boolean {
  if (input.liveStreamActive) return true
  if (!isExplicitlyLiveArchiveStatus(input.archiveStatus)) return false
  return isWithinSaneLiveWindow(input.startDate, input.endDate, input.nowMs ?? Date.now())
}

// ── Live SignalR feed: is the connected session actually LIVE right now? ────────
//
// F1's real-time feed always serves the LAST session's final snapshot when
// nothing is racing — so "we connected and got data" is NOT evidence of a live
// session. When idle, only the initial keyframe arrives (the probe confirmed
// zero feed deltas over 8s), and its SessionInfo carries decisive finished
// markers: `SessionStatus: "Finalised"` + `ArchiveStatus: { Status: "Complete" }`
// with an EndDate days in the past. This decides liveness from those markers so
// the app never presents a stale replay as the current live race.

export interface F1FeedLiveInput {
  /** SessionInfo.SessionStatus, e.g. "Started", "Aborted", "Finalised". */
  sessionStatus?: string | null
  /** SessionInfo.ArchiveStatus.Status, e.g. "Complete" once finished. */
  archiveStatus?: string | null
  /** Local session time from the feed, e.g. "2026-07-05T15:00:00" (no zone). */
  startDate?: string | null
  endDate?: string | null
  /** SessionInfo.GmtOffset, e.g. "01:00:00" or "-04:00:00". */
  gmtOffset?: string | null
  /** Count of substantive (non-Heartbeat) feed deltas received since connect. */
  substantiveMessages?: number
  nowMs?: number
}

/** Session-status values that mean the session is over (case-insensitive). */
const FINISHED_SESSION_STATUSES = new Set([
  'finalised',
  'finalized',
  'ends',
  'finished',
  'complete',
  'inactive'
])

/** How far before the scheduled start / after the scheduled end still counts as live. */
const FEED_PRE_WINDOW_MS = 30 * 60 * 1000
const FEED_POST_WINDOW_MS = 3 * 60 * 60 * 1000

/**
 * Decide whether the connected SignalR feed represents an actually-live session.
 *
 * Decisive "not live" signals (any one is enough):
 *  - ArchiveStatus is "Complete" (the archive is sealed → session finished).
 *  - SessionStatus is a finished/inactive marker.
 *  - "Now" is past the scheduled end (+ a grace window) or long before the start.
 *
 * If none of those fire, it's treated as live — optionally corroborated by a
 * flow of substantive (non-Heartbeat) feed deltas.
 */
export function isF1FeedLive(input: F1FeedLiveInput): boolean {
  const archive = input.archiveStatus?.trim().toLowerCase()
  if (archive === 'complete') return false

  const status = input.sessionStatus?.trim().toLowerCase()
  if (status && FINISHED_SESSION_STATUSES.has(status)) return false

  const now = input.nowMs ?? Date.now()
  const startMs = feedLocalToUtcMs(input.startDate, input.gmtOffset)
  const endMs = feedLocalToUtcMs(input.endDate, input.gmtOffset)
  if (startMs != null && now < startMs - FEED_PRE_WINDOW_MS) return false
  if (endMs != null && now > endMs + FEED_POST_WINDOW_MS) return false

  // Inside the window with no finished marker: live. If we have neither a window
  // nor a live-ish status, require substantive updates before claiming live so a
  // metadata-sparse stale snapshot isn't mistaken for a running session.
  if (startMs == null && endMs == null && !status) {
    return (input.substantiveMessages ?? 0) > 0
  }
  return true
}

/**
 * Combine a feed-local timestamp ("2026-07-05T15:00:00", no zone) with its
 * separate GmtOffset ("01:00:00" / "-04:00:00") into absolute UTC ms.
 */
export function feedLocalToUtcMs(
  local: string | null | undefined,
  gmtOffset: string | null | undefined
): number | null {
  if (!local) return null
  const asUtc = Date.parse(local.endsWith('Z') ? local : `${local}Z`)
  if (!Number.isFinite(asUtc)) return null
  return asUtc - parseGmtOffsetMs(gmtOffset)
}

/** "01:00:00" → +3600000; "-04:30:00" → -16200000; unparseable → 0. */
export function parseGmtOffsetMs(gmtOffset: string | null | undefined): number {
  if (!gmtOffset) return 0
  const m = /^([+-]?)(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(gmtOffset.trim())
  if (!m) return 0
  const sign = m[1] === '-' ? -1 : 1
  const hours = +m[2]
  const mins = +m[3]
  const secs = +(m[4] ?? 0)
  return sign * (hours * 3600 + mins * 60 + secs) * 1000
}

export function isWithinSaneLiveWindow(
  startDate: string | null,
  endDate: string | null,
  nowMs: number
): boolean {
  const startMs = parseIsoMs(startDate)
  const endMs = parseIsoMs(endDate)
  if (startMs == null || endMs == null) return false
  if (endMs < startMs) return false
  if (endMs - startMs > MAX_SESSION_DURATION_MS) return false
  return nowMs >= startMs - EARLY_LIVE_WINDOW_MS && nowMs <= endMs + LATE_LIVE_WINDOW_MS
}

function isExplicitlyLiveArchiveStatus(status: string | null): boolean {
  if (!status) return false
  return EXPLICIT_LIVE_ARCHIVE_STATUSES.has(status.trim().toLowerCase())
}

function parseIsoMs(value: string | null): number | null {
  if (!value) return null
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}
