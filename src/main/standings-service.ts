import { net } from 'electron'
import {
  JOLPICA_BASE,
  parseDriverStandings,
  parseConstructorStandings,
  parseSchedule,
  resolveRound,
  type StandingsRequest,
  type StandingsResult,
  type SeasonChampionship
} from '@shared/standings'

/**
 * StandingsService (main process) — fetches PUBLIC championship data from the
 * free Jolpica-F1 API (the maintained successor to Ergast). No key, no auth. It
 * transmits only a public season year; it never sees TOD credentials, tokens or
 * protected media. Running in the main process avoids renderer CORS and lets us
 * enforce a hard timeout. Parsing is delegated to the pure helpers in
 * `@shared/standings`.
 *
 * It returns the championship baseline as of BEFORE the target session's round,
 * so the renderer can project the current race's provisional points onto real
 * pre-race standings — correct both live and in replay of a past round.
 */

const REQUEST_TIMEOUT_MS = 15_000
const CACHE_MS = 30 * 60 * 1000
const UA = 'RaceDeck/0.1 (+https://racedeck.app)'
const MIN_YEAR = 1950
const MAX_YEAR = 2100

export class StandingsService {
  private cache = new Map<string, { at: number; value: StandingsResult }>()

  private async json(url: string, signal: AbortSignal): Promise<unknown> {
    const res = await net.fetch(url, {
      headers: { accept: 'application/json', 'user-agent': UA },
      signal
    })
    if (!res.ok) throw new Error(`Jolpica request failed (${res.status}).`)
    return res.json()
  }

  private withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    return fn(controller.signal).finally(() => clearTimeout(timer))
  }

  async getChampionship(rawRequest: unknown): Promise<StandingsResult> {
    const req = validateRequest(rawRequest)
    if (!req) return { ok: false, error: 'Invalid standings request.', championship: null }

    const cacheKey = `${req.year}:${req.sessionDate ?? ''}`
    const cached = this.cache.get(cacheKey)
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.value

    try {
      const value = await this.withTimeout(async (signal) => {
        const championship = await this.build(req, signal)
        return { ok: true, error: null, championship } satisfies StandingsResult
      })
      this.cache.set(cacheKey, { at: Date.now(), value })
      return value
    } catch (err) {
      return {
        ok: false,
        error: (err as Error)?.name === 'AbortError'
          ? `Standings request timed out after ${REQUEST_TIMEOUT_MS / 1000}s.`
          : (err as Error)?.message || 'Standings request failed.',
        championship: null
      }
    }
  }

  private async build(req: StandingsRequest, signal: AbortSignal): Promise<SeasonChampionship> {
    const schedule = parseSchedule(
      await this.json(`${JOLPICA_BASE}/${req.year}/races/?limit=100`, signal)
    )
    const totalRounds = schedule.reduce((max, r) => Math.max(max, r.round), 0)
    const round = resolveRound(schedule, req.sessionDate ?? null)
    const roundResolved = round != null

    // Baseline = standings AFTER the round before this one. Round 1 (or an
    // unresolved date pointing at the season opener) has an empty baseline; an
    // unresolved date otherwise falls back to the latest available standings.
    const baselineRound = round != null ? round - 1 : null
    let driverStandings: SeasonChampionship['driverStandings'] = []
    let constructorStandings: SeasonChampionship['constructorStandings'] = []
    if (baselineRound == null) {
      driverStandings = parseDriverStandings(
        await this.json(`${JOLPICA_BASE}/${req.year}/driverstandings/?limit=100`, signal)
      )
      constructorStandings = parseConstructorStandings(
        await this.json(`${JOLPICA_BASE}/${req.year}/constructorstandings/?limit=100`, signal)
      )
    } else if (baselineRound >= 1) {
      driverStandings = parseDriverStandings(
        await this.json(`${JOLPICA_BASE}/${req.year}/${baselineRound}/driverstandings/?limit=100`, signal)
      )
      constructorStandings = parseConstructorStandings(
        await this.json(`${JOLPICA_BASE}/${req.year}/${baselineRound}/constructorstandings/?limit=100`, signal)
      )
    }

    const remainingRounds = round != null ? Math.max(0, totalRounds - round) : 0
    const remainingSprints = round != null
      ? schedule.filter((r) => r.round > round && r.hasSprint).length
      : 0
    const raceName = round != null
      ? schedule.find((r) => r.round === round)?.raceName ?? null
      : null

    return {
      year: req.year,
      round,
      roundResolved,
      raceName,
      totalRounds,
      remainingRounds,
      remainingSprints,
      driverStandings,
      constructorStandings
    }
  }
}

function validateRequest(value: unknown): StandingsRequest | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const req = value as Record<string, unknown>
  const year = typeof req.year === 'number' ? Math.trunc(req.year) : NaN
  if (!Number.isFinite(year) || year < MIN_YEAR || year > MAX_YEAR) return null
  const sessionDate = typeof req.sessionDate === 'string' ? req.sessionDate.slice(0, 40) : null
  return { year, sessionDate }
}
