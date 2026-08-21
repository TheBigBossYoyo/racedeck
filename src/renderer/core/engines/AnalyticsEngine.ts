import type { LapSample, TyreCompound } from '@shared/models'
import type { RaceSnapshot } from '@renderer/core/providers/types'
import { estimateFuelCoefficient, fuelCorrect, type FuelCoefficient } from './FuelModel'

/**
 * AnalyticsEngine — pure race analytics derived ONLY from real lap data:
 *   • team pace ranking (which car/team is genuinely quickest right now)
 *   • per-compound performance (pace + degradation) for THIS event
 *   • best tyre per team this weekend
 *
 * All of it is computed from `snapshot.laps`, which is bounded to the current
 * session clock — so figures reflect the race "so far" and never leak future
 * laps in replay. Pit in/out laps and slow anomalies (SC/VSC/traffic) are
 * filtered so a single neutralised lap can't distort a read. Pure + unit-tested
 * and summarised for the AI Race Engineer.
 */

function isCleanLap(l: LapSample): boolean {
  return l.lapTime != null && l.lapTime > 0 && !l.isPitOutLap && !l.isPitInLap
}

/** A lap's pace time, fuel-corrected when a coefficient is supplied. */
function paceTime(l: LapSample, coeff?: FuelCoefficient): number {
  const t = l.lapTime as number
  return coeff ? fuelCorrect(t, l.lapNumber, coeff) : t
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/** Median of the fastest `sample` clean laps — a fuel/deg-robust pace read. */
function representativePace(laps: LapSample[], sample = 5, coeff?: FuelCoefficient): number | null {
  const clean = laps.filter(isCleanLap).map((l) => paceTime(l, coeff))
  if (clean.length < 2) return null
  const best = clean.sort((a, b) => a - b).slice(0, sample)
  return median(best)
}

/** Least-squares slope of a numeric series (s/lap when indices are laps). */
function slope(values: number[]): number | null {
  const n = values.length
  if (n < 4) return null
  const meanX = (n - 1) / 2
  const meanY = values.reduce((a, b) => a + b, 0) / n
  let num = 0
  let den = 0
  for (let i = 0; i < n; i++) {
    num += (i - meanX) * (values[i] - meanY)
    den += (i - meanX) ** 2
  }
  return den === 0 ? null : num / den
}

/** Group the snapshot's (time-bounded) laps by driver. */
function lapsByDriver(snapshot: RaceSnapshot): Map<number, LapSample[]> {
  const map = new Map<number, LapSample[]>()
  for (const l of snapshot.laps) {
    const arr = map.get(l.driverNumber) ?? []
    arr.push(l)
    map.set(l.driverNumber, arr)
  }
  return map
}

// ── Team pace ──────────────────────────────────────────────────────────────────

export interface TeamPaceDriver {
  number: number
  code: string
  pace: number | null
}
export interface TeamPaceRow {
  team: string
  color: string | null
  /** Team pace = fastest car's representative pace. */
  pace: number
  drivers: TeamPaceDriver[]
  /** Seconds slower than the fastest team. */
  deltaToBest: number
}

export function teamPace(snapshot: RaceSnapshot): TeamPaceRow[] {
  const laps = lapsByDriver(snapshot)
  const coeff = estimateFuelCoefficient(snapshot)
  const meta = new Map(snapshot.drivers.map((d) => [d.number, d]))
  const byTeam = new Map<string, TeamPaceDriver[]>()

  for (const d of snapshot.drivers) {
    const team = d.teamName ?? '—'
    const pace = representativePace(laps.get(d.number) ?? [], 5, coeff)
    const arr = byTeam.get(team) ?? []
    arr.push({ number: d.number, code: d.code, pace })
    byTeam.set(team, arr)
  }

  const rows: TeamPaceRow[] = []
  for (const [team, drivers] of byTeam) {
    const paces = drivers.map((d) => d.pace).filter((p): p is number => p != null)
    if (paces.length === 0) continue
    rows.push({
      team,
      color: meta.get(drivers[0].number)?.teamColour ?? null,
      pace: Math.min(...paces),
      drivers: drivers.sort((a, b) => (a.pace ?? Infinity) - (b.pace ?? Infinity)),
      deltaToBest: 0
    })
  }
  rows.sort((a, b) => a.pace - b.pace)
  const best = rows[0]?.pace ?? 0
  for (const r of rows) r.deltaToBest = r.pace - best
  return rows
}

// ── Compound performance (this event) ───────────────────────────────────────────

export interface CompoundRow {
  compound: TyreCompound
  laps: number
  bestLap: number | null
  /** Median clean pace on this compound. */
  pace: number | null
  /** Median per-stint degradation (s/lap); null if not derivable. */
  degPerLap: number | null
  deltaToBest: number | null
}

/**
 * Per-stint degradation slopes grouped by compound (from real stint laps). Lap
 * times are fuel-corrected first, so the slope reflects tyre wear alone rather
 * than tyre wear partly cancelled by the car getting lighter through the stint.
 */
function stintSlopesByCompound(snapshot: RaceSnapshot, coeff: FuelCoefficient): Map<TyreCompound, number[]> {
  const laps = lapsByDriver(snapshot)
  const out = new Map<TyreCompound, number[]>()
  for (const st of snapshot.stints) {
    const end = st.lapEnd ?? snapshot.currentLap ?? st.lapStart
    const stintLaps = (laps.get(st.driverNumber) ?? [])
      .filter((l) => isCleanLap(l) && l.lapNumber >= st.lapStart && l.lapNumber <= end)
      .sort((a, b) => a.lapNumber - b.lapNumber)
      .map((l) => paceTime(l, coeff))
    if (stintLaps.length < 4) continue
    // Drop in-stint anomalies (SC/traffic) before fitting the trend.
    const med = median(stintLaps) as number
    const trimmed = stintLaps.filter((t) => t <= med * 1.06)
    const s = slope(trimmed)
    if (s == null) continue
    const arr = out.get(st.tyre.compound) ?? []
    arr.push(s)
    out.set(st.tyre.compound, arr)
  }
  return out
}

export function compoundPerformance(snapshot: RaceSnapshot): CompoundRow[] {
  const coeff = estimateFuelCoefficient(snapshot)
  // Keep raw times for the displayed best lap (a real lap time) and
  // fuel-corrected times for pace (a fair cross-race comparison).
  const byCompound = new Map<TyreCompound, { raw: number[]; corrected: number[] }>()
  for (const l of snapshot.laps) {
    if (!isCleanLap(l) || !l.compound) continue
    const entry = byCompound.get(l.compound) ?? { raw: [], corrected: [] }
    entry.raw.push(l.lapTime as number)
    entry.corrected.push(paceTime(l, coeff))
    byCompound.set(l.compound, entry)
  }
  const slopes = stintSlopesByCompound(snapshot, coeff)

  const rows: CompoundRow[] = []
  for (const [compound, { raw, corrected }] of byCompound) {
    if (corrected.length === 0) continue
    const sorted = [...corrected].sort((a, b) => a - b)
    // Pace = median of the fastest 40% of fuel-corrected clean laps.
    const quick = sorted.slice(0, Math.max(1, Math.ceil(sorted.length * 0.4)))
    rows.push({
      compound,
      laps: corrected.length,
      bestLap: raw.length ? Math.min(...raw) : null,
      pace: median(quick),
      degPerLap: median(slopes.get(compound) ?? []),
      deltaToBest: null
    })
  }
  rows.sort((a, b) => (a.pace ?? Infinity) - (b.pace ?? Infinity))
  const best = rows.find((r) => r.pace != null)?.pace ?? null
  for (const r of rows) r.deltaToBest = r.pace != null && best != null ? r.pace - best : null
  return rows
}

// ── Best tyre per team ───────────────────────────────────────────────────────

export interface TeamCompoundPace {
  compound: TyreCompound
  pace: number
  laps: number
}
export interface TeamTyreRow {
  team: string
  color: string | null
  best: TeamCompoundPace | null
  byCompound: TeamCompoundPace[]
}

export function bestTyrePerTeam(snapshot: RaceSnapshot): TeamTyreRow[] {
  const coeff = estimateFuelCoefficient(snapshot)
  const meta = new Map(snapshot.drivers.map((d) => [d.number, d]))
  const teamOf = (n: number) => meta.get(n)?.teamName ?? '—'

  // team → compound → fuel-corrected clean lap times
  const acc = new Map<string, Map<TyreCompound, number[]>>()
  for (const l of snapshot.laps) {
    if (!isCleanLap(l) || !l.compound) continue
    const team = teamOf(l.driverNumber)
    const byC = acc.get(team) ?? new Map<TyreCompound, number[]>()
    const arr = byC.get(l.compound) ?? []
    arr.push(paceTime(l, coeff))
    byC.set(l.compound, arr)
    acc.set(team, byC)
  }

  const rows: TeamTyreRow[] = []
  for (const [team, byC] of acc) {
    const perCompound: TeamCompoundPace[] = []
    for (const [compound, times] of byC) {
      const sorted = [...times].sort((a, b) => a - b)
      const quick = sorted.slice(0, Math.max(1, Math.ceil(sorted.length * 0.4)))
      const pace = median(quick)
      if (pace != null) perCompound.push({ compound, pace, laps: times.length })
    }
    if (perCompound.length === 0) continue
    perCompound.sort((a, b) => a.pace - b.pace)
    const firstDriver = snapshot.drivers.find((d) => teamOf(d.number) === team)
    rows.push({
      team,
      color: firstDriver?.teamColour ?? null,
      best: perCompound[0] ?? null,
      byCompound: perCompound
    })
  }
  rows.sort((a, b) => (a.best?.pace ?? Infinity) - (b.best?.pace ?? Infinity))
  return rows
}

// ── Pace helpers + compound model (for the strategy planner) ───────────────────

/** Median of a driver's most RECENT clean laps — current form incl. degradation. */
export function recentPace(laps: LapSample[], n = 5, coeff?: FuelCoefficient): number | null {
  const clean = laps.filter(isCleanLap)
  if (clean.length < 2) return null
  const recent = clean.slice(-n).map((l) => paceTime(l, coeff))
  return median(recent)
}

/** Recent pace for a driver from a time-bounded snapshot (fuel-corrected). */
export function driverRecentPace(snapshot: RaceSnapshot, driverNumber: number, n = 5): number | null {
  const coeff = estimateFuelCoefficient(snapshot)
  return recentPace(lapsByDriver(snapshot).get(driverNumber) ?? [], n, coeff)
}

// Rough dry-compound pace offsets (s, relative to soft) + fallback degradation
// (s/lap). Used only to fill compounds not yet run this event — measured data
// always wins.
const DRY_OFFSET: Record<TyreCompound, number> = {
  SOFT: 0,
  MEDIUM: 0.6,
  HARD: 1.2,
  INTERMEDIATE: 0,
  WET: 0,
  UNKNOWN: 0.6
}
const FALLBACK_DEG: Record<TyreCompound, number> = {
  SOFT: 0.1,
  MEDIUM: 0.05,
  HARD: 0.03,
  INTERMEDIATE: 0.06,
  WET: 0.07,
  UNKNOWN: 0.05
}

export interface CompoundModelEntry {
  compound: TyreCompound
  /** Representative absolute lap time (s) on fresh-ish rubber. */
  pace: number
  /** Degradation (s/lap). */
  deg: number
  /** True when derived from real laps this event; false when estimated. */
  measured: boolean
}

/**
 * A pace + degradation model for the three dry compounds, calibrated from this
 * event's real laps where possible and estimated (from the fastest measured
 * compound + standard offsets) otherwise. Empty when no clean laps exist yet.
 */
export function compoundModel(snapshot: RaceSnapshot): Map<TyreCompound, CompoundModelEntry> {
  const measured = new Map<TyreCompound, { pace: number; deg: number }>()
  for (const r of compoundPerformance(snapshot)) {
    if (r.pace != null) {
      measured.set(r.compound, {
        pace: r.pace,
        deg: r.degPerLap != null && r.degPerLap > 0 ? r.degPerLap : FALLBACK_DEG[r.compound]
      })
    }
  }
  // Anchor = fastest measured compound; its base (pace − offset) sets the level.
  let anchor: { compound: TyreCompound; pace: number } | null = null
  for (const [c, m] of measured) if (!anchor || m.pace < anchor.pace) anchor = { compound: c, pace: m.pace }

  const model = new Map<TyreCompound, CompoundModelEntry>()
  const dry: TyreCompound[] = ['SOFT', 'MEDIUM', 'HARD']
  for (const c of dry) {
    const m = measured.get(c)
    if (m) {
      model.set(c, { compound: c, pace: m.pace, deg: m.deg, measured: true })
    } else if (anchor) {
      const base = anchor.pace - DRY_OFFSET[anchor.compound]
      model.set(c, { compound: c, pace: base + DRY_OFFSET[c], deg: FALLBACK_DEG[c], measured: false })
    }
  }
  return model
}

// ── Compact text summary for the AI Race Engineer ──────────────────────────────

function lapStr(sec: number | null | undefined): string {
  if (sec == null || sec <= 0) return '—'
  const m = Math.floor(sec / 60)
  const s = (sec % 60).toFixed(3)
  return m > 0 ? `${m}:${s.padStart(6, '0')}` : `${s}s`
}

export function analyticsSummary(snapshot: RaceSnapshot): string {
  const teams = teamPace(snapshot).slice(0, 6)
  const compounds = compoundPerformance(snapshot)
  const teamTyres = bestTyrePerTeam(snapshot).slice(0, 6)
  if (teams.length === 0 && compounds.length === 0) return ''

  const coeff = estimateFuelCoefficient(snapshot)
  const lines: string[] = []
  if (coeff.totalLaps != null) {
    lines.push(
      `PACE is FUEL-ADJUSTED (${coeff.confidence}; ~${coeff.sPerLap.toFixed(3)}s/lap of fuel) to a common end-of-race reference.`
    )
  }
  if (teams.length) {
    lines.push('TEAM PACE (fastest fuel-adjusted clean-lap pace; Δ to best):')
    for (const t of teams) {
      lines.push(`  - ${t.team}: ${lapStr(t.pace)} (+${t.deltaToBest.toFixed(3)}s)`)
    }
  }
  if (compounds.length) {
    lines.push('COMPOUND PERFORMANCE (this event):')
    for (const c of compounds) {
      lines.push(
        `  - ${c.compound}: pace ${lapStr(c.pace)}${c.deltaToBest ? ` (+${c.deltaToBest.toFixed(3)}s)` : ''}, deg ${c.degPerLap != null ? `~+${c.degPerLap.toFixed(2)}s/lap` : 'n/a'}, ${c.laps} laps.`
      )
    }
  }
  if (teamTyres.length) {
    lines.push('BEST TYRE PER TEAM (fastest compound so far):')
    for (const t of teamTyres) {
      if (t.best) lines.push(`  - ${t.team}: ${t.best.compound} (${lapStr(t.best.pace)}).`)
    }
  }
  return lines.join('\n')
}
