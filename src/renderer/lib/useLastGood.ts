import { useRef } from 'react'

/**
 * Bridges over transient gaps (a live feed momentarily trailing the
 * interpolated "now" clock, a burst of empty polls) so a chart doesn't flash
 * to its empty state and back every time the underlying data drops out for a
 * beat. Grace is measured in real elapsed time, not render/tick count — the
 * host re-renders on whatever cadence the live/replay clock ticks at (not
 * guaranteed uniform), so a tick-count budget buys a different amount of
 * real protection depending on how often the caller happens to re-render.
 * After `graceMs` with no fresh value the data is treated as genuinely gone
 * (e.g. a session switch) and null is returned.
 */
export function useLastGood<T>(value: T | null, graceMs = 5_000): T | null {
  const lastGoodRef = useRef<T | null>(null)
  const lastGoodAtRef = useRef(0)

  if (value !== null) {
    lastGoodRef.current = value
    lastGoodAtRef.current = Date.now()
    return value
  }

  if (lastGoodRef.current !== null && Date.now() - lastGoodAtRef.current <= graceMs) {
    return lastGoodRef.current
  }

  lastGoodRef.current = null
  return null
}
