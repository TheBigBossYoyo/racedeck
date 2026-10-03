import { deepMergeF1, indexedToArray, type F1StreamPoint } from '@shared/f1live'
import { currentStint, parseLapTime, qualifyingPartAt, type LapRecord } from '../f1normalize'
import { numOrNull as num, rec } from './shared'
import { PRECOMPUTE_YIELD_EVERY, yieldToRenderer } from './scheduler'

/**
 * Rolling forward scans over the timing feeds: the driver list, and per-lap
 * history (time + sectors + compound + qualifying part). Moved from
 * F1LiveProvider.ts; the provider owns the builds and the lap map.
 */

/** Rolling forward-scan state for the lap-history/qualifying extraction. */
export interface LapBuild {
  timing: unknown
  app: unknown
  appIndex: number
  processedTiming: number
  prevLaps: Map<number, number>
  pitState: Map<number, { inPit: boolean; outNext: boolean }>
  qualifyingParts: { t: number; part: 1 | 2 | 3 }[]
  previousPart: 1 | 2 | 3 | null
  foundInitialTiming: boolean
  initialClock: number
}

export function newLapBuild(): LapBuild {
  return {
    timing: {},
    app: {},
    appIndex: 0,
    processedTiming: 0,
    prevLaps: new Map(),
    pitState: new Map(),
    qualifyingParts: [],
    previousPart: null,
    foundInitialTiming: false,
    initialClock: 0
  }
}

export interface DriverBuild {
  state: unknown
  processed: number
}

export function newDriverBuild(): DriverBuild {
  return { state: {}, processed: 0 }
}

/**
 * Forward-scan newly appended TimingData into per-lap history (time + sectors
 * + compound). The scan state lives in `build`, so archive ingest, the
 * partial-timing tail and continuing live polls all process each point
 * exactly once. The caller captures the build + lap map when the scan starts:
 * a superseded load that is still mid-yield can only write into orphaned
 * objects. `isSuperseded` is polled at each yield.
 */
export async function appendLapHistory(
  build: LapBuild,
  laps: Map<number, LapRecord[]>,
  points: F1StreamPoint[],
  appPoints: F1StreamPoint[],
  isSuperseded: () => boolean
): Promise<void> {
  let sinceYield = 0

  while (build.processedTiming < points.length) {
    const point = points[build.processedTiming]
    // Keep tyre state in step by time for the compound stamp.
    while (build.appIndex < appPoints.length && appPoints[build.appIndex].t <= point.t) {
      build.app = deepMergeF1(build.app, appPoints[build.appIndex].d)
      build.appIndex += 1
    }
    build.timing = deepMergeF1(build.timing, point.d)
    const part = qualifyingPartAt(build.timing)
    if (part != null && part !== build.previousPart) {
      build.qualifyingParts.push({ t: point.t, part })
      build.previousPart = part
    }

    const lines = rec(rec(build.timing).Lines)
    if (!build.foundInitialTiming && Object.keys(lines).some((key) => /^\d+$/.test(key))) {
      build.initialClock = point.t
      build.foundInitialTiming = true
    }
    const appLines = rec(rec(build.app).Lines)
    // A lap can only complete for a driver whose line is IN THIS PATCH —
    // scanning every merged line for every point multiplies the dominant
    // preprocessing cost by the field size for nothing. The values are still
    // read from the MERGED line, since a patch may carry NumberOfLaps while
    // the lap time/sectors arrived in earlier patches.
    const patchLines = rec(rec(point.d).Lines)
    for (const key of Object.keys(patchLines)) {
      if (!/^\d+$/.test(key)) continue
      const line = rec(lines[key])
      const lapCount = num(line.NumberOfLaps)
      if (lapCount == null) continue
      const dn = +key
      // Pit state seen since this driver's last completed lap. A lap during
      // which the car was in the pit lane is its in-lap, and the lap after one
      // is the out-lap. Used only as a fallback: PitLaneTimeCollection states
      // the pit lap exactly, while InPit also goes true on the grid and under
      // a red flag.
      const pitState = build.pitState.get(dn) ?? { inPit: false, outNext: false }
      if (line.InPit === true) pitState.inPit = true
      if (line.PitOut === true) pitState.outNext = true
      build.pitState.set(dn, pitState)

      const prev = build.prevLaps.get(dn) ?? 0
      if (lapCount > prev) {
        build.prevLaps.set(dn, lapCount)
        const last = rec(line.LastLapTime)
        const sectors = indexedToArray(line.Sectors)
        const arr = laps.get(dn) ?? []
        arr.push({
          driverNumber: dn,
          lapNumber: lapCount,
          lapTime: parseLapTime(last.Value),
          sector1: parseLapTime(rec(sectors[0]).Value),
          sector2: parseLapTime(rec(sectors[1]).Value),
          sector3: parseLapTime(rec(sectors[2]).Value),
          compound: currentStint(appLines[key]).compound,
          tComplete: point.t,
          isPitInLap: pitState.inPit,
          isPitOutLap: pitState.outNext
        })
        laps.set(dn, arr)
        // The lap after an in-lap is the out-lap; reset the in-pit watch.
        build.pitState.set(dn, { inPit: false, outNext: pitState.inPit })
      }
    }
    build.processedTiming += 1
    if (++sinceYield >= PRECOMPUTE_YIELD_EVERY) {
      sinceYield = 0
      await yieldToRenderer()
      if (isSuperseded()) return
    }
  }
}
