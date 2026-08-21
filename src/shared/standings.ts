/**
 * Championship standings — shared types + pure parsers for the free, public
 * Jolpica-F1 API (`api.jolpi.ca`, the maintained drop-in successor to Ergast).
 *
 * Read-only public data: no key, no auth, no credentials. Only a public season
 * year (and a session date, to resolve the round) is ever sent. The same source
 * the practice roster already uses. Decompression/HTTP lives in the main
 * process; everything here is dependency-free and unit-tested.
 */

export const JOLPICA_BASE = 'https://api.jolpi.ca/ergast/f1'

export interface DriverStanding {
  driverId: string
  code: string | null
  permanentNumber: number | null
  givenName: string
  familyName: string
  position: number
  points: number
  wins: number
  constructorName: string | null
}

export interface ConstructorStanding {
  constructorId: string
  name: string
  position: number
  points: number
  wins: number
}

export interface ScheduleRound {
  round: number
  raceName: string
  date: string | null
  circuitId: string | null
  hasSprint: boolean
}

/** The championship baseline as of BEFORE the target session's round. */
export interface SeasonChampionship {
  year: number
  /** Resolved round of the target session; null when the date didn't match. */
  round: number | null
  roundResolved: boolean
  raceName: string | null
  totalRounds: number
  /** Rounds scheduled AFTER the target round. */
  remainingRounds: number
  /** Sprint weekends scheduled AFTER the target round. */
  remainingSprints: number
  /** Standings AFTER the round before the target (the pre-race baseline). */
  driverStandings: DriverStanding[]
  constructorStandings: ConstructorStanding[]
}

export interface StandingsRequest {
  year: number
  sessionDate?: string | null
}

export interface StandingsResult {
  ok: boolean
  error: string | null
  championship: SeasonChampionship | null
}

// ── pure parsers ──────────────────────────────────────────────────────────────

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}
function numOr(v: unknown, fallback: number): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  return fallback
}
function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function driverStandingsList(json: unknown): unknown[] {
  const lists = arr(rec(rec(rec(json).MRData).StandingsTable).StandingsLists)
  return arr(rec(lists[0]).DriverStandings)
}

/** `MRData.StandingsTable.StandingsLists[0].DriverStandings` → typed rows. */
export function parseDriverStandings(json: unknown): DriverStanding[] {
  const out: DriverStanding[] = []
  for (const raw of driverStandingsList(json)) {
    const row = rec(raw)
    const driver = rec(row.Driver)
    const constructors = arr(row.Constructors)
    const lastConstructor = rec(constructors[constructors.length - 1])
    const familyName = str(driver.familyName)
    if (!familyName) continue
    const permanent = str(driver.permanentNumber)
    out.push({
      driverId: str(driver.driverId),
      code: str(driver.code) || null,
      permanentNumber: permanent ? numOr(permanent, NaN) : null,
      givenName: str(driver.givenName),
      familyName,
      position: numOr(row.position, out.length + 1),
      points: numOr(row.points, 0),
      wins: numOr(row.wins, 0),
      constructorName: str(lastConstructor.name) || null
    })
  }
  return out.filter((d) => d.permanentNumber == null || Number.isFinite(d.permanentNumber))
}

/** `MRData.StandingsTable.StandingsLists[0].ConstructorStandings` → typed rows. */
export function parseConstructorStandings(json: unknown): ConstructorStanding[] {
  const lists = arr(rec(rec(rec(json).MRData).StandingsTable).StandingsLists)
  const rows = arr(rec(lists[0]).ConstructorStandings)
  const out: ConstructorStanding[] = []
  for (const raw of rows) {
    const row = rec(raw)
    const constructor = rec(row.Constructor)
    const name = str(constructor.name)
    if (!name) continue
    out.push({
      constructorId: str(constructor.constructorId),
      name,
      position: numOr(row.position, out.length + 1),
      points: numOr(row.points, 0),
      wins: numOr(row.wins, 0)
    })
  }
  return out
}

/** `MRData.RaceTable.Races` → schedule rounds (with sprint flags). */
export function parseSchedule(json: unknown): ScheduleRound[] {
  const races = arr(rec(rec(rec(json).MRData).RaceTable).Races)
  const out: ScheduleRound[] = []
  for (const raw of races) {
    const race = rec(raw)
    const round = numOr(race.round, NaN)
    if (!Number.isFinite(round)) continue
    out.push({
      round,
      raceName: str(race.raceName) || `Round ${round}`,
      date: str(race.date) || null,
      circuitId: str(rec(race.Circuit).circuitId) || null,
      // Ergast/Jolpica attach a `Sprint` session object on sprint weekends.
      hasSprint: race.Sprint != null && typeof race.Sprint === 'object'
    })
  }
  return out.sort((a, b) => a.round - b.round)
}

/** Just the day portion of an ISO date/datetime, or null. */
function dayOf(date: string | null | undefined): string | null {
  if (!date) return null
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(date)
  return m ? m[1] : null
}

/**
 * Resolve which round a session belongs to from its date: the round on the same
 * calendar day, else the most recent round on or before it. Null when nothing
 * matches (empty schedule or a date before the season).
 */
export function resolveRound(schedule: ScheduleRound[], sessionDate: string | null | undefined): number | null {
  const day = dayOf(sessionDate)
  if (!day) return null
  let onOrBefore: ScheduleRound | null = null
  for (const round of schedule) {
    const roundDay = dayOf(round.date)
    if (!roundDay) continue
    if (roundDay === day) return round.round
    if (roundDay <= day && (!onOrBefore || roundDay > (dayOf(onOrBefore.date) as string))) {
      onOrBefore = round
    }
  }
  return onOrBefore?.round ?? null
}
