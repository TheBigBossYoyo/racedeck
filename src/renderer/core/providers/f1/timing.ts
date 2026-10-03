import type {
  Driver,
  DriverStatus,
  RaceControlMessage,
  SectorTime,
  TimingEntry
} from '@shared/models'
import { indexedToArray } from '@shared/f1live'
import { applyRaceControlState } from './raceControl'
import { numOrNull, parseGap, parseLapTime, rec } from './shared'
import { currentStint } from './tyres'

/** Assign at most one fastest lap once enough credible field data exists. */
export function assignCredibleFastestLap(entries: TimingEntry[]): void {
  for (const entry of entries) entry.isFastestLap = false
  const credibleBestLaps = entries.filter((entry) => entry.bestLap != null && entry.bestLap >= 40)
  const minimumCoverage = Math.max(2, Math.ceil(entries.length * 0.5))
  if (credibleBestLaps.length < minimumCoverage) return
  const fastestEntry = credibleBestLaps.reduce<TimingEntry | null>(
    (fastest, entry) =>
      entry.bestLap != null && (fastest?.bestLap == null || entry.bestLap < fastest.bestLap)
        ? entry
        : fastest,
    null
  )
  if (fastestEntry) fastestEntry.isFastestLap = true
}

// ── timing ──────────────────────────────────────────────────────────────────────

function sectorFrom(raw: unknown): SectorTime {
  const s = rec(raw)
  const seconds = parseLapTime(s.Value)
  // Segment mini-sector colours: F1 status 2048 = green, 2049 = purple(session best), 2064 = pit.
  const segments = indexedToArray(s.Segments).map((seg) => {
    const st = numOrNull(rec(seg).Status) ?? 0
    if (st === 2051 || st === 2049) return 'purple' as const
    if (st === 2048) return 'green' as const
    if (st === 2064) return 'pit' as const
    if (st === 2052) return 'yellow' as const
    return st === 0 ? ('not-set' as const) : ('unknown' as const)
  })
  const overall = s.OverallFastest === true
  const personal = s.PersonalFastest === true
  return {
    seconds,
    state: overall ? 'session-best' : personal ? 'personal-best' : 'none',
    segments: segments.length ? segments : undefined
  }
}

function driverStatus(line: Record<string, unknown>): DriverStatus {
  if (line.Retired === true) return 'RETIRED'
  if (line.Stopped === true) return 'STOPPED'
  if (line.InPit === true) return 'IN_PIT'
  if (line.PitOut === true) return 'OUT_LAP'
  return 'RUNNING'
}

/** Build the classification (TimingEntry[]) from merged timing + app state. */
export function buildTiming(
  timingState: unknown,
  appState: unknown,
  drivers: Driver[],
  raceControl: RaceControlMessage[] = []
): TimingEntry[] {
  const lines = rec(rec(timingState).Lines)
  const appLines = rec(rec(appState).Lines)
  const entries: TimingEntry[] = []

  for (const d of drivers) {
    const key = String(d.number)
    const line = rec(lines[key])
    if (Object.keys(line).length === 0) continue

    const position = numOrNull(line.Position)
    const isLeader = position === 1
    const interval = rec(line.IntervalToPositionAhead)
    const stint = currentStint(appLines[key])
    const last = rec(line.LastLapTime)
    const best = rec(line.BestLapTime)
    const sectors = indexedToArray(line.Sectors)

    entries.push({
      driverNumber: d.number,
      position,
      gapToLeader: isLeader ? 0 : parseGap(line.GapToLeader),
      intervalAhead: isLeader ? null : parseGap(interval.Value),
      lastLap: parseLapTime(last.Value),
      bestLap: parseLapTime(best.Value),
      lapNumber: numOrNull(line.NumberOfLaps),
      stintAge: stint.age,
      lapsThisStint: stint.lapsThisStint,
      compound: stint.compound,
      sector1: sectorFrom(sectors[0]),
      sector2: sectorFrom(sectors[1]),
      sector3: sectorFrom(sectors[2]),
      status: driverStatus(line),
      inPit: line.InPit === true,
      pitStops: numOrNull(line.NumberOfPitStops) ?? stint.stops,
      // Derived once across the completed classification below. Incremental F1
      // deltas can leave stale OverallFastest=true flags on multiple drivers.
      isFastestLap: false,
      isPersonalBestLap: last.PersonalFastest === true,
      penalty: null,
      underInvestigation: false,
      // `Stopped` is a transient timing state and does not mean the driver has
      // retired. Only the feed's explicit Retired flag should mark them OUT.
      retired: line.Retired === true,
      // The public F1 feed doesn't expose battery state of charge.
      energyPct: null,
      deployMode: null
    })
  }

  entries.sort((a, b) => {
    if (a.position != null && b.position != null && a.position !== b.position) {
      return a.position - b.position
    }
    if (a.position != null) return -1
    if (b.position != null) return 1
    const lapDelta = (b.lapNumber ?? 0) - (a.lapNumber ?? 0)
    if (lapDelta !== 0) return lapDelta
    const gapA = typeof a.gapToLeader === 'number' ? a.gapToLeader : Number.POSITIVE_INFINITY
    const gapB = typeof b.gapToLeader === 'number' ? b.gapToLeader : Number.POSITIVE_INFINITY
    if (gapA !== gapB) return gapA - gapB
    return a.driverNumber - b.driverNumber
  })
  // Partial timing deltas can temporarily contain duplicate/missing positions.
  // The sorted classification must still satisfy the UI invariant 1..N.
  entries.forEach((e, i) => {
    e.position = i + 1
    if (i === 0) {
      e.gapToLeader = 0
      e.intervalAhead = null
    }
  })
  // Sparse live deltas can repair the classification before their old gap fields
  // catch up. A leader gap must grow down the order and cannot be smaller than
  // the reported interval from the previous valid row.
  let previousGap = 0
  for (let index = 1; index < entries.length; index++) {
    const entry = entries[index]
    if (typeof entry.gapToLeader !== 'number') continue
    const interval = typeof entry.intervalAhead === 'number' ? entry.intervalAhead : null
    const minimumGap = previousGap + (interval != null ? Math.max(0.05, interval * 0.5) : 0.05)
    if (entry.gapToLeader + 0.01 < minimumGap) {
      entry.gapToLeader = null
    } else {
      previousGap = entry.gapToLeader
    }
  }
  assignCredibleFastestLap(entries)
  applyRaceControlState(entries, raceControl)
  return entries
}
