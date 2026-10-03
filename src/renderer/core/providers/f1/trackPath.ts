import type { PositionSample } from '@shared/models'
import type { F1StreamPoint } from '@shared/f1live'
import { indexedToArray } from '@shared/f1live'
import { numOrNull, rec } from './shared'

export function positionAvailability(positions: PositionSample[]): {
  positions: boolean
  positionProgress: boolean
} {
  return {
    positions: positions.some((position) => position.x != null && position.y != null),
    positionProgress: positions.some((position) => position.lapProgress != null)
  }
}

/**
 * How far to follow the reference car while looking for a closed lap.
 *
 * This is a SEARCH window, not the size of the finished outline — `buildClosedTrackPath`
 * returns only the prefix that closes. It has to be generous because the car
 * whose trace is followed may spend its first samples crawling down the pit
 * lane, sitting in a queue at the end of it, or running an aborted lap. Measured
 * against real data (Zandvoort qualifying: ~45 m between samples, a 4.26 km lap
 * ≈ 92 points) this holds roughly seven laps' worth of chances to find one clean
 * one, at the cost of scanning a few hundred extra points once per session.
 */
const TRACK_PATH_MAX_POINTS = 700

/**
 * Whichever driver has the most on-track samples SO FAR — the one whose
 * trajectory `buildTrackPath`/`buildClosedTrackPath` follow. Exported
 * (alongside `debugTrackTraceInfo`) purely for diagnostics: the map outline
 * has gone through several rounds of live-session bug reports where static
 * analysis alone couldn't pin down which stage was actually failing (no
 * reference driver found vs. found but never accumulating vs. accumulating
 * but never closing) — these numbers make that visible instead of guessed
 * at.
 *
 * Previously capped to the first 600 raw points ("sample well beyond the
 * opening frames"), on the assumption that ~600 points was several minutes
 * of real time. Live diagnostics from an actual session proved that wrong:
 * 10,850 points had accumulated over 2-3 minutes with a reference driver
 * still unfound, because the real feed's incremental per-car cadence means
 * 600 points can be just a few seconds — nowhere near "well beyond the
 * opening frames" if the session starts on the grid, a formation lap, or
 * anyone still queued in the pit lane. There is no meaningful cost to
 * scanning everything: this is a single pass over cheap lookups, called at
 * most a few times a second, and only ever WHILE the outline hasn't closed
 * yet (closure short-circuits every future call once found).
 */
export function pickReferenceDriver(points: F1StreamPoint[]): number | null {
  return new ReferenceDriverTracker().update(points)
}

/**
 * `pickReferenceDriver`, kept up to date incrementally.
 *
 * A live session re-asks "who is the reference driver?" every few seconds of an
 * append-only Position array, and each answer used to re-scan (and regex every
 * key of) the WHOLE array. The tally only ever needs the points added since the
 * last call, and yields exactly the same counts and the same first-seen tie-break
 * as the full scan.
 *
 * The array may be replaced by a longer copy carrying the same point objects (a
 * live poll can rebuild it) or trimmed at the front (retention). The last point
 * already tallied is remembered by identity: if it is no longer at the position
 * it was tallied from, the tally restarts from the beginning of the new array.
 */
export class ReferenceDriverTracker {
  private presence = new Map<number, number>()
  private processed = 0
  private lastTallied: F1StreamPoint | null = null

  update(points: F1StreamPoint[]): number | null {
    if (this.processed > points.length || points[this.processed - 1] !== this.lastTallied) {
      this.reset()
    }
    for (let i = this.processed; i < points.length; i++) this.tally(points[i])
    this.processed = points.length
    this.lastTallied = points.length > 0 ? points[points.length - 1] : null
    return this.leader()
  }

  reset(): void {
    this.presence = new Map()
    this.processed = 0
    this.lastTallied = null
  }

  private tally(point: F1StreamPoint): void {
    for (const [key, raw] of Object.entries(positionEntries(point.d))) {
      if (!/^\d+$/.test(key)) continue
      if (!isOnTrackEntry(rec(raw))) continue
      const driverNumber = Number(key)
      this.presence.set(driverNumber, (this.presence.get(driverNumber) ?? 0) + 1)
    }
  }

