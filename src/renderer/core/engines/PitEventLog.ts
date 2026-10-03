import type { LapSample, Stint, TyreCompound } from '@shared/models'
import type { RaceSnapshot } from '@renderer/core/model/snapshot'
import { buildPitStopHistory } from '@renderer/core/engines/PitHistory'

/**
 * Field-wide pit-stop log (IMPROVEMENT_OPPORTUNITIES.md #13): one row per
 * ongoing/completed stop across every driver, newest first.
 *
 * Pit-lane duration is only ever a MEASURED transit — it comes from
 * `buildPitStopHistory` (`snapshot.pitLaneTimes`) and stays null for a stop the
 * feed never timed, never a model estimate. Stops themselves are recognised
 * from the strongest evidence available, merged per driver + in-lap:
 *   1. measured pit-lane times (`pitLaneTimes`),
 *   2. lap samples flagged `isPitInLap` / `isPitOutLap`,
 *   3. tyre-stint boundaries (`stints`) — the only source Demo/OpenF1 have for
 *      tyres, and the only one that can carry compound before -> after.
 * `stints` may span the WHOLE session (Demo/OpenF1 hand it out unclipped), so a
 * boundary counts only once the driver has completed its in-lap at the
 * snapshot's clock — that is what lets rows appear and vanish as the replay is
 * scrubbed. F1's `currentTyres` is not read here: the live provider already
 * folds it into `stints` (`applyCurrentTyresToStints`).
 */

export interface PitLogEntry {
  /** Stable React key: driver + in-lap (or a placeholder marker). */
  readonly key: string
  readonly driverNumber: number
  /** Lap the car entered the pits, or null when the feed never said. */
  readonly lapIn: number | null
  /** Lap after the in-lap, once the car is back on track; null while still in the pits. */
  readonly lapOut: number | null
  /** MEASURED pit-lane transit in seconds, or null when unmeasured. */
  readonly durationSec: number | null
  readonly compoundBefore: TyreCompound | null
  readonly compoundAfter: TyreCompound | null
  /** Session-clock seconds the in-lap completed, when the lap sample carries it. */
  readonly atSec: number | null
  /** The car is in the pit lane right now. */
  readonly ongoing: boolean
}

interface StintBoundary {
  readonly lapIn: number
  readonly before: TyreCompound | null
  readonly after: TyreCompound | null
}

interface Draft {
  readonly driverNumber: number
  readonly lapIn: number | null
  readonly durationSec: number | null
  readonly boundary: StintBoundary | null
}

/** A stint boundary counts as the same stop as a recorded one if within a lap (feed drift). */
const BOUNDARY_TOLERANCE_LAPS = 1

const lapKey = (driverNumber: number, lapNumber: number): string => `${driverNumber}:${lapNumber}`

function compoundOrNull(compound: TyreCompound | null | undefined): TyreCompound | null {
  return compound != null && compound !== 'UNKNOWN' ? compound : null
}

function indexLaps(laps: readonly LapSample[]): Map<string, LapSample> {
  return new Map(laps.map((l) => [lapKey(l.driverNumber, l.lapNumber), l]))
}

/** Highest lap each driver has completed at `clock` (a lap without a time counts as completed). */
function completedLapsByDriver(laps: readonly LapSample[], clock: number): Map<number, number> {
  const out = new Map<number, number>()
  for (const l of laps) {
    if (l.sessionTime != null && l.sessionTime > clock) continue
    out.set(l.driverNumber, Math.max(out.get(l.driverNumber) ?? 0, l.lapNumber))
  }
  return out
}

function boundariesFor(stints: readonly Stint[]): Map<number, StintBoundary[]> {
  const byDriver = new Map<number, Stint[]>()
  for (const s of stints) byDriver.set(s.driverNumber, [...(byDriver.get(s.driverNumber) ?? []), s])
  const out = new Map<number, StintBoundary[]>()
  for (const [driverNumber, list] of byDriver) {
    const ordered = [...list].sort((a, b) => a.stintNumber - b.stintNumber)
    const boundaries: StintBoundary[] = []
    for (let i = 1; i < ordered.length; i++) {
      const lapIn = ordered[i].lapStart - 1
      if (lapIn < 1) continue
      boundaries.push({
        lapIn,
        before: compoundOrNull(ordered[i - 1].tyre.compound),
        after: compoundOrNull(ordered[i].tyre.compound)
      })
    }
    out.set(driverNumber, boundaries)
  }
  return out
}

/** Exact-lap evidence: measured transits and lap samples flagged as pit in/out laps. */
function exactDrafts(
  snapshot: RaceSnapshot,
  reached: (d: number, lap: number) => boolean
): Draft[] {
  const drafts = new Map<string, Draft>()
  const loose: Draft[] = []
  const put = (driverNumber: number, lapIn: number | null, durationSec: number | null): void => {
    if (lapIn == null) {
      loose.push({ driverNumber, lapIn, durationSec, boundary: null })
      return
    }
    if (!reached(driverNumber, lapIn)) return
    const key = lapKey(driverNumber, lapIn)
    const prior = drafts.get(key)
    drafts.set(key, {
      driverNumber,
      lapIn,
      durationSec: durationSec ?? prior?.durationSec ?? null,
      boundary: null
    })
  }
  for (const stop of buildPitStopHistory(snapshot))
    put(stop.driverNumber, stop.lap, stop.durationSec)
  for (const l of snapshot.laps) {
    if (!reached(l.driverNumber, l.lapNumber)) continue
    if (l.isPitInLap) put(l.driverNumber, l.lapNumber, null)
    // The out-lap follows the in-lap by definition; OpenF1 only ever flags this side.
    if (l.isPitOutLap && l.lapNumber >= 2) put(l.driverNumber, l.lapNumber - 1, null)
  }
  return [...drafts.values(), ...loose]
}

