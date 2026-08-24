import type { Point } from '@renderer/core/engines/geometry'

export type DriverDot = Point & {
  readonly number: number
  readonly code: string
  readonly color: string
  readonly position: number | null
  readonly isRetired: boolean
  readonly isInPit: boolean
  readonly isFastestLap: boolean
  /** True when this position is dead-reckoned (feed stale), not a real reading. */
  readonly extrapolated?: boolean
}
