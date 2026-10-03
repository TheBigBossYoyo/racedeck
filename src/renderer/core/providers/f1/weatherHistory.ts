import type { WeatherSample } from '@shared/models'
import type { F1StreamPoint } from '@shared/f1live'
import { weatherAt } from '../f1normalize'

/** Every weather sample at or before `clock`, oldest first. Moved from F1LiveProvider.ts. */
export function weatherHistoryUpTo(points: F1StreamPoint[], clock: number): WeatherSample[] {
  return points
    .filter((p) => p.t <= clock)
    .map((p) => weatherAt(p))
    .filter((w): w is WeatherSample => w !== null)
}
