import type {
  DriverSessionBests,
  LapPositionSeries,
  LapSample,
  PitLaneTime,
  RankedMark,
  TyreCompound
} from '@shared/models'
import type { F1StreamPoint } from '@shared/f1live'
import { deepMergeF1, indexedToArray } from '@shared/f1live'
import { numOrNull, parseLapTime, rec } from './shared'

// ── lap history (from a forward scan) ────────────────────────────────────────────

export interface LapRecord {
  driverNumber: number
  lapNumber: number
  lapTime: number | null
  sector1: number | null
  sector2: number | null
  sector3: number | null
  compound: TyreCompound | null
  tComplete: number
  /** Car was in the pit lane during this lap (from TimingData's InPit). */
  isPitInLap: boolean
  /** Lap immediately following a pit exit. */
  isPitOutLap: boolean
}

/**
 * Which laps were pit in-laps and out-laps, from `PitLaneTimeCollection`.
 *
 * F1 states the pit lap outright, so this is exact where the feed exists —
 * unlike watching TimingData's InPit flag, which also goes true when the field
 * sits in the pit lane before the start or during a red flag.
 */
export function pitLapIndex(pitLaneTimes: PitLaneTime[]): { in: Set<string>; out: Set<string> } {
  const inLaps = new Set<string>()
  const outLaps = new Set<string>()
  for (const p of pitLaneTimes) {
    if (p.lap == null) continue
    inLaps.add(`${p.driverNumber}:${p.lap}`)
    outLaps.add(`${p.driverNumber}:${p.lap + 1}`)
  }
  return { in: inLaps, out: outLaps }
}

/**
 * Convert an internal lap record to the shared LapSample.
 *
 * `isPitInLap` / `isPitOutLap` were previously hard-coded false here, so for
 * every F1 session the six engines that exclude in- and out-laps from "clean"
 * pace (analytics, fuel, practice, qualifying, strategy) were silently including
 * laps 10-20s off the pace. Pass `pitLaps` to use F1's own statement of which
 * laps those were; without it the record's InPit-derived flags are used.
 */
export function lapRecordToSample(
  r: LapRecord,
  pitLaps?: { in: Set<string>; out: Set<string> }
): LapSample {
  const key = `${r.driverNumber}:${r.lapNumber}`
  return {
    driverNumber: r.driverNumber,
    lapNumber: r.lapNumber,
    lapTime: r.lapTime,
    sector1: r.sector1,
    sector2: r.sector2,
    sector3: r.sector3,
    speedI1: null,
    speedI2: null,
    speedST: null,
    isPitOutLap: pitLaps ? pitLaps.out.has(key) : r.isPitOutLap,
    isPitInLap: pitLaps ? pitLaps.in.has(key) : r.isPitInLap,
    compound: r.compound,
    dateStart: null,
    sessionTime: r.tComplete
  }
}

// ── LapSeries / TimingStats / PitLaneTimeCollection / TeamRadio / CurrentTyres ──
//
// These feeds are pure additions from F1's live stream. Each is normalized here
// so both the live and archive providers get them from one tested place.

/**
 * F1's own per-lap classification (`LapSeries`), merged across deltas.
 *
 * Strictly better than deriving positions from accumulated lap times: it is the
 * official classification, and it covers the WHOLE session — so connecting to a
 * live feed part-way through still yields the full history rather than starting
 * from the moment we happened to connect.
 */
export function buildLapPositions(points: F1StreamPoint[], tMax: number): LapPositionSeries[] {
  let merged: unknown = {}
  for (const point of points) {
    if (point.t > tMax) break
    merged = deepMergeF1(merged, point.d)
  }
  const out: LapPositionSeries[] = []
  for (const [key, raw] of Object.entries(rec(merged))) {
    if (!/^\d+$/.test(key)) continue
    const line = rec(raw)
    // LapPosition starts as an array but deltas patch it as an INDEXED OBJECT
    // ({"12": "3"}). deepMergeF1 replaces the array wholesale in that case, so
    // the merged value may be either shape — indexedToArray accepts both.
    const laps = indexedToArray(line.LapPosition)
    if (laps.length === 0) continue
    out.push({
      driverNumber: Number(key),
      positions: laps.map((v) => {
        const n = numOrNull(v)
        return n != null && n > 0 ? n : null
      })
    })
  }
  return out
}

/** One `{Value, Position}` mark from TimingStats. */
function rankedMark(raw: unknown, parse: (v: unknown) => number | null): RankedMark {
  const m = rec(raw)
  return { value: parse(m.Value), rank: numOrNull(m.Position) }
}

/**
 * Per-driver session bests from `TimingStats` — including the speed-trap and
 * intermediate speeds, which cannot be derived from lap/sector timing at all.
 */
export function buildSessionBests(points: F1StreamPoint[], tMax: number): DriverSessionBests[] {
  let merged: unknown = {}
  for (const point of points) {
    if (point.t > tMax) break
    merged = deepMergeF1(merged, point.d)
  }
  const lines = rec(rec(merged).Lines)
  const out: DriverSessionBests[] = []
  for (const [key, raw] of Object.entries(lines)) {
    if (!/^\d+$/.test(key)) continue
    const line = rec(raw)
    const sectors = indexedToArray(line.BestSectors)
    const speeds = rec(line.BestSpeeds)
    out.push({
      driverNumber: Number(key),
      bestLap: rankedMark(line.PersonalBestLapTime, parseLapTime),
      bestSectors: [
        rankedMark(sectors[0], parseLapTime),
        rankedMark(sectors[1], parseLapTime),
        rankedMark(sectors[2], parseLapTime)
      ],
      speeds: {
        i1: rankedMark(speeds.I1, numOrNull),
        i2: rankedMark(speeds.I2, numOrNull),
        fl: rankedMark(speeds.FL, numOrNull),
        st: rankedMark(speeds.ST, numOrNull)
      }
    })
  }
  return out
}