  private leader(): number | null {
    return [...this.presence.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
  }
}

/** Build one stable, bounded circuit trace from the decoded Position feed. */
export function buildTrackPath(
  points: F1StreamPoint[],
  maxPoints = TRACK_PATH_MAX_POINTS,
  minDistance = 150,
  /** The driver `pickReferenceDriver(points)` would name, when the caller already has it. */
  knownReferenceDriver?: number | null
): { x: number; y: number }[] {
  if (points.length === 0) return []
  const referenceDriver =
    knownReferenceDriver !== undefined ? knownReferenceDriver : pickReferenceDriver(points)
  if (referenceDriver == null) return []

  const path: { x: number; y: number }[] = []
  for (const point of points) {
    const raw = rec(positionEntries(point.d)[String(referenceDriver)])
    if (!isOnTrackEntry(raw)) continue
    const x = numOrNull(raw.X) as number
    const y = numOrNull(raw.Y) as number
    const previous = path[path.length - 1]
    if (!previous || Math.hypot(previous.x - x, previous.y - y) > minDistance) {
      path.push({ x, y })
      if (path.length >= maxPoints) break
    }
  }
  return path
}

/** Raw diagnostic breakdown of where a live outline trace currently stands. */
export interface TrackTraceDebugInfo {
  /** Total raw Position stream points accumulated so far. */
  rawPointCount: number
  /** Driver number whose trajectory is being followed, or null if none found yet. */
  referenceDriver: number | null
  /** Length of the downsampled (but not yet necessarily closed) trace. */
  openTraceLength: number
}

export function debugTrackTraceInfo(
  points: F1StreamPoint[],
  knownReferenceDriver?: number | null
): TrackTraceDebugInfo {
  const referenceDriver =
    knownReferenceDriver !== undefined ? knownReferenceDriver : pickReferenceDriver(points)
  return {
    rawPointCount: points.length,
    referenceDriver,
    openTraceLength:
      referenceDriver == null
        ? 0
        : buildTrackPath(points, TRACK_PATH_MAX_POINTS, 150, referenceDriver).length
  }
}

/**
 * Shortest current F1 lap (Monaco) is ≈ 3.3 km; feed world coordinates are
 * ~decimetres, so a genuine full lap must cover well over 30,000 units.
 */
const MIN_CLOSED_LAP_UNITS = 30_000

/**
 * ONE lap of the circuit, or null while the reference car has not yet driven one.
 *
 * The trace is accepted only once the car has covered a plausible lap distance
 * AND come back to a point it already passed, so a partial download (or the
 * opening minutes of a live session) can never render a partial circuit.
 *
 * Closure is checked against ANY earlier point in the trace, not just the
 * very first one: whoever is watching usually connects mid-session, so
 * `path[0]` is just wherever the reference car happened to be when tracking
 * started — not the start/finish line — and may never be revisited that
 * precisely again even after a genuine full lap. Checking every earlier
 * point means a lap closes as soon as the car returns near ANYWHERE it has
 * already been, which is the actual definition of "completed a lap"
 * regardless of when tracking began.
 *
 * It returns the closed PREFIX (from the matched start point), not the whole
 * traced route. Returning everything meant the outline kept every subsequent
 * lap too — at Zandvoort the search window holds about seven of them — so the
 * map drew seven slightly different racing lines on top of each other and the
 * circuit came out as a thick scribble rather than a line.
 *
 * Among every (i, j) pair that clears the minimum-lap-distance and proximity
 * checks, the TIGHTEST geometric match wins — not the first one found in scan
 * order. A real F1 pit lane commonly runs close to (and shares a chunk of) the
 * main straight; if the reference car pits early, that short pit-lane loop can
 * itself satisfy both checks well before the true full-lap closure is
 * reached, and returning-on-first-match locked onto it: a "closed" loop that
 * was really just the pit lane, with the rest of the circuit — wherever every
 * other car actually was — never part of the trace, rendering as a cluster of
 * cars floating in space next to a real-looking but incomplete outline. The
 * true start/finish revisit is the SAME physical point crossed twice, so it
 * should match far more precisely than a merely-nearby but genuinely
 * different piece of track; picking the tightest match across the whole
 * search window (capped at `TRACK_PATH_MAX_POINTS`, so still a bounded scan)
 * is a general fix that doesn't depend on detecting "pit lane" specifically.
 */
export function buildClosedTrackPath(
  points: F1StreamPoint[],
  maxPoints = TRACK_PATH_MAX_POINTS,
  minDistance = 150
): { x: number; y: number }[] | null {
  return closeTrackTrace(buildTrackPath(points, maxPoints, minDistance), minDistance)
}

/**
 * The closing half of `buildClosedTrackPath`, for a caller that already built
 * the trace — so the same trace can double as the open fallback instead of
 * tracing the Position feed a second time.
 */
export function closeTrackTrace(
  path: { x: number; y: number }[],
  minDistance = 150
): { x: number; y: number }[] | null {
  if (path.length < 3) return null

  const steps: number[] = []
  for (let i = 1; i < path.length; i++) {
    steps.push(Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y))
  }
  // Position samples arrive about once a second, so at racing speed successive
  // points are ~45 m apart — far more than `minDistance`, which only thins
  // points that are too CLOSE together. The closure tolerance has to admit that
  // real spacing, or the trace steps straight over the start/finish line and the
  // lap is never recognised as closed.
  const median = [...steps].sort((a, b) => a - b)[steps.length >> 1]
  const closeDistance = Math.max(minDistance * 2, median * 1.5)