/** Attach each stint boundary to the nearest recorded stop, or add it as a stop of its own. */
function withBoundaries(
  drafts: readonly Draft[],
  boundaries: ReadonlyMap<number, readonly StintBoundary[]>,
  completed: ReadonlyMap<number, number>
): Draft[] {
  let out = [...drafts]
  for (const [driverNumber, list] of boundaries) {
    for (const boundary of list) {
      if ((completed.get(driverNumber) ?? 0) < boundary.lapIn) continue
      let best = -1
      out.forEach((d, i) => {
        if (d.driverNumber !== driverNumber || d.lapIn == null || d.boundary != null) return
        const gap = Math.abs(d.lapIn - boundary.lapIn)
        if (gap > BOUNDARY_TOLERANCE_LAPS) return
        if (best < 0 || gap < Math.abs((out[best].lapIn as number) - boundary.lapIn)) best = i
      })
      if (best >= 0) {
        out = out.map((d, i) => (i === best ? { ...d, boundary } : d))
        continue
      }
      // Stints that start on the same lap (a red-flag tyre change) share one in-lap: fold them
      // into a single stop, before the first change and after the last, so row keys stay unique.
      const sameLap = out.findIndex(
        (d) => d.driverNumber === driverNumber && d.lapIn === boundary.lapIn && d.boundary != null
      )
      out =
        sameLap >= 0
          ? out.map((d, i) =>
              i === sameLap
                ? { ...d, boundary: { lapIn: boundary.lapIn, before: d.boundary?.before ?? null, after: boundary.after } }
                : d
            )
          : [...out, { driverNumber, lapIn: boundary.lapIn, durationSec: null, boundary }]
    }
  }
  return out
}

function toEntry(
  draft: Draft,
  ongoing: boolean,
  lapIndex: ReadonlyMap<string, LapSample>,
  keyWhenLapUnknown: string
): PitLogEntry {
  const { driverNumber, lapIn, boundary } = draft
  const inLap = lapIn != null ? lapIndex.get(lapKey(driverNumber, lapIn)) : undefined
  const outLap = lapIn != null ? lapIndex.get(lapKey(driverNumber, lapIn + 1)) : undefined
  return {
    key: lapIn != null ? lapKey(driverNumber, lapIn) : keyWhenLapUnknown,
    driverNumber,
    lapIn,
    lapOut: !ongoing && lapIn != null ? lapIn + 1 : null,
    durationSec: draft.durationSec,
    compoundBefore: boundary?.before ?? compoundOrNull(inLap?.compound),
    // What was fitted is only visible once the car has left the pit lane.
    compoundAfter: ongoing ? null : (boundary?.after ?? compoundOrNull(outLap?.compound)),
    atSec: inLap?.sessionTime ?? null,
    ongoing
  }
}

/** The driver's latest un-timed stop whose in-lap is their last completed lap. */
function ongoingIndex(
  drafts: readonly Draft[],
  driverNumber: number,
  completed: ReadonlyMap<number, number>
): number {
  let best = -1
  drafts.forEach((d, i) => {
    if (d.driverNumber !== driverNumber || d.lapIn == null || d.durationSec != null) return
    if (d.lapIn < (completed.get(driverNumber) ?? 0)) return
    if (best < 0 || d.lapIn > (drafts[best].lapIn as number)) best = i
  })
  return best
}

/** Ongoing stops first, then newest by session time (lap number when a time is missing). */
function compareNewestFirst(a: PitLogEntry, b: PitLogEntry): number {
  if (a.ongoing !== b.ongoing) return a.ongoing ? -1 : 1
  if (a.atSec != null && b.atSec != null && a.atSec !== b.atSec) return b.atSec - a.atSec
  const lapDelta = (b.lapIn ?? -1) - (a.lapIn ?? -1)
  return lapDelta !== 0 ? lapDelta : a.driverNumber - b.driverNumber
}

/** Every stop the snapshot's clock has reached, newest first. */
export function buildPitEventLog(snapshot: RaceSnapshot): PitLogEntry[] {
  const { clock } = snapshot
  const lapIndex = indexLaps(snapshot.laps)
  const completed = completedLapsByDriver(snapshot.laps, clock)
  const reached = (driverNumber: number, lapIn: number): boolean => {
    const sessionTime = lapIndex.get(lapKey(driverNumber, lapIn))?.sessionTime
    return sessionTime == null || sessionTime <= clock
  }

  const drafts = withBoundaries(
    exactDrafts(snapshot, reached),
    boundariesFor(snapshot.stints),
    completed
  )

  const inPit = snapshot.timing.filter((e) => e.inPit && !e.retired).map((e) => e.driverNumber)
  const ongoing = new Set<number>()
  const placeholders: PitLogEntry[] = []
  for (const driverNumber of new Set(inPit)) {
    const i = ongoingIndex(drafts, driverNumber, completed)
    if (i >= 0) ongoing.add(i)
    else {
      placeholders.push(
        toEntry(
          { driverNumber, lapIn: null, durationSec: null, boundary: null },
          true,
          lapIndex,
          `${driverNumber}:in-pit`
        )
      )
    }
  }

  const rows = drafts.map((d, i) =>
    toEntry(d, ongoing.has(i), lapIndex, `${d.driverNumber}:unknown-${i}`)
  )
  return [...rows, ...placeholders].sort(compareNewestFirst)
}
