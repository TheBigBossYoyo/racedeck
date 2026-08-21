import type { Driver } from '@shared/models'
import type { RaceSnapshot } from '@renderer/core/providers/types'
import type { SeasonChampionship, DriverStanding, ConstructorStanding } from '@shared/standings'
import { POINTS_RACE, POINTS_SPRINT } from './WinProbabilityEngine'

/**
 * ChampionshipEngine — pure, offline projection of the title fight.
 *
 * Given the real pre-round standings (from public Jolpica data) and the current
 * race classification at the synced/scrubbed moment, it answers "what does the
 * championship look like if the race finished right now?" — provisional points
 * applied onto the genuine baseline, re-ranked, with the movement each driver
 * would make and, late in the season, who is mathematically alive, eliminated or
 * has clinched. Deterministic and unit-tested; evaluated at the sync-shifted
 * race moment, so it is correct live AND at any replay scrub point.
 */

export interface ProjectedDriver {
  driverNumber: number | null
  code: string
  name: string
  teamColour: string | null
  prePoints: number
  racePoints: number
  projectedPoints: number
  prePosition: number
  projectedPosition: number
  /** Positive = would move UP the standings; negative = would drop. */
  positionDelta: number
  status: 'leader' | 'alive' | 'eliminated'
}

export interface ProjectedConstructor {
  name: string
  teamColour: string | null
  prePoints: number
  racePoints: number
  projectedPoints: number
  prePosition: number
  projectedPosition: number
  positionDelta: number
}

export interface ChampionshipProjection {
  ok: boolean
  round: number | null
  roundResolved: boolean
  raceName: string | null
  totalRounds: number
  remainingRounds: number
  /** True when this session's provisional points were applied (race/sprint). */
  live: boolean
  /** Max points any driver can still take AFTER this session. */
  maxRemaining: number
  leaderClinched: boolean
  drivers: ProjectedDriver[]
  constructors: ProjectedConstructor[]
}

function norm(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '')
}

function isRaceSession(snapshot: RaceSnapshot): boolean {
  const type = snapshot.session.type
  return type === 'race' || type === 'sprint'
}

/** Match a Jolpica standing row to a session driver (number → code → surname). */
function matchDriver(standing: DriverStanding, drivers: Driver[]): Driver | null {
  if (standing.permanentNumber != null) {
    const byNumber = drivers.find((d) => d.number === standing.permanentNumber)
    if (byNumber) return byNumber
  }
  if (standing.code) {
    const code = standing.code.toUpperCase()
    const byCode = drivers.find((d) => (d.code ?? '').toUpperCase() === code)
    if (byCode) return byCode
  }
  const family = norm(standing.familyName)
  return drivers.find((d) => norm(d.lastName ?? '') === family) ?? null
}

/** Provisional points scored in this session's current classification. */
function racePointsByDriver(snapshot: RaceSnapshot): Map<number, number> {
  const out = new Map<number, number>()
  if (!isRaceSession(snapshot)) return out
  const table = snapshot.session.type === 'sprint' ? POINTS_SPRINT : POINTS_RACE
  for (const entry of snapshot.timing) {
    if (entry.position == null) continue
    const points = table[entry.position - 1] ?? 0
    if (points > 0) out.set(entry.driverNumber, points)
  }
  return out
}

function reRank<T extends { projectedPoints: number; prePoints: number }>(rows: T[]): (T & { projectedPosition: number })[] {
  return [...rows]
    .sort((a, b) => b.projectedPoints - a.projectedPoints || b.prePoints - a.prePoints)
    .map((row, index) => ({ ...row, projectedPosition: index + 1 }))
}