  // Cumulative distance from path[0] to path[k], so "distance between any two
  // points" is a subtraction rather than a re-sum per pair.
  const cumulative = [0]
  for (let k = 1; k < path.length; k++) cumulative.push(cumulative[k - 1] + steps[k - 1])

  let best: { i: number; j: number; distance: number } | null = null
  for (let i = 2; i < path.length; i++) {
    for (let j = 0; j < i; j++) {
      if (cumulative[i] - cumulative[j] < MIN_CLOSED_LAP_UNITS) continue
      const distance = Math.hypot(path[i].x - path[j].x, path[i].y - path[j].y)
      if (distance <= closeDistance && (!best || distance < best.distance)) {
        best = { i, j, distance }
      }
    }
  }
  if (!best) return null
  return [...path.slice(best.j, best.i + 1), path[best.j]]
}

export interface PositionCoordinates {
  x: number | null
  y: number | null
  z: number | null
}

/**
 * Is this Position entry a car that is actually somewhere on the circuit?
 *
 * F1 keeps every car in every Position frame. A car sitting in the garage (or
 * one the timing loop has lost) is reported as `Status: "OffTrack"` with
 * `X/Y/Z` all zero. Drawing those verbatim piles most of the field onto a
 * single point — and, worse, drags the map's bounding box out to include the
 * origin, so the cars that ARE running get squashed into a corner. That is why
 * the track map looked broken during a practice or qualifying session, where
 * most of the grid is in the garage most of the time.
 */
export function isOnTrackEntry(entry: Record<string, unknown>): boolean {
  const status = entry.Status
  if (typeof status === 'string' && status.toLowerCase() === 'offtrack') return false
  const x = numOrNull(entry.X)
  const y = numOrNull(entry.Y)
  if (x == null || y == null) return false
  // The feed's "no fix" sentinel. A real car is never exactly at the origin.
  return x !== 0 || y !== 0
}

/** Interpolate one complete Position frame at an arbitrary replay clock. */
export function positionCoordinatesAt(
  points: F1StreamPoint[],
  clock: number
): Record<string, PositionCoordinates> {
  if (points.length === 0) return {}
  let lo = 0
  let hi = points.length - 1
  let previousIndex = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (points[mid].t <= clock) {
      previousIndex = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  if (previousIndex < 0) return {}

  const previous = points[previousIndex]
  const next = points[previousIndex + 1] ?? null
  const previousEntries = positionEntries(previous.d)
  const nextEntries = next ? positionEntries(next.d) : {}
  const fraction =
    next && next.t > previous.t
      ? Math.max(0, Math.min(1, (clock - previous.t) / (next.t - previous.t)))
      : 0
  const result: Record<string, PositionCoordinates> = {}

  for (const [driverNumber, raw] of Object.entries(previousEntries)) {
    if (!/^\d+$/.test(driverNumber)) continue
    const from = rec(raw)
    // A garaged car has no place on the map — omit it rather than drawing it at
    // the feed's zero sentinel.
    if (!isOnTrackEntry(from)) {
      result[driverNumber] = { x: null, y: null, z: null }
      continue
    }
    const to = rec(nextEntries[driverNumber])
    // Only interpolate towards a frame that is itself a real position; a car
    // that goes OffTrack next frame must not be dragged towards the origin.
    const blend = isOnTrackEntry(to) ? fraction : 0
    result[driverNumber] = {
      x: interpolateCoordinate(numOrNull(from.X), numOrNull(to.X), blend),
      y: interpolateCoordinate(numOrNull(from.Y), numOrNull(to.Y), blend),
      z: interpolateCoordinate(numOrNull(from.Z), numOrNull(to.Z), blend)
    }
  }
  return result
}

function interpolateCoordinate(
  from: number | null,
  to: number | null,
  fraction: number
): number | null {
  if (from == null) return null
  return to == null ? from : from + (to - from) * fraction
}

function positionEntries(value: unknown): Record<string, unknown> {
  const batches = indexedToArray(rec(value).Position)
  return rec(rec(batches[batches.length - 1]).Entries)
}
