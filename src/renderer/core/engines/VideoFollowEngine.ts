import { SYNC_MAX_OFFSET, SYNC_MIN_OFFSET } from '@shared/constants'
import type { VideoPlaybackProbe } from '@shared/models'
import { syncMath } from './SessionSyncEngine'

/**
 * Video follow — keeps the dashboard aligned with TOD after a single calibration.
 *
 * Sync was hard because the offset was a fixed number the user had to re-derive
 * by hand every time the video's relationship to real time changed: pausing to
 * make a coffee, rewinding to see an overtake again, a buffering stall, or the
 * player quietly drifting off the live edge. Each of those silently invalidated
 * the offset, and the only remedy was the wizard again.
 *
 * The absolute broadcast delay genuinely cannot be measured from the player — a
 * live stream is already tens of seconds old when it arrives and exposes no
 * timeline saying by how much. That first number still has to be established
 * once, by eye. But every subsequent CHANGE to it is measurable exactly:
 *
 *     real time always advances; the player's clock advances only while playing
 *
 * so whatever the player's clock failed to advance is precisely how much further
 * behind the data it has fallen. Follow one anchor forward with that identity and
 * the offset maintains itself for the rest of the session.
 */

/** The calibrated moment every later reading is measured against. */
export interface FollowAnchor {
  /** The player's clock at calibration (seconds into its own timeline). */
  videoTime: number
  /** Wall clock at the same instant, as read in the main process (ms). */
  atMs: number
  /** The sync offset known to be correct at that instant (seconds). */
  offset: number
  /** Identity of the media the anchor was taken against. */
  mediaKey: string | null
}

export type FollowStatus =
  /** The user has not turned follow on. */
  | 'off'
  /** Anchored and tracking; `offset` is live. */
  | 'following'
  /** On, but no anchor yet — waiting for the user to calibrate. */
  | 'uncalibrated'
  /** The player was readable but is not any more (loading, ad break, closed). */
  | 'waiting'
  /** A different video is loaded, or the clock moved impossibly. Re-calibrate. */
  | 'needs-calibration'

export interface FollowResult {
  status: FollowStatus
  /** The offset to apply, or null when there is nothing trustworthy to apply. */
  offset: number | null
  /** Anchor to keep for the next reading (unchanged unless it was invalidated). */
  anchor: FollowAnchor | null
  /** Short human explanation, shown when the status is not plain 'following'. */
  detail: string | null
}

/**
 * A single tick's worth of correction, big enough to be worth reporting.
 *
 * Sub-second differences are the player's clock resolution and normal decoder
 * jitter, not a real change in the broadcast delay; applying them would make the
 * dashboard twitch continuously for no gain.
 */
export const FOLLOW_DEADBAND_SEC = 0.4

export const followMath = {
  /**
   * The offset implied by a later reading of the same media.
   *
   * `anchor.offset + (real time elapsed − video time elapsed)`. A pause makes
   * video time stand still while real time runs on, so the offset grows by the
   * length of the pause; a rewind adds the distance rewound; seeking towards the
   * live edge shrinks it again.
   */
  offsetFor(anchor: FollowAnchor, currentTime: number, atMs: number): number {
    const wallElapsed = (atMs - anchor.atMs) / 1000
    const videoElapsed = currentTime - anchor.videoTime
    return anchor.offset + (wallElapsed - videoElapsed)
  },

  /** Is a computed offset inside the range the app can actually represent? */
  isRepresentable(offset: number): boolean {
    return offset >= SYNC_MIN_OFFSET && offset <= SYNC_MAX_OFFSET
  }
}

/**
 * Fold one probe reading into the follow state.
 *
 * Pure: given the same anchor and reading it always returns the same result, so
 * the whole behaviour is testable without a video, a player, or a clock.
 */
export function followStep(
  enabled: boolean,
  anchor: FollowAnchor | null,
  probe: VideoPlaybackProbe
): FollowResult {
  if (!enabled) return { status: 'off', offset: null, anchor, detail: null }
  if (!probe.ok) {
    return {
      status: 'waiting',
      offset: null,
      anchor,
      detail: probe.reason ?? 'Waiting for the TOD player.'
    }
  }
  if (!anchor) {
    return {
      status: 'uncalibrated',
      offset: null,
      anchor: null,
      detail: 'Mark one event you can see on the video to set the delay.'
    }
  }
  // A different asset means a different timeline: the anchor's video clock no
  // longer refers to anything. Dropping it is the honest response — silently
  // carrying it over would produce a confidently wrong offset.
  if (anchor.mediaKey != null && probe.mediaKey != null && anchor.mediaKey !== probe.mediaKey) {
    return {
      status: 'needs-calibration',
      offset: null,
      anchor: null,
      detail: 'A different video is loaded. Mark an event again to re-sync.'
    }
  }

  const raw = followMath.offsetFor(anchor, probe.currentTime, probe.atMs)
  if (!Number.isFinite(raw) || !followMath.isRepresentable(raw)) {
    return {
      status: 'needs-calibration',
      offset: null,
      anchor: null,
      detail: 'The video jumped further than the sync range covers. Mark an event again.'
    }
  }
  return { status: 'following', offset: syncMath.clampOffset(raw), anchor, detail: null }
}

/**
 * How far the offset has drifted since `anchor` was taken — the same delta
 * `followStep` computes internally to decide whether to apply a correction,
 * exported so a sync-health panel can show "drifted Xs since last anchor"
 * without re-deriving it. Null when the reading can't be compared (a bad
 * probe, or a different media than the anchor was taken against).
 */
export function driftSeconds(anchor: FollowAnchor, probe: VideoPlaybackProbe): number | null {
  if (!probe.ok) return null
  if (anchor.mediaKey != null && probe.mediaKey != null && anchor.mediaKey !== probe.mediaKey)
    return null
  const raw = followMath.offsetFor(anchor, probe.currentTime, probe.atMs)
  if (!Number.isFinite(raw)) return null
  return raw - anchor.offset
}

/** Build the anchor for an offset now known to be correct. */
export function anchorFrom(probe: VideoPlaybackProbe, offset: number): FollowAnchor | null {
  if (!probe.ok) return null
  return {
    videoTime: probe.currentTime,
    atMs: probe.atMs,
    offset,
    mediaKey: probe.mediaKey
  }
}
