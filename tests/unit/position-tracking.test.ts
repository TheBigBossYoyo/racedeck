import { describe, expect, it } from 'vitest'
import {
  updatePositionTrack,
  extrapolatePosition,
  reconcileLivePositions,
  type PositionTrack
} from '@renderer/widgets/trackMap/positionTracking'
import type { DriverDot } from '@renderer/widgets/trackMap/types'

// APP_IMPROVEMENT_ROADMAP.md P1 item 12: bounded dead-reckoning through brief
// live position outages.

function dot(overrides: Partial<DriverDot> = {}): DriverDot {
  return {
    x: 100,
    y: 100,
    number: 1,
    code: 'AAA',
    color: '#fff',
    position: 1,
    isRetired: false,
    isInPit: false,
    isFastestLap: false,
    ...overrides
  }
}

describe('updatePositionTrack', () => {
  it('seeds a fresh track with zero velocity on first sight', () => {
    const track = updatePositionTrack(undefined, { x: 10, y: 20 }, 1_000)
    expect(track).toEqual({ x: 10, y: 20, vx: 0, vy: 0, updatedAtMs: 1_000 })
  })

  it('derives velocity from a genuine move', () => {
    const previous: PositionTrack = { x: 0, y: 0, vx: 0, vy: 0, updatedAtMs: 1_000 }
    const track = updatePositionTrack(previous, { x: 10, y: 0 }, 1_100)
    expect(track.vx).toBeCloseTo(0.1, 5) // 10 units / 100ms
    expect(track.vy).toBeCloseTo(0, 5)
    expect(track.updatedAtMs).toBe(1_100)
  })

  it('leaves the track untouched (same reference) when the reading is frozen', () => {
    const previous: PositionTrack = { x: 5, y: 5, vx: 0.2, vy: 0.1, updatedAtMs: 1_000 }
    const track = updatePositionTrack(previous, { x: 5, y: 5 }, 2_000)
    expect(track).toBe(previous)
  })
})

describe('extrapolatePosition', () => {
  it('projects forward by velocity × elapsed time', () => {
    const track: PositionTrack = { x: 0, y: 0, vx: 0.1, vy: 0.05, updatedAtMs: 1_000 }
    const projected = extrapolatePosition(track, 1_100, 100)
    expect(projected.x).toBeCloseTo(10, 5)
    expect(projected.y).toBeCloseTo(5, 5)
  })

  it('clamps the projection to maxDistance', () => {
    const track: PositionTrack = { x: 0, y: 0, vx: 1, vy: 0, updatedAtMs: 1_000 }
    const projected = extrapolatePosition(track, 1_100, 5) // would-be dx=100, capped to 5
    expect(projected.x).toBeCloseTo(5, 5)
    expect(projected.y).toBeCloseTo(0, 5)
  })

  it('does not move a stationary car', () => {
    const track: PositionTrack = { x: 3, y: 4, vx: 0, vy: 0, updatedAtMs: 1_000 }
    expect(extrapolatePosition(track, 5_000, 50)).toEqual({ x: 3, y: 4 })
  })
})

describe('reconcileLivePositions', () => {
  it('leaves dots untouched below the stale threshold', () => {
    const tracked = new Map<number, PositionTrack>()
    tracked.set(1, { x: 100, y: 100, vx: 0.1, vy: 0, updatedAtMs: 1_000 })
    const dots = [dot({ x: 100, y: 100 })]

    const result = reconcileLivePositions(
      dots,
      tracked,
      1_500,
      2_000 /* feedFreshnessMs */,
      5_000 /* threshold */,
      20
    )

    expect(result[0].extrapolated).toBeUndefined()
    expect(result[0].x).toBe(100)
  })

  it('extrapolates a frozen dot once the feed has been stale past the threshold', () => {
    const tracked = new Map<number, PositionTrack>()
    tracked.set(1, { x: 100, y: 100, vx: 0.1, vy: 0, updatedAtMs: 1_000 })
    const dots = [dot({ x: 100, y: 100 })]

    const result = reconcileLivePositions(dots, tracked, 1_100, 6_000 /* stale */, 5_000, 50)

    expect(result[0].extrapolated).toBe(true)
    expect(result[0].x).toBeCloseTo(110, 5) // 0.1 * 100ms
  })

  it('does not extrapolate a dot with no prior track (first sight)', () => {
    const tracked = new Map<number, PositionTrack>()
    const dots = [dot({ x: 50, y: 50 })]

    const result = reconcileLivePositions(dots, tracked, 1_000, 6_000, 5_000, 50)

    expect(result[0].extrapolated).toBeUndefined()
    expect(tracked.get(1)).toEqual({ x: 50, y: 50, vx: 0, vy: 0, updatedAtMs: 1_000 })
  })

  it('does not extrapolate a dot that genuinely moved this tick, even while stale', () => {
    const tracked = new Map<number, PositionTrack>()
    tracked.set(1, { x: 100, y: 100, vx: 0.1, vy: 0, updatedAtMs: 1_000 })
    const dots = [dot({ x: 105, y: 100 })] // moved for real

    const result = reconcileLivePositions(dots, tracked, 1_050, 6_000, 5_000, 50)

    expect(result[0].extrapolated).toBeUndefined()
    expect(result[0].x).toBe(105)
  })
})