export function projectChampionship(
  championship: SeasonChampionship | null,
  snapshot: RaceSnapshot
): ChampionshipProjection {
  const empty: ChampionshipProjection = {
    ok: false, round: null, roundResolved: false, raceName: null, totalRounds: 0,
    remainingRounds: 0, live: false, maxRemaining: 0, leaderClinched: false,
    drivers: [], constructors: []
  }
  if (!championship) return empty

  const live = isRaceSession(snapshot)
  const racePoints = racePointsByDriver(snapshot)
  const drivers = snapshot.drivers

  // ── Drivers ──
  const preByCode = new Map<string, number>() // baseline position lookup for the constructor pass
  const driverRows = championship.driverStandings.map((standing) => {
    const matched = matchDriver(standing, drivers)
    const driverNumber = matched?.number ?? standing.permanentNumber ?? null
    const points = driverNumber != null ? racePoints.get(driverNumber) ?? 0 : 0
    preByCode.set(standing.driverId, standing.points)
    return {
      driverId: standing.driverId,
      driverNumber,
      code: matched?.code || standing.code || standing.familyName.slice(0, 3).toUpperCase(),
      name: `${standing.givenName ? standing.givenName[0] + '. ' : ''}${standing.familyName}`,
      teamColour: matched?.teamColour ?? null,
      constructorName: standing.constructorName,
      prePoints: standing.points,
      racePoints: points,
      projectedPoints: standing.points + points,
      prePosition: standing.position
    }
  })

  const rankedDrivers = reRank(driverRows)
  const leaderPoints = rankedDrivers[0]?.projectedPoints ?? 0
  const secondPoints = rankedDrivers[1]?.projectedPoints ?? 0

  // Points still available AFTER this session. A sprint session shares its round
  // with a race that is still to come, so add that race's 25 to the ceiling.
  const maxRemaining = championship.roundResolved
    ? championship.remainingRounds * (POINTS_RACE[0] ?? 25) +
      championship.remainingSprints * (POINTS_SPRINT[0] ?? 8) +
      (snapshot.session.type === 'sprint' ? (POINTS_RACE[0] ?? 25) : 0)
    : Number.POSITIVE_INFINITY
  const leaderClinched =
    championship.roundResolved && rankedDrivers.length > 1 && secondPoints + maxRemaining < leaderPoints

  const projectedDrivers: ProjectedDriver[] = rankedDrivers.map((row) => {
    const status: ProjectedDriver['status'] =
      row.projectedPosition === 1
        ? 'leader'
        : championship.roundResolved && row.projectedPoints + maxRemaining < leaderPoints
          ? 'eliminated'
          : 'alive'
    return {
      driverNumber: row.driverNumber,
      code: row.code,
      name: row.name,
      teamColour: row.teamColour,
      prePoints: row.prePoints,
      racePoints: row.racePoints,
      projectedPoints: row.projectedPoints,
      prePosition: row.prePosition,
      projectedPosition: row.projectedPosition,
      positionDelta: row.prePosition - row.projectedPosition,
      status
    }
  })

  // ── Constructors ──
  const teamRacePoints = new Map<string, number>()
  for (const row of driverRows) {
    if (!row.constructorName || row.racePoints === 0) continue
    teamRacePoints.set(row.constructorName, (teamRacePoints.get(row.constructorName) ?? 0) + row.racePoints)
  }
  const colourByTeam = teamColourByConstructor(championship.constructorStandings, drivers)
  const constructorRows = championship.constructorStandings.map((standing) => {
    const points = teamRacePoints.get(standing.name) ?? 0
    return {
      name: standing.name,
      teamColour: colourByTeam.get(standing.constructorId) ?? null,
      prePoints: standing.points,
      racePoints: points,
      projectedPoints: standing.points + points,
      prePosition: standing.position
    }
  })
  const projectedConstructors: ProjectedConstructor[] = reRank(constructorRows).map((row) => ({
    name: row.name,
    teamColour: row.teamColour,
    prePoints: row.prePoints,
    racePoints: row.racePoints,
    projectedPoints: row.projectedPoints,
    prePosition: row.prePosition,
    projectedPosition: row.projectedPosition,
    positionDelta: row.prePosition - row.projectedPosition
  }))

  return {
    ok: driverRows.length > 0,
    round: championship.round,
    roundResolved: championship.roundResolved,
    raceName: championship.raceName,
    totalRounds: championship.totalRounds,
    remainingRounds: championship.remainingRounds,
    live,
    maxRemaining: Number.isFinite(maxRemaining) ? maxRemaining : 0,
    leaderClinched,
    drivers: projectedDrivers,
    constructors: projectedConstructors
  }
}

/** Best-effort team colour for a constructor via a loosely-matching session driver. */
function teamColourByConstructor(
  constructors: ConstructorStanding[],
  drivers: Driver[]
): Map<string, string> {
  const out = new Map<string, string>()
  for (const constructor of constructors) {
    const key = norm(constructor.name)
    const driver = drivers.find((d) => {
      const team = norm(d.teamName ?? '')
      return team.length > 0 && (team.includes(key) || key.includes(team))
    })
    if (driver?.teamColour) out.set(constructor.constructorId, driver.teamColour)
  }
  return out
}
