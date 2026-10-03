import type { SessionType } from '@shared/models'

/**
 * The session phase timeline shape. `SessionPhaseEngine` builds it and the
 * scrubber renders it; the `DataProvider` contract only needs the type, so it
 * lives here rather than making `core/providers/types.ts` import an engine.
 * `SessionPhaseEngine` and `core/providers/types.ts` both re-export these.
 */

export type PhaseKind = 'pre' | 'green' | 'q1' | 'q2' | 'q3' | 'break' | 'yellow' | 'vsc' | 'sc' | 'red' | 'post'

export interface RacePhaseSegment {
  kind: PhaseKind
  tStart: number
  tEnd: number
  lapStart: number | null
  lapEnd: number | null
}

export interface SessionTimeline {
  segments: RacePhaseSegment[]
  /** Feed time (s) racing goes green (lights out for a race). */
  greenStart: number | null
  /** Feed time (s) of the chequered flag / race end. */
  chequered: number | null
  totalLaps: number | null
  type: SessionType
  duration: number
}
