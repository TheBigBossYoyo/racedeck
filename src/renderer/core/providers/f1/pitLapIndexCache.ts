import type { F1StreamPoint } from '@shared/f1live'
import { collectPitLaneTimes, pitLapIndex } from '../f1normalize'

type PitLaps = { in: Set<string>; out: Set<string> }

/**
 * F1's own statement of which laps were pit in-/out-laps, when the feed carries
 * it. Recomputed only when new pit entries arrive; the returned object's identity
 * changes exactly then, which the lap cache uses as part of its key.
 * Moved from F1LiveProvider.ts.
 */
export class PitLapIndexCache {
  private cache: PitLaps | undefined
  private points = -1

  get(pitLanePoints: F1StreamPoint[]): PitLaps | undefined {
    if (pitLanePoints.length === 0) return undefined
    if (this.cache && this.points === pitLanePoints.length) return this.cache
    this.points = pitLanePoints.length
    this.cache = pitLapIndex(collectPitLaneTimes(pitLanePoints, Infinity))
    return this.cache
  }
}
