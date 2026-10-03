/**
 * Binary-search the last element with `date` (ms) at or before `wallMs`.
 * `items` MUST be sorted ascending by the numeric ms accessor.
 */
export function nearestAtOrBefore<T>(
  items: T[],
  wallMs: number,
  ms: (item: T) => number
): T | null {
  if (items.length === 0) return null
  let lo = 0
  let hi = items.length - 1
  let result: T | null = null
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (ms(items[mid]) <= wallMs) {
      result = items[mid]
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return result
}
