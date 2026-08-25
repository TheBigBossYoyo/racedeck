import { useRef } from 'react'

/**
 * Bridges over transient null ticks (a single missed poll, a live feed
 * momentarily trailing the interpolated "now" clock) so a chart doesn't
 * flash to its empty state and back every time the underlying data drops
 * out for one beat. After `graceTicks` consecutive nulls the value is
 * treated as genuinely gone (e.g. a session switch) and null is returned.
 */
export function useLastGood<T>(value: T | null, graceTicks = 3): T | null {
  const lastGoodRef = useRef<T | null>(null)
  const missCountRef = useRef(0)

  if (value !== null) {
    lastGoodRef.current = value
    missCountRef.current = 0
    return value
  }

  missCountRef.current += 1
  if (missCountRef.current <= graceTicks && lastGoodRef.current !== null) {
    return lastGoodRef.current
  }

  lastGoodRef.current = null
  return null
}
