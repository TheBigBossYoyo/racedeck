import { describe, expect, it } from 'vitest'
import {
  TimingRing,
  formatP50P95,
  getDerivationTimingStats,
  percentile,
  recordDerivation,
  recordWidgetRender,
  resetDerivationTimings
} from '@renderer/core/engines/DerivationTimings'

describe('TimingRing', () => {
  it('reports null, not zeros, when empty', () => {
    const ring = new TimingRing(4)
    expect(ring.stats()).toBeNull()
    expect(ring.size).toBe(0)
  })

  it('computes nearest-rank percentiles on known inputs', () => {
    const ring = new TimingRing(200)
    for (let i = 100; i >= 1; i--) ring.record(i) // out of order on purpose
    expect(ring.stats()).toEqual({ count: 100, p50: 50, p95: 95, max: 100 })
  })

  it('handles a single sample', () => {
    const ring = new TimingRing(4)
    ring.record(7.5)
    expect(ring.stats()).toEqual({ count: 1, p50: 7.5, p95: 7.5, max: 7.5 })
  })

  it('overwrites the oldest samples once full and never reports more than capacity', () => {
    const ring = new TimingRing(3)
    for (const v of [100, 1, 2, 3, 4]) ring.record(v) // 100 and 1 are evicted
    expect(ring.size).toBe(3)
    expect(ring.stats()).toEqual({ count: 3, p50: 3, p95: 4, max: 4 })
  })

  it('wraps repeatedly without drifting', () => {
    const ring = new TimingRing(4)
    for (let i = 1; i <= 41; i++) ring.record(i)
    expect(ring.stats()).toEqual({ count: 4, p50: 39, p95: 41, max: 41 })
  })

  it('ignores non-finite values so one bad timer read cannot poison the stats', () => {
    const ring = new TimingRing(4)
    ring.record(Number.NaN)
    ring.record(Number.POSITIVE_INFINITY)
    expect(ring.stats()).toBeNull()
    ring.record(2)
    expect(ring.stats()?.count).toBe(1)
  })

  it('reset returns to the empty state', () => {
    const ring = new TimingRing(2)
    ring.record(1)
    ring.reset()
    expect(ring.stats()).toBeNull()
  })

  it('rejects an invalid capacity', () => {
    expect(() => new TimingRing(0)).toThrow(RangeError)
    expect(() => new TimingRing(1.5)).toThrow(RangeError)
  })

  it('does not mutate its samples when reading stats', () => {
    const ring = new TimingRing(3)
    ring.record(3)
    ring.record(1)
    ring.record(2)
    ring.stats()
    ring.record(0) // evicts 3, the oldest; order of insertion must be intact
    expect(ring.stats()).toEqual({ count: 3, p50: 1, p95: 2, max: 2 })
  })
})

describe('percentile', () => {
  it('is null for no samples and exact on small sets', () => {
    expect(percentile([], 50)).toBeNull()
    expect(percentile([4, 1, 3, 2], 50)).toBe(2)
    expect(percentile([4, 1, 3, 2], 95)).toBe(4)
    expect(percentile([5], 0)).toBe(5)
  })
})

describe('module rings', () => {
  it('records build and fan-out together and resets', () => {
    resetDerivationTimings()
    expect(getDerivationTimingStats()).toEqual({
      snapshotBuild: null,
      fanOut: null,
      widgetRender: null
    })
    recordDerivation(1, 10)
    recordDerivation(3, 30)
    recordWidgetRender(5)
    const stats = getDerivationTimingStats()
    expect(stats.snapshotBuild).toEqual({ count: 2, p50: 1, p95: 3, max: 3 })
    expect(stats.fanOut).toEqual({ count: 2, p50: 10, p95: 30, max: 30 })
    expect(stats.widgetRender?.count).toBe(1)
    resetDerivationTimings()
  })

  it('formats a p50 / p95 pair, or a dash when empty', () => {
    expect(formatP50P95(null)).toBe('—')
    expect(formatP50P95({ count: 3, p50: 1.234, p95: 12.34, max: 20 })).toBe('1.23 / 12.3')
  })
})
