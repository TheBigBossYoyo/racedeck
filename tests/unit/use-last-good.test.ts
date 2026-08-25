import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useLastGood } from '../../src/renderer/lib/useLastGood'

describe('useLastGood', () => {
  it('passes through non-null values unchanged', () => {
    const { result, rerender } = renderHook(({ value }) => useLastGood(value), {
      initialProps: { value: 1 as number | null }
    })
    expect(result.current).toBe(1)
    rerender({ value: 2 })
    expect(result.current).toBe(2)
  })

  it('holds the last good value across up to graceTicks consecutive nulls', () => {
    const { result, rerender } = renderHook(({ value }) => useLastGood(value, 3), {
      initialProps: { value: 'a' as string | null }
    })
    expect(result.current).toBe('a')

    rerender({ value: null })
    expect(result.current).toBe('a')
    rerender({ value: null })
    expect(result.current).toBe('a')
    rerender({ value: null })
    expect(result.current).toBe('a')
  })

  it('falls through to null once nulls exceed graceTicks', () => {
    const { result, rerender } = renderHook(({ value }) => useLastGood(value, 2), {
      initialProps: { value: 'a' as string | null }
    })

    rerender({ value: null })
    rerender({ value: null })
    expect(result.current).toBe('a')
    rerender({ value: null })
    expect(result.current).toBeNull()
  })

  it('resets the miss counter once a fresh value arrives', () => {
    const { result, rerender } = renderHook(({ value }) => useLastGood(value, 1), {
      initialProps: { value: 'a' as string | null }
    })

    rerender({ value: null })
    expect(result.current).toBe('a')
    rerender({ value: 'b' })
    expect(result.current).toBe('b')
    rerender({ value: null })
    expect(result.current).toBe('b')
    rerender({ value: null })
    expect(result.current).toBeNull()
  })
})
