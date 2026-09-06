import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useLastGood } from '../../src/renderer/lib/useLastGood'

describe('useLastGood', () => {
  afterEach(() => vi.useRealTimers())

  it('passes through non-null values unchanged', () => {
    const { result, rerender } = renderHook(({ value }) => useLastGood(value), {
      initialProps: { value: 1 as number | null }
    })
    expect(result.current).toBe(1)
    rerender({ value: 2 })
    expect(result.current).toBe(2)
  })

  it('holds the last good value while inside the grace window, regardless of tick count', () => {
    vi.useFakeTimers()
    const { result, rerender } = renderHook(({ value }) => useLastGood(value, 5_000), {
      initialProps: { value: 'a' as string | null }
    })
    expect(result.current).toBe('a')

    // Many rapid null re-renders within the grace window — a tick-count budget
    // would have exhausted after a handful; time-based must not.
    for (let i = 0; i < 20; i++) {
      act(() => vi.advanceTimersByTime(100))
      rerender({ value: null })
    }
    expect(result.current).toBe('a')
  })

  it('falls through to null once the grace window elapses with no fresh value', () => {
    vi.useFakeTimers()
    const { result, rerender } = renderHook(({ value }) => useLastGood(value, 2_000), {
      initialProps: { value: 'a' as string | null }
    })

    rerender({ value: null })
    act(() => vi.advanceTimersByTime(1_999))
    rerender({ value: null })
    expect(result.current).toBe('a')

    act(() => vi.advanceTimersByTime(2))
    rerender({ value: null })
    expect(result.current).toBeNull()
  })

  it('resets the grace window once a fresh value arrives', () => {
    vi.useFakeTimers()
    const { result, rerender } = renderHook(({ value }) => useLastGood(value, 1_000), {
      initialProps: { value: 'a' as string | null }
    })

    act(() => vi.advanceTimersByTime(900))
    rerender({ value: 'b' })
    expect(result.current).toBe('b')

    act(() => vi.advanceTimersByTime(900))
    rerender({ value: null })
    expect(result.current).toBe('b')

    act(() => vi.advanceTimersByTime(200))
    rerender({ value: null })
    expect(result.current).toBeNull()
  })

  it('bridges a boolean availability flag by mapping "unavailable" to null first (GapChart use case)', () => {
    // useLastGood only bridges its `null` sentinel, not `false` — passing a
    // raw boolean straight through returns `false` immediately with zero
    // bridging. The caller (GapChart.tsx) maps "not currently available" to
    // `null` before calling this hook; this test locks in that pattern.
    vi.useFakeTimers()
    const { result, rerender } = renderHook(
      ({ availability }: { availability: boolean }) =>
        useLastGood(availability ? true : null, 5_000),
      { initialProps: { availability: true } }
    )
    expect(result.current).toBe(true)

    // Data rebuild occurs: availability momentarily becomes false.
    rerender({ availability: false })
    expect(result.current).toBe(true) // Still true within grace window

    // Still false after a short time.
    act(() => vi.advanceTimersByTime(100))
    rerender({ availability: false })
    expect(result.current).toBe(true)

    // Data becomes available again before the grace window expires.
    act(() => vi.advanceTimersByTime(1_000))
    rerender({ availability: true })
    expect(result.current).toBe(true)

    // Genuinely gone for good: falls through to null once the grace window elapses.
    rerender({ availability: false })
    act(() => vi.advanceTimersByTime(5_001))
    rerender({ availability: false })
    expect(result.current).toBeNull()
  })
})
