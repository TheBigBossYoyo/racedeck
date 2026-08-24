import type { RaceControlMessage } from '@shared/models'
import type { RaceSnapshot } from '@renderer/core/providers/types'

/**
 * Pit-stop performance history (APP_IMPROVEMENT_ROADMAP.md P2 item 24), built
 * from `snapshot.pitLaneTimes` — measured pit-lane transit, not a model
 * estimate. `underNeutralization`/`servedPenalty` are proximity heuristics
 * over `raceControl` text (the same idiom `PitCycleModel.classifyTrackContamination`
 * uses for sector yellows), not certain facts — labelled as such by the
 * caller, never presented as directly measured.
 */

const NEARBY_WINDOW_SEC = 180

export interface PitStopRecord {
  driverNumber: number
  lap: number | null
  durationSec: number
  /** Seconds vs the session median pit-lane transit; positive = slower. */
  deltaVsMedianSec: number | null
  /** A Safety Car/VSC race-control message landed shortly before this stop. */
  underNeutralization: boolean
  /** A penalty/served message for this driver landed near this stop. */
  servedPenalty: boolean
  /** Classified position after the lap before pitting, from `lapPositions`. */
  positionBefore: number | null
  /** Classified position two laps later (one lap to settle after rejoin). */
  positionAfter: number | null
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

function stopSessionTime(
  snapshot: RaceSnapshot,
  driverNumber: number,
  lap: number | null
): number | null {
  if (lap == null) return null
  const match = snapshot.laps.find(
    (l) => l.driverNumber === driverNumber && l.lapNumber === lap && l.isPitInLap
  )
  return match?.sessionTime ?? null
}

function isNeutralizationMessage(m: RaceControlMessage): boolean {
  const text = m.message.toUpperCase()
  return text.includes('SAFETY CAR') || text.includes('VSC')
}

function isPenaltyMessage(m: RaceControlMessage, driverNumber: number): boolean {
  if (m.driverNumber !== driverNumber) return false
  const text = m.message.toUpperCase()
  return text.includes('PENALTY') || text.includes('SERVED')
}

function nearby(
  messages: readonly RaceControlMessage[],
  sessionTime: number,
  predicate: (m: RaceControlMessage) => boolean
): boolean {
  return messages.some((m) => {
    if (m.sessionTime == null || !predicate(m)) return false
    return m.sessionTime <= sessionTime && sessionTime - m.sessionTime <= NEARBY_WINDOW_SEC
  })
}

function positionAtLap(snapshot: RaceSnapshot, driverNumber: number, lap: number): number | null {
  if (lap < 1) return null
  const series = snapshot.lapPositions?.find((s) => s.driverNumber === driverNumber)
  return series?.positions[lap - 1] ?? null
}

/** Every pit stop's measured transit time, compared against session median and nearby context. */
export function buildPitStopHistory(snapshot: RaceSnapshot): PitStopRecord[] {
  const times = snapshot.pitLaneTimes ?? []
  const medianSec = median(times.map((t) => t.duration))

  return times
    .map((t) => {
      const sessionTime = stopSessionTime(snapshot, t.driverNumber, t.lap)
      return {
        driverNumber: t.driverNumber,
        lap: t.lap,
        durationSec: t.duration,
        deltaVsMedianSec: medianSec != null ? t.duration - medianSec : null,
        underNeutralization:
          sessionTime != null && nearby(snapshot.raceControl, sessionTime, isNeutralizationMessage),
        servedPenalty:
          sessionTime != null &&
          nearby(snapshot.raceControl, sessionTime, (m) => isPenaltyMessage(m, t.driverNumber)),
        positionBefore: t.lap != null ? positionAtLap(snapshot, t.driverNumber, t.lap - 1) : null,
        positionAfter: t.lap != null ? positionAtLap(snapshot, t.driverNumber, t.lap + 1) : null
      }
    })
    .sort((a, b) => (a.lap ?? 0) - (b.lap ?? 0))
}
