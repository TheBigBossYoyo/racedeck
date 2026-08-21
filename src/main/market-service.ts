import { net } from 'electron'
import {
  POLYMARKET_GAMMA_BASE,
  POLYMARKET_CLOB_BASE,
  normalizeSlug,
  normalizeWinnerEvent,
  pickBestEvent,
  eventSummary,
  isWinnerEvent,
  parseHistory,
  marketSearchQueries,
  type MarketWinnerRequest,
  type MarketWinnerResult,
  type MarketHistoryRequest,
  type MarketHistoryResult,
  type MarketSearchResult,
  type MarketEventSummary
} from '@shared/market'

/**
 * MarketService (main process) — fetches PUBLIC prediction-market odds from
 * Polymarket's open Gamma + CLOB endpoints. No API key, no auth. It transmits
 * only a plain Grand-Prix search string; it never sees TOD credentials, tokens,
 * or protected media. Running in the main process avoids renderer CORS and lets
 * us enforce a hard timeout. All parsing is delegated to the pure, tested
 * helpers in `@shared/market`.
 */

const REQUEST_TIMEOUT_MS = 15_000
const UA = 'RaceDeck/0.1 (+https://racedeck.app)'
const MAX_QUERY_LENGTH = 160
const MAX_TOKEN_LENGTH = 256
const HISTORY_INTERVALS = new Set(['max', '1w', '1d', '6h', '1h'])
const MAX_HISTORY_RANGE_SEC = 14 * 24 * 60 * 60

export class MarketService {
  private async getJson(url: string, signal: AbortSignal): Promise<unknown> {
    const res = await net.fetch(url, {
      headers: { accept: 'application/json', 'user-agent': UA },
      signal
    })
    if (!res.ok) {
      const detail = (await res.text()).replace(/\s+/g, ' ').trim().slice(0, 240)
      throw new Error(`Polymarket request failed (${res.status})${detail ? `: ${detail}` : '.'}`)
    }
    return res.json()
  }

