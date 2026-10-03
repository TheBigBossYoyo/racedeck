import { indexedToArray, type F1StreamPoint } from '@shared/f1live'
import type { SessionInfo } from '@shared/models'
import { buildTimeline } from '@renderer/core/engines/SessionPhaseEngine'
import type { SessionTimeline } from '../types'
import { lapCountAt, trackStatusAt } from '../f1normalize'
import { rec } from './shared'

/** The feeds the scrubber timeline is derived from. Moved from F1LiveProvider.ts. */
export interface TimelineFeeds {
  trackStatusPoints: F1StreamPoint[]
  lapCountPoints: F1StreamPoint[]
  raceControlPoints: F1StreamPoint[]
  duration: number
  type: SessionInfo['type']
}

export function buildSessionTimeline(
  feeds: TimelineFeeds,
  qualifyingParts: { t: number; part: 1 | 2 | 3 }[]
): SessionTimeline {
  const trackStatus = feeds.trackStatusPoints.map((p) => ({ t: p.t, status: trackStatusAt(p) }))
  const lapCount = feeds.lapCountPoints.map((p) => {
    const lc = lapCountAt(p)
    return { t: p.t, current: lc.current, total: lc.total }
  })
  const chequeredTimes = findChequeredTimes(feeds.raceControlPoints)
  const qualifyingPhaseEnds = qualifyingParts.flatMap((part, index) => {
    const nextStart = qualifyingParts[index + 1]?.t ?? Number.POSITIVE_INFINITY
    const end = chequeredTimes.find((time) => time >= part.t && time < nextStart)
    return end == null ? [] : [{ t: end, part: part.part }]
  })
  return buildTimeline({
    duration: feeds.duration,
    type: feeds.type,
    trackStatus,
    lapCount,
    qualifyingParts,
    qualifyingPhaseEnds,
    chequeredHint: chequeredTimes[chequeredTimes.length - 1] ?? null
  })
}

/** Feed times (s) of chequered flags, including Q1/Q2/Q3 phase ends. */
function findChequeredTimes(raceControlPoints: F1StreamPoint[]): number[] {
  const times: number[] = []
  for (const p of raceControlPoints) {
    const msgs = rec(p.d).Messages
    const list = Array.isArray(msgs) ? msgs : indexedToArray(msgs)
    for (const raw of list) {
      const m = rec(raw)
      const flag = String(m.Flag ?? '').toUpperCase()
      const text = String(m.Message ?? '').toUpperCase()
      if (flag === 'CHEQUERED' || text.includes('CHEQUERED') || text.includes('CHECKERED')) {
        if (times[times.length - 1] !== p.t) times.push(p.t)
        break
      }
    }
  }
  return times
}

/** Total race laps: the last non-null total the LapCount feed ever stated. */
export function deriveTotalLaps(lapCountPoints: F1StreamPoint[]): number | null {
  let total: number | null = null
  for (const p of lapCountPoints) {
    const t = lapCountAt(p).total
    if (t != null) total = t
  }
  return total
}
