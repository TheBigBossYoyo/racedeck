import { describe, expect, it } from 'vitest'
import { FeedMemo, countAtOrBefore } from '@renderer/core/providers/FeedMemo'
import type { F1StreamPoint } from '@shared/f1live'

/**
 * These memos are what stop the renderer re-deriving nine whole feeds four
 * times a second. The invariants that matter are that a cache hit is only ever
 * taken when the answer genuinely cannot have changed, and that the live case —
 * where the provider rebuilds each stream array on every poll — is a hit rather
 * than a full rebuild.
 */

const pts = (...ts: number[]): F1StreamPoint[] => ts.map((t) => ({ t, d: { t } }))

describe('countAtOrBefore', () => {
  it('counts the leading points at or before the clock', () => {
    const points = pts(0, 5, 10, 15)
    expect(countAtOrBefore(points, -1)).toBe(0)
    expect(countAtOrBefore(points, 0)).toBe(1)
    expect(countAtOrBefore(points, 12)).toBe(3)
    expect(countAtOrBefore(points, 99)).toBe(4)
    expect(countAtOrBefore([], 5)).toBe(0)
  })

  it('agrees with the break-on-first-later-point loops it replaces', () => {
    const points = pts(0, 1, 1, 2, 8, 8, 8, 40)
    for (const clock of [-5, 0, 1, 1.5, 2, 7, 8, 39, 40, 100]) {
      let expected = 0
      for (const p of points) {
        if (p.t > clock) break
        expected++
      }
      expect(countAtOrBefore(points, clock)).toBe(expected)
    }
  })
})

describe('FeedMemo', () => {
  it('computes once and reuses the result while nothing changes', () => {
    const memo = new FeedMemo<number>()
    const points = pts(0, 1, 2)
    let calls = 0
    const compute = () => ++calls

    expect(memo.read(points, 5, compute)).toBe(1)
    expect(memo.read(points, 5, compute)).toBe(1)
    expect(memo.read(points, 9, compute)).toBe(1) // clock moved, no new points
    expect(calls).toBe(1)
  })

  it('recomputes when the clock reaches a point it had not consumed', () => {
    const memo = new FeedMemo<number>()
    const points = pts(0, 10)
    let calls = 0
    const compute = () => ++calls

    memo.read(points, 5, compute)
    memo.read(points, 9, compute)
    expect(calls).toBe(1)
    memo.read(points, 10, compute)
    expect(calls).toBe(2)
  })

  it('holds through a live poll, which hands over a REBUILT array', () => {
    // The provider merges each delta as `[...old, ...new]`, so the array is a
    // different object every poll while the points inside it are the same
    // objects. Keying on array identity would make every poll a full rebuild.
    const memo = new FeedMemo<number>()
    const original = pts(0, 1, 2)
    let calls = 0
    const compute = () => ++calls

    memo.read(original, 5, compute)
    const afterPoll = [...original]
    expect(memo.read(afterPoll, 5, compute)).toBe(1)
    expect(calls).toBe(1)

    const withNewPoint = [...original, { t: 6, d: {} }]
    memo.read(withNewPoint, 8, compute)
    expect(calls).toBe(2)
  })

  it('recomputes when the clock is rewound', () => {
    const memo = new FeedMemo<number>()
    const points = pts(0, 1, 2)
    let calls = 0
    const compute = () => ++calls

    memo.read(points, 5, compute)
    memo.read(points, 0, compute) // scrubbed back — fewer points now apply
    expect(calls).toBe(2)
  })

  it('recomputes when the stream is replaced rather than extended', () => {
    // Same length, different points: a new session, not more of the old one.
    const memo = new FeedMemo<number>()
    let calls = 0
    const compute = () => ++calls

    memo.read(pts(0, 1, 2), 5, compute)
    memo.read(pts(0, 1, 2), 5, compute)
    expect(calls).toBe(2)
  })

  it('recomputes when a declared dependency changes', () => {
    const memo = new FeedMemo<string>()
    const points = pts(0)
    let path = 'a/'
    const compute = () => path

    expect(memo.read(points, 5, compute, [path])).toBe('a/')
    path = 'b/'
    expect(memo.read(points, 5, compute, [path])).toBe('b/')
  })

  it('forgets everything on reset', () => {
    const memo = new FeedMemo<number>()
    const points = pts(0)
    let calls = 0
    const compute = () => ++calls

    memo.read(points, 5, compute)
    memo.reset()
    memo.read(points, 5, compute)
    expect(calls).toBe(2)
  })

  it('caches a falsy result rather than recomputing it every read', () => {
    const memo = new FeedMemo<string | null>()
    const points = pts(0)
    let calls = 0
    const compute = () => {
      calls++
      return null
    }

    expect(memo.read(points, 5, compute)).toBeNull()
    expect(memo.read(points, 5, compute)).toBeNull()
    expect(calls).toBe(1)
  })

  it('caches an undefined result rather than recomputing it every read', () => {
    const memo = new FeedMemo<undefined>()
    const points = pts(0)
    let calls = 0
    const compute = (): undefined => {
      calls++
      return undefined
    }

    expect(memo.read(points, 5, compute)).toBeUndefined()
    expect(memo.read(points, 5, compute)).toBeUndefined()
    expect(calls).toBe(1)
  })
})
