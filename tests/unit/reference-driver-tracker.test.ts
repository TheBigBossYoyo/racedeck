import { describe, expect, it } from 'vitest'
import type { F1StreamPoint } from '@shared/f1live'
import {
  ReferenceDriverTracker,
  buildClosedTrackPath,
  buildTrackPath,
  closeTrackTrace,
  debugTrackTraceInfo,
  pickReferenceDriver
} from '@renderer/core/providers/f1normalize'
import { buildCircularPositions } from './fixtures/f1SyntheticSession'

/** Random Position frames: some cars garaged (OffTrack / origin), some missing. */
function randomPositions(count: number, seed: number): F1StreamPoint[] {
  let a = seed
  const rand = (): number => {
    a = (Math.imul(a, 1664525) + 1013904223) >>> 0
    return a / 4294967296
  }
  return Array.from({ length: count }, (_, t) => {
    const entries: Record<string, unknown> = {}
    for (let n = 1; n <= 6; n++) {
      const r = rand()
      if (r < 0.15) continue
      if (r < 0.3) entries[String(n)] = { Status: 'OffTrack', X: 0, Y: 0, Z: 0 }
      else if (r < 0.4) entries[String(n)] = { X: 0, Y: 0, Z: 0 }
      else entries[String(n)] = { X: 100 + t * 10 + n, Y: 200 + n, Z: 1 }
    }
    return { t, d: { Position: { '0': { Entries: entries } } } }
  })
}

describe('ReferenceDriverTracker', () => {
  it('names the same driver as a full scan after every append', () => {
    const points = randomPositions(300, 11)
    const tracker = new ReferenceDriverTracker()
    for (let end = 0; end <= points.length; end += 7) {
      const prefix = points.slice(0, end)
      expect(tracker.update(prefix)).toBe(pickReferenceDriver(prefix))
    }
  })

  it('agrees when the array is rebuilt around the same point objects', () => {
    const points = randomPositions(120, 5)
    const tracker = new ReferenceDriverTracker()
    tracker.update(points.slice(0, 60))
    expect(tracker.update([...points.slice(0, 60), ...points.slice(60)])).toBe(
      pickReferenceDriver(points)
    )
  })

  it('restarts its tally when the front of the array is trimmed away', () => {
    const points = randomPositions(200, 21)
    const tracker = new ReferenceDriverTracker()
    tracker.update(points)
    const trimmed = points.slice(150)
    expect(tracker.update(trimmed)).toBe(pickReferenceDriver(trimmed))
    // ...and keeps counting incrementally from there.
    const grown = [...trimmed, ...randomPositions(50, 99).map((p, i) => ({ ...p, t: 200 + i }))]
    expect(tracker.update(grown)).toBe(pickReferenceDriver(grown))
  })

  it('is null for an empty feed and after a reset', () => {
    const tracker = new ReferenceDriverTracker()
    expect(tracker.update([])).toBeNull()
    tracker.update(randomPositions(10, 1))
    tracker.reset()
    expect(tracker.update([])).toBeNull()
  })
})

describe('track trace helpers accept a precomputed reference driver', () => {
  const lap = buildCircularPositions([1, 2], 120)

  it('builds the same trace with or without it', () => {
    const driver = pickReferenceDriver(lap)
    expect(buildTrackPath(lap, undefined, undefined, driver)).toEqual(buildTrackPath(lap))
    expect(debugTrackTraceInfo(lap, driver)).toEqual(debugTrackTraceInfo(lap))
  })

  it('closes a trace identically to buildClosedTrackPath', () => {
    expect(closeTrackTrace(buildTrackPath(lap))).toEqual(buildClosedTrackPath(lap))
    expect(closeTrackTrace(buildTrackPath(lap))).not.toBeNull()
  })

  it('treats an explicit null reference driver as "none found"', () => {
    expect(buildTrackPath(lap, undefined, undefined, null)).toEqual([])
    expect(closeTrackTrace([])).toBeNull()
  })
})
