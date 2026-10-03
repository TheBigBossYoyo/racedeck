import type { RaceSnapshot } from '@renderer/core/model/snapshot'
import type { TyreCompound } from '@shared/models'
import { buildPitStopHistory } from '@renderer/core/engines/PitHistory'
import { compoundModel, teamPace } from '@renderer/core/engines/AnalyticsEngine'

/**
 * A persisted, source-labelled cross-race comparison summary
 * (APP_IMPROVEMENT_ROADMAP.md P3 item 35). Every field is a plain number or
 * string — never a `RaceSnapshot`, a media URL, or a credential — so the
 * comparison library structurally can't end up persisting licensed TOD
 * media. Every field is null when the source data isn't available, matching
 * `DebriefBuilder.ts`'s provenance discipline: never a fabricated number.
 */
export interface ComparisonSummary {
  sessionId: string
  meetingName: string | null
  sessionName: string
  dateStart: string | null
  pitLossMedianSec: number | null
  degradationByCompound: Partial<Record<TyreCompound, number | null>>
  topSpeedKmh: number | null
  teamPaceMs: Record<string, number>
  weather: {
    avgTrackTempC: number | null
    avgAirTempC: number | null
    rainFraction: number | null
  }
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

function average(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length
}

/**
 * Field-wide degradation per dry compound, only where a positive slope was fitted
 * from this event's stint laps. A compound that ran but whose slope was missing or
 * not positive is null, never the planner's fallback figure.
 */
function degradationByCompound(
  snapshot: RaceSnapshot
): Partial<Record<TyreCompound, number | null>> {
  const out: Partial<Record<TyreCompound, number | null>> = {}
  for (const [compound, entry] of compoundModel(snapshot)) {
    out[compound] = entry.degMeasured ? entry.deg : null
  }
  return out
}

function topSpeedKmh(snapshot: RaceSnapshot): number | null {
  const values = (snapshot.sessionBests ?? [])
    .map((s) => s.speeds.st.value)
    .filter((v): v is number => v != null)
  return values.length === 0 ? null : Math.max(...values)
}

function teamPaceMs(snapshot: RaceSnapshot): Record<string, number> {
  return Object.fromEntries(teamPace(snapshot).map((r) => [r.team, r.pace]))
}

function weatherSummary(snapshot: RaceSnapshot): ComparisonSummary['weather'] {
  const history = snapshot.weatherHistory ?? []
  const track = history.map((h) => h.trackTemp).filter((v): v is number => v != null && v > 0)
  const air = history.map((h) => h.airTemp).filter((v): v is number => v != null && v > 0)
  return {
    avgTrackTempC: average(track),
    avgAirTempC: average(air),
    rainFraction:
      history.length === 0 ? null : history.filter((h) => h.rainfall).length / history.length
  }
}

export function buildComparisonSummary(snapshot: RaceSnapshot): ComparisonSummary {
  const pitStops = buildPitStopHistory(snapshot)
  return {
    sessionId: snapshot.session.id,
    meetingName: snapshot.session.meetingName,
    sessionName: snapshot.session.name,
    dateStart: snapshot.session.dateStart,
    pitLossMedianSec: median(pitStops.map((s) => s.durationSec)),
    degradationByCompound: degradationByCompound(snapshot),
    topSpeedKmh: topSpeedKmh(snapshot),
    teamPaceMs: teamPaceMs(snapshot),
    weather: weatherSummary(snapshot)
  }
}
