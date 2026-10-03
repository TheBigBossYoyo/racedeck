/** Summary of a timing ring; `null` (not zeros) when nothing has been recorded. */
export interface TimingStats {
  count: number
  p50: number
  p95: number
  max: number
}

/** Last N durations in milliseconds, in a preallocated buffer: recording never allocates. */
export class TimingRing {
  private readonly samples: Float64Array
  private next = 0
  private filled = 0

  constructor(readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new RangeError('TimingRing capacity must be a positive integer')
    }
    this.samples = new Float64Array(capacity)
  }

  record(ms: number): void {
    if (!Number.isFinite(ms)) return
    this.samples[this.next] = ms
    this.next = (this.next + 1) % this.capacity
    if (this.filled < this.capacity) this.filled++
  }

  /** Samples currently retained (capped at capacity). */
  get size(): number {
    return this.filled
  }

  /** Sorts a copy, so reading is O(n log n) and meant for occasional diagnostics, not per tick. */
  stats(): TimingStats | null {
    if (this.filled === 0) return null
    const sorted = this.samples.slice(0, this.filled).sort()
    return {
      count: this.filled,
      p50: nearestRank(sorted, 50),
      p95: nearestRank(sorted, 95),
      max: sorted[sorted.length - 1]
    }
  }

  reset(): void {
    this.next = 0
    this.filled = 0
  }
}

/** Nearest-rank percentile of an ascending, non-empty array. */
function nearestRank(sorted: Float64Array, percentile: number): number {
  const rank = Math.ceil((percentile / 100) * sorted.length)
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1]
}

/** Nearest-rank percentile of any samples, or null when there are none. */
export function percentile(samples: readonly number[], p: number): number | null {
  if (samples.length === 0) return null
  return nearestRank(Float64Array.from(samples).sort(), p)
}

export const DERIVATION_RING_SIZE = 240

export interface DerivationTimingStats {
  /** manager.getSnapshotAt + publishing the snapshot to the store. */
  snapshotBuild: TimingStats | null
  /** The alert / race-story / engineer-notes / radio-notify ingests. */
  fanOut: TimingStats | null
  /** React commit time (Profiler actualDuration); only populated in a dev build. */
  widgetRender: TimingStats | null
}

const snapshotBuildRing = new TimingRing(DERIVATION_RING_SIZE)
const fanOutRing = new TimingRing(DERIVATION_RING_SIZE)
const widgetRenderRing = new TimingRing(DERIVATION_RING_SIZE)

/** One recompute: recorded together so the two rings always hold the same number of samples. */
export function recordDerivation(snapshotBuildMs: number, fanOutMs: number): void {
  snapshotBuildRing.record(snapshotBuildMs)
  fanOutRing.record(fanOutMs)
}

export function recordWidgetRender(ms: number): void {
  widgetRenderRing.record(ms)
}

export function getDerivationTimingStats(): DerivationTimingStats {
  return {
    snapshotBuild: snapshotBuildRing.stats(),
    fanOut: fanOutRing.stats(),
    widgetRender: widgetRenderRing.stats()
  }
}

export function resetDerivationTimings(): void {
  snapshotBuildRing.reset()
  fanOutRing.reset()
  widgetRenderRing.reset()
}

const fmt = (n: number): string => n.toFixed(n < 10 ? 2 : 1)

/** "1.20 / 3.40" style pair, or "—" when there is nothing to show. */
export function formatP50P95(stats: TimingStats | null): string {
  return stats ? `${fmt(stats.p50)} / ${fmt(stats.p95)}` : '—'
}
