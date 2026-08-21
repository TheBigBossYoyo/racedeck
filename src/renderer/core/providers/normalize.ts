import type { FlagType, TyreCompound, RaceControlMessage } from '@shared/models'

/**
 * Pure normalization helpers shared by providers. Kept side-effect free so they
 * can be unit-tested directly (see tests/unit/provider-normalization.test.ts).
 */

export function normalizeCompound(raw: string | null | undefined): TyreCompound {
  if (!raw) return 'UNKNOWN'
  const s = raw.trim().toUpperCase()
  switch (s) {
    case 'SOFT':
    case 'S':
      return 'SOFT'
    case 'MEDIUM':
    case 'M':
      return 'MEDIUM'
    case 'HARD':
    case 'H':
      return 'HARD'
    case 'INTERMEDIATE':
    case 'INTER':
    case 'I':
      return 'INTERMEDIATE'
    case 'WET':
    case 'W':
    case 'FULL_WET':
      return 'WET'
    default:
      return 'UNKNOWN'
  }
}

export function normalizeFlag(raw: string | null | undefined): FlagType {
  if (!raw) return 'NONE'
  const s = raw.trim().toUpperCase()
  switch (s) {
    case 'GREEN':
      return 'GREEN'
    case 'YELLOW':
      return 'YELLOW'
    case 'DOUBLE YELLOW':
    case 'DOUBLE_YELLOW':
      return 'DOUBLE_YELLOW'
    case 'RED':
      return 'RED'
    case 'BLUE':
      return 'BLUE'
    case 'WHITE':
      return 'WHITE'
    case 'CHEQUERED':
    case 'CHECKERED':
      return 'CHEQUERED'
    case 'BLACK':
      return 'BLACK'
    case 'BLACK AND WHITE':
      return 'BLACK_WHITE'
    case 'BLACK AND ORANGE':
      return 'BLACK_ORANGE'
    default:
      return 'NONE'
  }
}

/** Derive a severity used for highlighting + alerting. */
export function raceControlSeverity(
  category: string | null | undefined,
  flag: FlagType,
  message: string | null | undefined
): RaceControlMessage['severity'] {
  const cat = (category ?? '').toLowerCase()
  const msg = (message ?? '').toLowerCase()
  if (flag === 'RED' || msg.includes('red flag') || cat.includes('safetycar') || msg.includes('safety car')) {
    return 'critical'
  }
  if (
    flag === 'YELLOW' ||
    flag === 'DOUBLE_YELLOW' ||
    msg.includes('vsc') ||
    msg.includes('virtual safety car') ||
    msg.includes('penalty') ||
    msg.includes('investigation') ||
    msg.includes('deleted')
  ) {
    return 'warning'
  }
  if (flag === 'GREEN' || flag === 'CHEQUERED' || cat.includes('drs') || cat.includes('overtake')) return 'notice'
  return 'info'
}

/** OpenF1 gap/interval → number | '+1 LAP' | null. */
export function normalizeGap(
  raw: number | string | null | undefined
): number | '+1 LAP' | null {
  if (raw == null) return null
  if (typeof raw === 'number') return isFinite(raw) ? raw : null
  const s = raw.trim().toUpperCase()
  if (s === '+1 LAP' || s.includes('LAP')) return '+1 LAP'
  const parsed = Number(s)
  return isFinite(parsed) ? parsed : null
}

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

/** Milliseconds since epoch from an ISO string; NaN-safe (returns 0). */
export function toMs(iso: string | null | undefined): number {
  if (!iso) return 0
  const t = Date.parse(iso)
  return isNaN(t) ? 0 : t
}
