import type { PositionSample, TimingEntry } from '@shared/models'
import type { F1StreamPoint } from '@shared/f1live'
import { positionCoordinatesAt } from '../f1normalize'

/**
 * One `PositionSample` per timing row at session time `clock`. Coordinates stay
 * hidden (null) until the provider has published positions. Moved from
 * F1LiveProvider.ts.
 */
export function positionsAt(
  positionPoints: F1StreamPoint[],
  published: boolean,
  clock: number,
  timing: TimingEntry[]
): PositionSample[] {
  const entries = published ? positionCoordinatesAt(positionPoints, clock) : {}
  const iso = new Date(clock * 1000).toISOString()
  return timing.map((e) => {
    const p = entries[String(e.driverNumber)]
    return {
      driverNumber: e.driverNumber,
      date: iso,
      x: p?.x ?? null,
      y: p?.y ?? null,
      z: p?.z ?? null,
      position: e.position,
      lapProgress: null
    }
  })
}
