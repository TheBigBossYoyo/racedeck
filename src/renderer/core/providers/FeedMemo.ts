import type { F1StreamPoint } from '@shared/f1live'

/**
 * Memoization for the "derive X from the whole feed up to `clock`" normalizers.
 *
 * Those functions (`buildLapPositions`, `buildSessionBests`, `collectTeamRadio`,
 * …) each walk their entire stream and, in several cases, deep-merge every point
 * into a fresh object graph. That is correct but was being redone from scratch
 * for EVERY snapshot — four times a second, for nine separate feeds, against
 * arrays that only ever grow. The cost therefore climbed steadily with session
 * length until, an hour into a session, the renderer spent most of its time
 * re-deriving state that had not changed and allocating garbage; the UI stalled
 * and the tab could be killed for it.
 *
 * The observation that fixes it: each of these outputs is a pure function of the
 * points with `t <= clock`. So the number of such points, together with the
 * identity of the last one, is a complete cache key. Recomputation then happens
 * only when a feed actually receives something new — a few times a minute for
 * most of these — instead of on every tick.
 */

/**
 * How many leading points fall at or before `clock`.
 *
 * Streams are time-ordered (the socket sorts the one feed that can backfill), so
 * this binary search returns exactly what the normalizers' `if (t > tMax) break`
 * loops would have consumed, in O(log n) rather than O(n).
 */
export function countAtOrBefore(points: F1StreamPoint[], clock: number): number {
  let lo = 0
  let hi = points.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (points[mid].t <= clock) lo = mid + 1
    else hi = mid
  }
  return lo
}

/**
 * Caches one derived value against the prefix of a stream that produced it.
 *
 * Holding the last consumed point by identity — not just the count — is what
 * makes this safe on a live session: the provider grows
 * each stream array IN PLACE as polls arrive (copying it once on first append), so
 * array identity says nothing about whether its contents changed. The point
 * OBJECTS are never replaced by an append, though, and a differing one at the same
 * prefix length means the underlying data was replaced rather than extended.
 */
export class FeedMemo<R> {
  private count = -1
  private lastPoint: F1StreamPoint | null = null
  private result: { readonly value: R } | null = null
  /** Extra inputs (beyond the points) the last result was computed from. */
  private deps: readonly unknown[] = []

  /**
   * `compute` receives the same arguments the un-memoized call would have, and
   * must be pure with respect to them. `deps` covers any other value the result
   * depends on (a session path, say); a change to one forces recomputation.
   */
  read(points: F1StreamPoint[], clock: number, compute: () => R, deps: readonly unknown[] = []): R {
    const count = countAtOrBefore(points, clock)
    const lastPoint = count > 0 ? points[count - 1] : null
    if (
      this.result &&
      count === this.count &&
      lastPoint === this.lastPoint &&
      sameDeps(deps, this.deps)
    ) {
      return this.result.value
    }
    this.count = count
    this.lastPoint = lastPoint
    this.deps = deps
    const value = compute()
    this.result = { value }
    return value
  }

  /** Drop the cached value (used when a new session replaces the streams). */
  reset(): void {
    this.count = -1
    this.lastPoint = null
    this.result = null
    this.deps = []
  }
}

function sameDeps(a: readonly unknown[], b: readonly unknown[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false
  return true
}
