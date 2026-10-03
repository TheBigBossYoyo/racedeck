import type {
  CurrentTyre,
  Driver,
  DriverTyreStintHistory,
  Stint,
  TimingEntry,
  TyreCompound,
  TyreStintRecord
} from '@shared/models'
import type { F1StreamPoint } from '@shared/f1live'
import { deepMergeF1, indexedToArray } from '@shared/f1live'
import { normalizeCompound } from '../normalize'
import { numOrNull, rec } from './shared'

// ── stints / tyres ──────────────────────────────────────────────────────────────

interface DriverStint {
  compound: TyreCompound
  ageAtStart: number
  totalLaps: number
  isNew: boolean
}

/** Extract a driver's ordered stints from merged TimingAppData. */
export function driverStints(appLine: unknown): DriverStint[] {
  const stints = indexedToArray(rec(appLine).Stints)
  return stints.flatMap((raw) => {
    const s = rec(raw)
    if (Object.keys(s).length === 0) return []
    const total = numOrNull(s.TotalLaps) ?? 0
    const start = numOrNull(s.StartLaps) ?? 0
    return [
      {
        compound: normalizeCompound(s.Compound as string),
        ageAtStart: start,
        totalLaps: total,
        isNew: String(s.New).toLowerCase() === 'true' || start === 0
      }
    ]
  })
}

/** Build Stint[] (with derived lap ranges) for all drivers from merged app state. */
export function buildStints(appState: unknown, drivers: Driver[]): Stint[] {
  const lines = rec(rec(appState).Lines)
  const out: Stint[] = []
  for (const d of drivers) {
    const stints = driverStints(lines[String(d.number)])
    let lapStart = 1
    stints.forEach((st, i) => {
      const lapsThisStint = Math.max(0, st.totalLaps - st.ageAtStart)
      const isLast = i === stints.length - 1
      const lapEnd = isLast ? null : lapStart + Math.max(0, lapsThisStint - 1)
      out.push({
        driverNumber: d.number,
        stintNumber: i + 1,
        lapStart,
        lapEnd,
        tyre: { compound: st.compound, ageAtStart: st.ageAtStart, isNew: st.isNew },
        degradationPerLap: null
      })
      lapStart += Math.max(1, lapsThisStint)
    })
  }
  return out
}

/**
 * Active stint for one driver from merged app state.
 *
 * `age` is the tyre SET's total age (F1's `TotalLaps` already counts laps run on
 * the set before this stint). `lapsThisStint` subtracts `StartLaps` to give laps
 * run since it was fitted — the two diverge on a used set, and conflating them
 * makes a stint appear to include laps from an earlier run on the same compound.
 */
export function currentStint(appLine: unknown): {
  compound: TyreCompound | null
  age: number | null
  lapsThisStint: number | null
  stops: number
} {
  const stints = driverStints(appLine)
  if (stints.length === 0) return { compound: null, age: null, lapsThisStint: null, stops: 0 }
  const active = stints[stints.length - 1]
  return {
    compound: active.compound,
    age: active.totalLaps,
    lapsThisStint: Math.max(0, active.totalLaps - active.ageAtStart),
    stops: stints.length - 1
  }
}

/**
 * Live tyre-set state from `CurrentTyres`. This is F1's direct statement of what
 * is fitted right now, independent of the stint history reconstructed from
 * TimingAppData — useful both on its own and as a cross-check.
 */
export function buildCurrentTyres(points: F1StreamPoint[], tMax: number): CurrentTyre[] {
  let merged: unknown = {}
  for (const point of points) {
    if (point.t > tMax) break
    merged = deepMergeF1(merged, point.d)
  }
  const out: CurrentTyre[] = []
  for (const [key, raw] of Object.entries(rec(rec(merged).Tyres))) {
    if (!/^\d+$/.test(key)) continue
    const tyre = rec(raw)
    out.push({
      driverNumber: Number(key),
      compound: normalizeCompound(tyre.Compound as string),
      isNew: String(tyre.New).toLowerCase() === 'true'
    })
  }
  return out
}

