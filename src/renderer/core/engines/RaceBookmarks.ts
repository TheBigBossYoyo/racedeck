import type { RaceSnapshot } from '@renderer/core/model/snapshot'

/**
 * Race-state bookmarks for replay (APP_IMPROVEMENT_ROADMAP.md P1 item 13).
 *
 * Race story, race control, pits, radio and timeline data already exist
 * separately, scattered across the current-clock-bound snapshot. Bookmarks
 * need the WHOLE session regardless of the current playhead — a viewer at
 * lap 1 should see (and be able to click) a marker for lap 40's safety car
 * before reaching it — so this is deliberately built from one snapshot taken
 * at the session's full duration, not the live/playhead-bound race story.
 *
 * Pure and side-effect free: everything here comes from fields `RaceSnapshot`
 * already carries when queried at `duration` (`raceControl`, `laps`,
 * `lapPositions`, `teamRadio`).
 */

export type RaceBookmarkKind =
  | 'start'
  | 'safety-car'
  | 'vsc'
  | 'red-flag'
  | 'pit-stop'
  | 'lead-change'
  | 'penalty'
  | 'radio'
  | 'fastest-lap'

export interface RaceBookmark {
  readonly kind: RaceBookmarkKind
  /** Data-clock seconds since session start. */
  readonly t: number
  readonly label: string
  readonly driverNumber?: number
}

function raceControlBookmarks(snapshot: RaceSnapshot): RaceBookmark[] {
  const out: RaceBookmark[] = []
  for (const m of snapshot.raceControl) {
    if (m.sessionTime == null) continue
    const text = m.message.toUpperCase()
    if (m.flag === 'RED' || text.includes('RED FLAG')) {
      out.push({ kind: 'red-flag', t: m.sessionTime, label: 'Red flag' })
    } else if (text.includes('VIRTUAL SAFETY CAR') || text.includes('VSC')) {
      out.push({ kind: 'vsc', t: m.sessionTime, label: 'Virtual Safety Car' })
    } else if (text.includes('SAFETY CAR')) {
      out.push({ kind: 'safety-car', t: m.sessionTime, label: 'Safety Car' })
    } else if (text.includes('PENALTY') || text.includes('UNDER INVESTIGATION')) {
      out.push({
        kind: 'penalty',
        t: m.sessionTime,
        label: m.message,
        driverNumber: m.driverNumber ?? undefined
      })
    }
  }
  return out
}

function pitStopBookmarks(
  snapshot: RaceSnapshot,
  driverCode: (n: number) => string
): RaceBookmark[] {
  return snapshot.laps
    .filter((lap) => lap.isPitInLap && lap.sessionTime != null)
    .map((lap) => ({
      kind: 'pit-stop' as const,
      t: lap.sessionTime as number,
      label: `${driverCode(lap.driverNumber)} pits (lap ${lap.lapNumber})`,
      driverNumber: lap.driverNumber
    }))
}

/** First lap each driver reaches P1, per F1's own per-lap classification. */
function leadChangeBookmarks(
  snapshot: RaceSnapshot,
  driverCode: (n: number) => string
): RaceBookmark[] {
  if (!snapshot.lapPositions || snapshot.lapPositions.length === 0) return []
  // lapNumber -> (driverNumber -> sessionTime), so a lead change can be timed.
  const timeByDriverLap = new Map<string, number>()
  for (const lap of snapshot.laps) {
    if (lap.sessionTime == null) continue
    timeByDriverLap.set(`${lap.driverNumber}:${lap.lapNumber}`, lap.sessionTime)
  }

  const out: RaceBookmark[] = []
  let previousLeader: number | null = null
  const maxLap = Math.max(0, ...snapshot.lapPositions.map((series) => series.positions.length))
  for (let lapIndex = 0; lapIndex < maxLap; lapIndex++) {
    const leader =
      snapshot.lapPositions.find((series) => series.positions[lapIndex] === 1)?.driverNumber ?? null
    if (leader != null && leader !== previousLeader && previousLeader != null) {
      const t = timeByDriverLap.get(`${leader}:${lapIndex + 1}`)
      if (t != null) {
        out.push({
          kind: 'lead-change',
          t,
          label: `${driverCode(leader)} takes the lead`,
          driverNumber: leader
        })
      }
    }
    if (leader != null) previousLeader = leader
  }
  return out
}

/** The single fastest clean lap of the session. */
function fastestLapBookmark(
  snapshot: RaceSnapshot,
  driverCode: (n: number) => string
): RaceBookmark | null {
  let best: { driverNumber: number; lapTime: number; sessionTime: number } | null = null
  for (const lap of snapshot.laps) {
    if (
      lap.lapTime == null ||
      lap.lapTime <= 0 ||
      lap.isPitInLap ||
      lap.isPitOutLap ||
      lap.sessionTime == null
    )
      continue
    if (!best || lap.lapTime < best.lapTime) {
      best = { driverNumber: lap.driverNumber, lapTime: lap.lapTime, sessionTime: lap.sessionTime }
    }
  }
  if (!best) return null
  return {
    kind: 'fastest-lap',
    t: best.sessionTime,
    label: `${driverCode(best.driverNumber)} sets the fastest lap`,
    driverNumber: best.driverNumber
  }
}

/** Team-radio captures, timed by converting their broadcast UTC to session-relative seconds. */
function radioBookmarks(snapshot: RaceSnapshot, driverCode: (n: number) => string): RaceBookmark[] {
  const startMs = snapshot.session.dateStart ? Date.parse(snapshot.session.dateStart) : NaN
  if (!Number.isFinite(startMs) || !snapshot.teamRadio) return []
  const out: RaceBookmark[] = []
  for (const clip of snapshot.teamRadio) {
    const clipMs = Date.parse(clip.utc)
    if (!Number.isFinite(clipMs)) continue
    const t = (clipMs - startMs) / 1000
    if (t < 0) continue
    out.push({
      kind: 'radio',
      t,
      label: `${driverCode(clip.driverNumber)} team radio`,
      driverNumber: clip.driverNumber
    })
  }
  return out
}

/**
 * Build every bookmark kind the roadmap names, from one full-duration
 * snapshot. `greenStart`, when known (from `SessionTimeline`), seeds the
 * "start" marker — it isn't derivable from `RaceSnapshot` alone.
 */
export function buildRaceBookmarks(
  snapshot: RaceSnapshot,
  greenStart: number | null
): RaceBookmark[] {
  const codeOf = (n: number): string =>
    snapshot.drivers.find((d) => d.number === n)?.code ?? `#${n}`

  const out: RaceBookmark[] = []
  if (greenStart != null) out.push({ kind: 'start', t: greenStart, label: 'Lights out' })
  out.push(...raceControlBookmarks(snapshot))
  out.push(...pitStopBookmarks(snapshot, codeOf))
  out.push(...leadChangeBookmarks(snapshot, codeOf))
  out.push(...radioBookmarks(snapshot, codeOf))
  const fastest = fastestLapBookmark(snapshot, codeOf)
  if (fastest) out.push(fastest)

  return out.sort((a, b) => a.t - b.t)
}
