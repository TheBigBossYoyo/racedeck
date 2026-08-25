import type { Point } from '@renderer/core/engines/geometry'
import type { DriverDot } from './types'

/**
 * Bounded dead-reckoning through brief position outages (APP_IMPROVEMENT_ROADMAP.md
 * P1 item 12). Live interpolation already smooths normal ~2 Hz jitter; this
 * covers the case where the feed has genuinely stopped (per `feedFreshness`)
 * and a marker would otherwise sit frozen. Extrapolation is capped to a short
 * distance and visibly marked, never presented as a real position.
 */

export interface PositionTrack {
  readonly x: number
  readonly y: number
  /** Velocity in viewBox units per ms, from the last genuine movement. */
  readonly vx: number
  readonly vy: number
  /** Wall-clock ms this track last saw a genuine (non-frozen) position. */
  readonly updatedAtMs: number
}

/** Below this viewBox-unit displacement, a reading is "frozen", not moving. */
const MIN_MOVE_EPSILON = 0.01

/**
 * Fold one fresh reading into a driver's position track. A genuine move
 * records new velocity/time; a frozen reading (identical to last time) keeps
 * the previous track untouched, so its velocity and "last moved" time remain
 * available for extrapolation.
 */
export function updatePositionTrack(
  previous: PositionTrack | undefined,
  point: Point,
  nowMs: number
): PositionTrack {
  if (!previous) return { x: point.x, y: point.y, vx: 0, vy: 0, updatedAtMs: nowMs }
  const dx = point.x - previous.x
  const dy = point.y - previous.y
  if (Math.hypot(dx, dy) < MIN_MOVE_EPSILON) return previous
  const dt = Math.max(1, nowMs - previous.updatedAtMs)
  return { x: point.x, y: point.y, vx: dx / dt, vy: dy / dt, updatedAtMs: nowMs }
}

/**
 * Project a track forward by its last known velocity, capped to `maxDistance`
 * so a long outage degrades to "frozen at the edge of plausibility" rather
 * than drifting arbitrarily.
 */
export function extrapolatePosition(
  track: PositionTrack,
  nowMs: number,
  maxDistance: number
): Point {
  const elapsedMs = Math.max(0, nowMs - track.updatedAtMs)
  const dx = track.vx * elapsedMs
  const dy = track.vy * elapsedMs
  const distance = Math.hypot(dx, dy)
  if (distance === 0 || distance <= maxDistance) return { x: track.x + dx, y: track.y + dy }
  const scale = maxDistance / distance
  return { x: track.x + dx * scale, y: track.y + dy * scale }
}

/**
 * Reconcile one snapshot's driver dots against the rolling position tracks.
 * Mutates `tracked` in place (a ref-backed Map, matching this widget's
 * existing `frameRef` sticky-state pattern) and returns a new dots array —
 * extrapolated in place of a frozen reading once the feed has been stale for
 * `staleThresholdMs`, each one flagged `extrapolated: true`.
 */
export function reconcileLivePositions(
  dots: readonly DriverDot[],
  tracked: Map<number, PositionTrack>,
  nowMs: number,
  feedFreshnessMs: number,
  staleThresholdMs: number,
  maxDistance: number
): DriverDot[] {
  const isStale = feedFreshnessMs >= staleThresholdMs
  return dots.map((dot) => {
    const previous = tracked.get(dot.number)
    const updated = updatePositionTrack(previous, dot, nowMs)
    tracked.set(dot.number, updated)
    // Frozen (this reading didn't move the track) and the feed is genuinely
    // stale, not just between two identical fast samples: extrapolate.
    if (isStale && previous && updated === previous) {
      const projected = extrapolatePosition(updated, nowMs, maxDistance)
      return { ...dot, x: projected.x, y: projected.y, extrapolated: true }
    }
    return dot
  })
}

/**
 * Add a synthesized, dead-reckoned dot for every driver with a rolling track
 * (has been seen before) who is entirely ABSENT from this frame's real dots
 * — a single null/missing sample would otherwise drop that driver's marker
 * for exactly one tick and bring it back the next, reading as a flicker
 * across the field. `reconcileLivePositions` only smooths a driver who IS
 * present but frozen; this covers the driver who isn't present at all.
 * Bounded the same way: capped extrapolation distance, and skipped once the
 * driver's own track is older than `maxOutageMs` — gone that long is treated
 * as genuinely gone, not glitching, and `buildDot` returning null (e.g. a
 * driver who has since retired) drops them too.
 */
export function fillMissingFromTracks(
  dots: readonly DriverDot[],
  tracked: ReadonlyMap<number, PositionTrack>,
  buildDot: (driverNumber: number, point: Point) => DriverDot | null,
  nowMs: number,
  maxDistance: number,
  maxOutageMs: number
): DriverDot[] {
  const present = new Set(dots.map((d) => d.number))
  const filled: DriverDot[] = []
  for (const [driverNumber, track] of tracked) {
    if (present.has(driverNumber)) continue
    if (nowMs - track.updatedAtMs > maxOutageMs) continue
    const projected = extrapolatePosition(track, nowMs, maxDistance)
    const dot = buildDot(driverNumber, projected)
    if (dot) filled.push({ ...dot, extrapolated: true })
  }
  return filled.length > 0 ? [...dots, ...filled] : [...dots]
}