/** One stint's fields from a merged `TyreStintSeries` driver entry. */
function tyreStintSeriesStints(driverState: unknown): TyreStintRecord[] {
  const stints = indexedToArray(driverState)
  return stints.flatMap((raw, i) => {
    const s = rec(raw)
    if (Object.keys(s).length === 0) return []
    return [
      {
        stintNumber: i + 1,
        compound: normalizeCompound(s.Compound as string),
        isNew: String(s.New).toLowerCase() === 'true',
        ageAtStart: numOrNull(s.StartLaps) ?? 0,
        totalLaps: numOrNull(s.TotalLaps) ?? 0
      }
    ]
  })
}

/**
 * Every driver's tyre-set history from F1's own `TyreStintSeries` feed — a
 * direct statement of which physical set ran each stint, independent of the
 * stint history reconstructed from `TimingAppData`. Shaped `{Stints: {driver:
 * {stintIndex: {...}}}}`; deltas patch by index like `LapSeries`/`TimingStats`,
 * so this merges bounded by `tMax` exactly the same way those do.
 */
export function buildTyreStintHistory(
  points: F1StreamPoint[],
  tMax: number
): DriverTyreStintHistory[] {
  let merged: unknown = {}
  for (const point of points) {
    if (point.t > tMax) break
    merged = deepMergeF1(merged, point.d)
  }
  const out: DriverTyreStintHistory[] = []
  for (const [key, raw] of Object.entries(rec(rec(merged).Stints))) {
    if (!/^\d+$/.test(key)) continue
    const stints = tyreStintSeriesStints(raw)
    if (stints.length === 0) continue
    out.push({ driverNumber: Number(key), stints })
  }
  return out
}

/**
 * Fill in tyre compound from `CurrentTyres` where the stint reconstruction has
 * none.
 *
 * Stints are rebuilt from TimingAppData, which describes the session's stint
 * HISTORY — connect to a live feed part-way through and a driver's compound can
 * be missing or stale. `CurrentTyres` is F1 stating outright what is fitted right
 * now, so it is the better answer whenever the reconstruction has no opinion.
 * Deliberately only fills gaps: a known stint carries age with it, which this
 * feed does not, so it must not overwrite a good reconstruction.
 */
export function applyCurrentTyres(entries: TimingEntry[], tyres: CurrentTyre[]): void {
  if (tyres.length === 0) return
  const byDriver = new Map(tyres.map((t) => [t.driverNumber, t]))
  for (const entry of entries) {
    if (entry.compound != null && entry.compound !== 'UNKNOWN') continue
    const tyre = byDriver.get(entry.driverNumber)
    if (tyre && tyre.compound !== 'UNKNOWN') entry.compound = tyre.compound
  }
}

/**
 * Same gap-fill as `applyCurrentTyres`, but for each driver's ACTIVE stint (the
 * last one, `lapEnd === null`) in a `Stint[]` array — so a widget rendering the
 * stint history (e.g. tyre strategy bars) doesn't disagree with `TimingEntry`
 * right after a pit stop, when `TimingAppData`'s stint history hasn't caught up
 * yet but `CurrentTyres` already knows what was fitted.
 *
 * Pure: returns a new array only where a correction actually applies, so a
 * caller holding a cached `Stint[]` (e.g. `F1LiveProvider`'s per-appState-
 * version stint cache) is never mutated in place — unlike `applyCurrentTyres`,
 * which is safe to mutate because `TimingEntry[]` is rebuilt fresh every call.
 */
export function applyCurrentTyresToStints(stints: Stint[], tyres: CurrentTyre[]): Stint[] {
  if (tyres.length === 0) return stints
  const byDriver = new Map(tyres.map((t) => [t.driverNumber, t]))
  let changed = false
  const out = stints.map((stint) => {
    if (stint.lapEnd !== null) return stint
    if (stint.tyre.compound != null && stint.tyre.compound !== 'UNKNOWN') return stint
    const tyre = byDriver.get(stint.driverNumber)
    if (!tyre || tyre.compound === 'UNKNOWN') return stint
    changed = true
    return { ...stint, tyre: { ...stint.tyre, compound: tyre.compound } }
  })
  return changed ? out : stints
}
