import type { F1StreamPoint } from '@shared/f1live'
import { ReferenceDriverTracker, buildTrackPath, closeTrackTrace } from '../f1normalize'

/**
 * Minimum downsampled points before an UNCLOSED trace is shown as a
 * best-effort map outline. Real inter-sample spacing is large enough (≈45m
 * at racing speed against the ~150-unit thinning distance) that 30 points
 * already represents a genuinely track-shaped arc, not just the first couple
 * of live polls' worth of noise.
 */
const MIN_OPEN_TRACE_POINTS = 30

/**
 * Minimum session time (s) between attempts to close the circuit outline while it
 * is still open. Positions arrive at ~1 Hz, so a live poll every few hundred ms
 * brings at most one new sample; re-tracing the whole feed for each of them is
 * pure cost, and a lap is closed a few samples late at worst. Fully downloaded
 * archives always get their final attempt regardless (`adopt`'s `force`).
 */
const TRACK_CLOSURE_RETRY_SEC = 10

/**
 * The circuit outline the provider publishes as `snapshot.trackPath`, and the
 * state that decides when it may change. Moved from F1LiveProvider.ts
 * (`trackPath`, `trackPathClosed`, `referenceDriver`, `trackAttemptT` and
 * `adoptTrackPath`); a fresh session replaces the whole object.
 */
export class TrackOutline {
  /** Same reference until an outline is adopted or replaced. */
  path: { x: number; y: number }[] = []
  /**
   * Has `path` been proven to be a complete lap?
   *
   * Only a closed trace is a circuit; a partial one is the squiggle a single car
   * happened to drive so far. Once true the outline is final for the session and
   * is never recomputed — which also stops a live poll from spending O(all
   * positions) rebuilding it several times a second.
   */
  closed = false
  /** Incremental tally of the outline's reference driver over the position points. */
  private referenceDriver = new ReferenceDriverTracker()
  /** Session time of the newest Position sample when closure was last attempted. */
  private attemptT = Number.NEGATIVE_INFINITY

  /** Reference driver as of `points` (diagnostics share the adoption tally). */
  updateReferenceDriver(points: F1StreamPoint[]): ReturnType<ReferenceDriverTracker['update']> {
    return this.referenceDriver.update(points)
  }

  /** Take an outline already proven for this race weekend (a persisted-cache hit). */
  seed(path: { x: number; y: number }[]): void {
    this.path = path
    this.closed = true
  }

  /**
   * Take the circuit outline as far as the positions seen so far allow, and
   * never take a step backwards. Returns true if the outline changed.
   *
   * The rule is that only a CLOSED trace — one where the reference car returned
   * to where it started after covering a plausible lap — may be shown or cached.
   *
   * This used to run unconditionally on every ingest, which broke the live map
   * in two ways. A live poll arrives every couple of seconds with only a few
   * minutes of positions behind it, so the rebuilt trace was whatever partial
   * squiggle one car had driven; it was published as the circuit, and (once past
   * 20 points) written to the weekend's outline cache, corrupting it for every
   * later session at the same track. It also overwrote the good cached outline
   * loaded moments earlier, so seeding the map from an earlier session never
   * actually worked.
   *
   * `allowOpenFallback` now applies to LIVE too, not just a fully downloaded
   * archive: a strict "closed loop or nothing" map is only as good as the
   * closure math, and if that math ever fails to close on some circuit/session
   * shape it never previously exercised, the map has no way to recover —
   * exactly the failure mode this exists to end. The corruption risk above is
   * structurally avoided regardless: `onClosed` (which persists the outline) is
   * only ever called from the CLOSED branch, so an open trace is shown but never
   * cached, live or not. `MIN_OPEN_TRACE_POINTS` still guards against publishing
   * the "whatever partial squiggle" from the first couple of polls — only a trace
   * substantial enough to actually look like part of a circuit gets shown;
   * closure is still attempted first on every poll and silently upgrades the map
   * the moment it succeeds.
   */
  adopt(
    points: F1StreamPoint[],
    allowOpenFallback: boolean,
    force: boolean,
    onClosed: (path: { x: number; y: number }[]) => void
  ): boolean {
    if (this.closed) return false
    if (points.length === 0) return false
    // While the outline is open every attempt re-traces the whole feed, so a
    // live session tries once per TRACK_CLOSURE_RETRY_SEC of session time, not
    // once per poll. An attempt itself is unchanged and stays deterministic in
    // the points it sees; only how often it runs differs.
    const latestT = points[points.length - 1].t
    if (!force && latestT - this.attemptT < TRACK_CLOSURE_RETRY_SEC) return false
    this.attemptT = latestT
    // One trace serves both the closure check and the open fallback.
    const referenceDriver = this.referenceDriver.update(points)
    const trace = buildTrackPath(points, undefined, undefined, referenceDriver)
    const closed = closeTrackTrace(trace)
    if (closed && closed.length > 0) {
      this.path = closed
      this.closed = true
      onClosed(closed)
      return true
    }
    if (!allowOpenFallback || this.path.length > 0) return false
    if (trace.length < MIN_OPEN_TRACE_POINTS) return false
    this.path = trace
    return true
  }
}