  private withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    return fn(controller.signal).finally(() => clearTimeout(timer))
  }

  private mapError(err: unknown): string {
    if ((err as Error)?.name === 'AbortError') {
      return `Market request timed out after ${REQUEST_TIMEOUT_MS / 1000}s.`
    }
    return (err as Error)?.message || 'Unknown market request error.'
  }

  /** Resolve the winner event → normalized outcomes for a query or explicit slug. */
  async winner(req: MarketWinnerRequest): Promise<MarketWinnerResult> {
    const started = Date.now()
    const done = (over: Partial<MarketWinnerResult>): MarketWinnerResult => ({
      ok: false,
      error: null,
      event: null,
      outcomes: [],
      fetchedAt: new Date().toISOString(),
      latencyMs: Date.now() - started,
      ...over
    })

    try {
      return await this.withTimeout(async (signal) => {
        const slug = req.slug ? normalizeSlug(req.slug).slice(0, MAX_QUERY_LENGTH) : ''
        let rawEvent: unknown = null

        if (slug) {
          const arr = (await this.getJson(
            `${POLYMARKET_GAMMA_BASE}/events?slug=${encodeURIComponent(slug)}`,
            signal
          )) as unknown[]
          rawEvent = Array.isArray(arr) ? arr[0] : null
          if (!rawEvent) {
            return done({ error: `No Polymarket event found for slug "${slug}".` })
          }
        } else {
          const query = (req.query ?? '').trim().slice(0, MAX_QUERY_LENGTH)
          if (!query) return done({ error: 'No race query provided.' })
          const searches = await Promise.all(
            marketSearchQueries(query).map((searchQuery) =>
              this.getJson(
                `${POLYMARKET_GAMMA_BASE}/public-search?q=${encodeURIComponent(
                  searchQuery
                )}&limit_per_type=20&keep_closed_markets=1&search_profiles=false`,
                signal
              )
            )
          )
          const events = searches.flatMap((search) => {
            const value = search as { events?: unknown }
            return Array.isArray(value.events) ? value.events : []
          })
          const chosen = pickBestEvent(events, query, { targetDateMs: req.targetDateMs })
          if (!chosen) {
            return done({ error: `No live F1 winner market matched "${query}".` })
          }
          // The search payload may omit the full markets array — refetch by slug.
          const chosenSlug = normalizeSlug(String((chosen as { slug?: string }).slug ?? ''))
          if (chosenSlug) {
            const arr = (await this.getJson(
              `${POLYMARKET_GAMMA_BASE}/events?slug=${encodeURIComponent(chosenSlug)}`,
              signal
            )) as unknown[]
            rawEvent = (Array.isArray(arr) ? arr[0] : null) ?? chosen
          } else {
            rawEvent = chosen
          }
        }

        const { event, outcomes } = normalizeWinnerEvent(rawEvent)
        if (outcomes.length === 0) {
          return done({ event, error: 'Matched an event but it has no readable winner odds.' })
        }
        return done({ ok: true, event, outcomes })
      })
    } catch (err) {
      return done({ error: this.mapError(err) })
    }
  }

  /** Free-text search for candidate F1 winner events (for the Settings picker). */
  async search(query: string): Promise<MarketSearchResult> {
    try {
      return await this.withTimeout(async (signal) => {
        const q = query.trim().slice(0, MAX_QUERY_LENGTH)
        if (!q) return { ok: true, error: null, events: [] }
        const search = (await this.getJson(
          `${POLYMARKET_GAMMA_BASE}/public-search?q=${encodeURIComponent(
            q
          )}&limit_per_type=20&keep_closed_markets=1&search_profiles=false`,
          signal
        )) as { events?: unknown }
        const list = Array.isArray(search?.events) ? (search!.events as Record<string, unknown>[]) : []
        const events: MarketEventSummary[] = list
          .filter((e) => isWinnerEvent(e))
          .map((e) => eventSummary(e))
        return { ok: true, error: null, events }
      })
    } catch (err) {
      return { ok: false, error: this.mapError(err), events: [] }
    }
  }

  /** Yes-share price history for one outcome token (for replay-synced odds). */
  async history(req: MarketHistoryRequest): Promise<MarketHistoryResult> {
    const yesTokenId = req.yesTokenId.trim().slice(0, MAX_TOKEN_LENGTH)
    const fail = (error: string): MarketHistoryResult => ({
      ok: false,
      error,
      yesTokenId,
      points: []
    })
    if (!yesTokenId) return fail('No token id provided.')
    try {
      return await this.withTimeout(async (signal) => {
        const fidelity = Math.min(10_000, Math.max(1, Math.trunc(req.fidelity ?? 30)))
        const requestedStart = Number.isFinite(req.startTs) ? Math.trunc(req.startTs!) : null
        const requestedEnd = Number.isFinite(req.endTs) ? Math.trunc(req.endTs!) : null
        const hasRange = requestedStart != null && requestedEnd != null && requestedEnd > requestedStart
        const endTs = hasRange ? requestedEnd : null
        const startTs = hasRange ? Math.max(requestedStart, requestedEnd - MAX_HISTORY_RANGE_SEC) : null
        const interval = req.interval && HISTORY_INTERVALS.has(req.interval) ? req.interval : 'max'
        const timeQuery = startTs != null && endTs != null
          ? `startTs=${startTs}&endTs=${endTs}`
          : `interval=${encodeURIComponent(interval)}`
        const json = await this.getJson(
          `${POLYMARKET_CLOB_BASE}/prices-history?market=${encodeURIComponent(
            yesTokenId
          )}&${timeQuery}&fidelity=${fidelity}`,
          signal
        )
        return { ok: true, error: null, yesTokenId, points: parseHistory(json) }
      })
    } catch (err) {
      return fail(this.mapError(err))
    }
  }
}
