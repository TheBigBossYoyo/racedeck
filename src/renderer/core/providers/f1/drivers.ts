import type { Driver, SessionInfo, SessionType } from '@shared/models'
import { teamColorFor } from '@shared/constants'
import type { F1SessionSummary, F1StreamPoint } from '@shared/f1live'
import { deepMergeF1, indexedToArray } from '@shared/f1live'
import { numOrNull, rec } from './shared'

// ── session + drivers ───────────────────────────────────────────────────────────

function mapSessionType(type: string): SessionType {
  const s = type.toLowerCase()
  if (s.includes('sprint') && s.includes('qual')) return 'sprint-qualifying'
  if (s.includes('sprint')) return 'sprint'
  if (s.includes('qual')) return 'qualifying'
  if (s.includes('practice')) return 'practice'
  if (s.includes('race')) return 'race'
  return 'unknown'
}

export function normalizeSessionInfo(summary: F1SessionSummary): SessionInfo {
  return {
    id: summary.path,
    meetingId: String(summary.key || summary.path),
    name: summary.name,
    type: mapSessionType(summary.type),
    meetingName: summary.meetingName,
    circuitName: summary.circuitShortName,
    circuitShortName: summary.circuitShortName,
    countryName: summary.countryName,
    countryCode: summary.countryCode,
    location: summary.location,
    dateStart: summary.startDate,
    dateEnd: summary.endDate,
    gmtOffset: summary.gmtOffset,
    year: summary.year,
    totalLaps: null,
    provider: 'f1live'
  }
}

export function normalizeDrivers(driverState: unknown): Driver[] {
  const state = rec(driverState)
  const out: Driver[] = []
  for (const [num, raw] of Object.entries(state)) {
    if (!/^\d+$/.test(num)) continue
    const d = rec(raw)
    const teamName = (d.TeamName as string) ?? null
    out.push({
      number: +num,
      code: (d.Tla as string) ?? String(num),
      firstName: (d.FirstName as string) ?? null,
      lastName: (d.LastName as string) ?? null,
      fullName: (d.FullName as string) ?? `${d.FirstName ?? ''} ${d.LastName ?? ''}`.trim(),
      broadcastName: (d.BroadcastName as string) ?? null,
      teamName,
      teamColour: (d.TeamColour as string) ?? (teamName ? teamColorFor(teamName) : null),
      headshotUrl: (d.HeadshotUrl as string) ?? null,
      countryCode: (d.CountryCode as string) ?? null
    })
  }
  return out.sort((a, b) => a.number - b.number)
}

/**
 * Fill gaps in the driver list from `TopThree`.
 *
 * `TopThree` carries the same identity fields as DriverList (Tla, broadcast
 * name, team, colour) for the session's leading three. It is therefore mostly
 * redundant — but it is a genuinely independent copy, so it recovers identity for
 * a driver the DriverList keyframe has not (or not yet) described, which does
 * happen for stand-in entries in practice sessions. Gap-fill only: DriverList
 * stays authoritative wherever it has an entry.
 */
export function mergeTopThreeDrivers(
  drivers: Driver[],
  points: F1StreamPoint[],
  tMax: number
): Driver[] {
  let merged: unknown = {}
  for (const point of points) {
    if (point.t > tMax) break
    merged = deepMergeF1(merged, point.d)
  }
  // Same array-vs-indexed-object hazard as LapSeries: deltas patch Lines by index.
  const lines = indexedToArray(rec(merged).Lines)
  if (lines.length === 0) return drivers
  const known = new Set(drivers.map((d) => d.number))
  const added: Driver[] = []
  for (const raw of lines) {
    const line = rec(raw)
    const number = numOrNull(line.RacingNumber)
    if (number == null || known.has(number)) continue
    known.add(number)
    const teamName = (line.Team as string) ?? null
    added.push({
      number,
      code: (line.Tla as string) ?? String(number),
      firstName: (line.FirstName as string) ?? null,
      lastName: (line.LastName as string) ?? null,
      fullName:
        (line.FullName as string) ?? `${line.FirstName ?? ''} ${line.LastName ?? ''}`.trim(),
      broadcastName: (line.BroadcastName as string) ?? null,
      teamName,
      teamColour: (line.TeamColour as string) ?? (teamName ? teamColorFor(teamName) : null),
      headshotUrl: null,
      countryCode: null
    })
  }
  return added.length > 0 ? [...drivers, ...added] : drivers
}
