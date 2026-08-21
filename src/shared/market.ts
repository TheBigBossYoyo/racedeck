/**
 * Prediction-market (Polymarket) types — shared across main ⇄ renderer.
 *
 * RaceDeck can overlay *public* market-implied win odds next to its own model.
 * This is strictly READ-ONLY public data: the main process fetches Polymarket's
 * open Gamma/CLOB endpoints and sends nothing but a plain Grand-Prix search
 * string (derived from the public session name). No TOD data, credentials,
 * tokens, or user identity ever leave the machine — same guardrails as the AI
 * layer. The feature is opt-in and clearly labelled as a third-party source.
 */

export const POLYMARKET_GAMMA_BASE = 'https://gamma-api.polymarket.com'
export const POLYMARKET_CLOB_BASE = 'https://clob.polymarket.com'

/** One driver's market-implied win chance within a "race winner" event. */
export interface MarketOutcome {
  /** Display name from the market (usually a driver surname, e.g. "Verstappen"). */
  name: string
  /** Raw Yes-share price ∈ [0,1]. Includes the book's overround (vig). */
  probability: number
  /**
   * Overround-normalised win probability: the raw Yes prices across all drivers
   * divided by their sum, so the field sums to 1. This is the apples-to-apples
   * number to compare against our own (normalised) model — the raw prices sum to
   * >1 because of the book's margin.
   */
  fairProbability: number
  /** CLOB token id for the "Yes" share — used for historical price series. */
  yesTokenId: string | null
  /** True once the underlying market has resolved. */
  resolved: boolean
}

export interface MarketEventSummary {
  slug: string
  title: string
  /** True when the event is closed/resolved (odds are final, not live). */
  closed: boolean
  active: boolean
  endDate: string | null
  volume: number | null
}

export interface MarketWinnerRequest {
  /** Free-text query, e.g. "British Grand Prix". Ignored when `slug` is set. */
  query?: string
  /** Exact event slug/URL override (from Settings) — wins over `query`. */
  slug?: string
  /** Session date (ms) — disambiguates the right race weekend by end-date proximity. */
  targetDateMs?: number
}

export interface MarketWinnerResult {
  ok: boolean
  error: string | null
  event: MarketEventSummary | null
  outcomes: MarketOutcome[]
  /** ISO timestamp the data was fetched. */
  fetchedAt: string
  latencyMs: number
}

export interface MarketSearchResult {
  ok: boolean
  error: string | null
  events: MarketEventSummary[]
}

/** A single point in a market's price history. */
export interface MarketHistoryPoint {
  /** Unix seconds. */
  t: number
  /** Yes-share price ∈ [0,1]. */
  p: number
}

export interface MarketHistoryRequest {
  yesTokenId: string
  /** Sampling interval hint: 'max' | '1w' | '1d' | '6h' | '1h'. */
  interval?: string
  /** Bucket size (seconds) hint for the CLOB API. */
  fidelity?: number
  /** Absolute range for replay history. Mutually exclusive with interval. */
  startTs?: number
  endTs?: number
}

export interface MarketHistoryResult {
  ok: boolean
  error: string | null
  yesTokenId: string
  points: MarketHistoryPoint[]
}

export interface ReplayMarketToken {
  driverNumber: number
  yesTokenId: string
}

/** Return a complete replay field only; partial history must never be rescaled to 100%. */
export function normalizeReplayMarketPrices(
  tokens: ReplayMarketToken[],
  histories: Record<string, MarketHistoryPoint[]>,
  errors: Record<string, string | null | undefined>,
  momentUnix: number
): Map<number, number> {
  const prices = new Map<number, number>()
  if (tokens.length === 0) return prices
  for (const token of tokens) {
    if (errors[token.yesTokenId]) return new Map()
    if (!Object.prototype.hasOwnProperty.call(histories, token.yesTokenId)) return new Map()
    const history = histories[token.yesTokenId]
    if (!history?.length) return new Map()
    const price = priceAt(history, momentUnix)
    if (price == null) return new Map()
    prices.set(token.driverNumber, price)
  }
  const total = [...prices.values()].reduce((sum, price) => sum + price, 0)
  if (total <= 0) return new Map()
  for (const [driverNumber, price] of prices) prices.set(driverNumber, price / total)
  return prices
}

/** Slugify a Polymarket event URL or raw slug into a bare slug. */
export function normalizeSlug(input: string): string {
  const s = input.trim()
  if (!s) return ''
  // Accept a full URL like https://polymarket.com/event/<slug>
  const m = s.match(/polymarket\.com\/event\/([^/?#]+)/i)
  if (m) return m[1]
  return s.replace(/^\/+|\/+$/g, '')
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure parsers (unit-tested) — operate on raw Gamma/CLOB JSON, no I/O.
// Polymarket encodes several array fields as JSON *strings*, e.g.
//   outcomes:        "[\"Yes\", \"No\"]"
//   outcomePrices:   "[\"0.42\", \"0.58\"]"
//   clobTokenIds:    "[\"<yes-id>\", \"<no-id>\"]"
// ─────────────────────────────────────────────────────────────────────────────

/** Parse a value that may be a JSON-string array or an already-parsed array. */
export function parseMaybeJsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return []
}

function toNumber(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(n) ? n : null
}

function asBool(value: unknown): boolean {
  return value === true || value === 'true'
}

interface RawEvent {
  slug?: unknown
  title?: unknown
  closed?: unknown
  active?: unknown
  archived?: unknown
  endDate?: unknown
  volume?: unknown
  markets?: unknown
}

export function eventSummary(raw: RawEvent): MarketEventSummary {
  return {
    slug: typeof raw.slug === 'string' ? raw.slug : '',
    title: typeof raw.title === 'string' ? raw.title : '',
    closed: asBool(raw.closed),
    active: asBool(raw.active),
    endDate: typeof raw.endDate === 'string' ? raw.endDate : null,
    volume: toNumber(raw.volume)
  }
}

/**
 * Normalize a Gamma "event" (with grouped per-driver markets) into a ranked
 * list of win-outcomes. Each sub-market is a binary Yes/No on one driver; the
 * Yes price is the implied win probability. Non-winner / malformed markets are
 * dropped. Outcomes are returned sorted by descending probability.
 */
export function normalizeWinnerEvent(rawEvent: unknown): {
  event: MarketEventSummary
  outcomes: MarketOutcome[]
} {
  const raw = (rawEvent ?? {}) as RawEvent
  const event = eventSummary(raw)
  const markets = Array.isArray(raw.markets) ? raw.markets : []
  const outcomes: MarketOutcome[] = []

  for (const m of markets as Record<string, unknown>[]) {
    if (!m || typeof m !== 'object') continue
    const outcomeLabels = parseMaybeJsonArray(m.outcomes).map(String)
    const prices = parseMaybeJsonArray(m.outcomePrices).map((p) => toNumber(p))
    // We only understand the standard binary Yes/No winner market.
    const yesIdx = outcomeLabels.findIndex((o) => o.toLowerCase() === 'yes')
    const idx = yesIdx >= 0 ? yesIdx : 0
    const prob = prices[idx]
    if (prob == null) continue

    const name =
      (typeof m.groupItemTitle === 'string' && m.groupItemTitle.trim()) ||
      driverFromQuestion(typeof m.question === 'string' ? m.question : '') ||
      (typeof m.question === 'string' ? m.question : '')
    if (!name) continue

    const tokenIds = parseMaybeJsonArray(m.clobTokenIds).map(String)
    outcomes.push({
      name,
      probability: Math.min(1, Math.max(0, prob)),
      fairProbability: 0, // filled in below once the whole field is known
      yesTokenId: tokenIds[idx] ?? tokenIds[0] ?? null,
      resolved: asBool(m.closed) && (prob >= 0.999 || prob <= 0.001)
    })
  }

  // De-vig: the raw Yes prices sum to >1 (the book's margin), so normalise them
  // into a proper probability distribution for fair comparison with our model.
  const overround = outcomes.reduce((a, o) => a + o.probability, 0)
  for (const o of outcomes) {
    o.fairProbability = overround > 0 ? o.probability / overround : o.probability
  }

  outcomes.sort((a, b) => b.probability - a.probability)
  return { event, outcomes }
}

/** Extract a driver name from a "Will <First Last> win the …?" question. */
function driverFromQuestion(question: string): string | null {
  const m = question.match(/will\s+(.+?)\s+win\b/i)
  return m ? m[1].trim() : null
}

const STOP_WORDS = new Set(['f1', 'the', 'gp', 'winner', 'win', '2024', '2025', '2026', 'race'])

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w))
}

/**
 * Interchangeable surface forms for each F1 round — GP name ⇄ country ⇄ circuit
 * ⇄ city. This is the crux of reliable market identification: Polymarket may
 * title a market by any of these ("British" vs "Great Britain" vs "Silverstone";
 * "São Paulo" vs "Brazilian"; "Mexico City" vs "Mexican"), and our session name
 * won't always match the one they chose. Matching on the shared canonical round
 * makes the pick robust to that naming drift. All forms are lowercased and
 * punctuation-stripped (so multi-word forms are joined, e.g. "las vegas").
 */
const GP_ALIAS_GROUPS: string[][] = [
  ['bahrain', 'sakhir'],
  ['saudi', 'saudiarabia', 'jeddah'],
  ['australia', 'australian', 'melbourne', 'albertpark'],
  ['japan', 'japanese', 'suzuka'],
  ['china', 'chinese', 'shanghai'],
  ['miami'],
  ['emiliaromagna', 'imola', 'sanmarino'],
  ['monaco', 'montecarlo'],
  ['canada', 'canadian', 'montreal'],
  ['spain', 'spanish', 'barcelona', 'catalunya', 'madrid'],
  ['austria', 'austrian', 'spielberg', 'redbullring'],
  ['britain', 'british', 'greatbritain', 'uk', 'unitedkingdom', 'silverstone'],
  ['hungary', 'hungarian', 'hungaroring', 'budapest'],
  ['belgium', 'belgian', 'spa', 'francorchamps'],
  ['netherlands', 'dutch', 'zandvoort'],
  ['italy', 'italian', 'monza'],
  ['azerbaijan', 'azeri', 'baku'],
  ['singapore', 'marinabay'],
  ['unitedstates', 'usa', 'austin', 'cota', 'americas'],
  ['mexico', 'mexican', 'mexicocity'],
  ['brazil', 'brazilian', 'saopaulo', 'interlagos'],
  ['lasvegas', 'vegas'],
  ['qatar', 'qatari', 'lusail'],
  ['abudhabi', 'yasmarina', 'uae']
]

const GP_SEARCH_LABELS = [
  'Bahrain Grand Prix',
  'Saudi Arabian Grand Prix',
  'Australian Grand Prix',
  'Japanese Grand Prix',
  'Chinese Grand Prix',
  'Miami Grand Prix',
  'Emilia Romagna Grand Prix',
  'Monaco Grand Prix',
  'Canadian Grand Prix',
  'Spanish Grand Prix',
  'Austrian Grand Prix',
  'British Grand Prix',
  'Hungarian Grand Prix',
  'Belgian Grand Prix',
  'Dutch Grand Prix',
  'Italian Grand Prix',
  'Azerbaijan Grand Prix',
  'Singapore Grand Prix',
  'United States Grand Prix',
  'Mexico City Grand Prix',
  'São Paulo Grand Prix',
  'Las Vegas Grand Prix',
  'Qatar Grand Prix',
  'Abu Dhabi Grand Prix'
] as const

/** Short aliases that must match a whole word (avoid substring false hits like uk⊂ukraine). */
const WHOLE_WORD_ALIASES = new Set(['uk', 'usa', 'uae', 'spa', 'baku', 'imola', 'monza', 'vegas'])

/** Which canonical F1 rounds a piece of text refers to (group indices). */
export function canonicalGpKeys(text: string): Set<number> {
  const words = new Set(tokenize(text))
  const flat = text.toLowerCase().replace(/[^a-z0-9]/g, '')
  const keys = new Set<number>()
  GP_ALIAS_GROUPS.forEach((group, i) => {
    for (const alias of group) {
      const hit = WHOLE_WORD_ALIASES.has(alias)
        ? words.has(alias)
        : words.has(alias) || (alias.length >= 5 && flat.includes(alias))
      if (hit) {
        keys.add(i)
        break
      }
    }
  })
  return keys
}

/** Search the session wording first, then Polymarket's canonical round wording. */
export function marketSearchQueries(query: string): string[] {
  const queries = [query.trim()]
  for (const key of canonicalGpKeys(query)) {
    const label = GP_SEARCH_LABELS[key]
    if (label) queries.push(label)
  }
  return [...new Set(queries.filter(Boolean))]
}

/** True when an event looks like an F1 race-winner market (not a season title). */
export function isWinnerEvent(raw: RawEvent): boolean {
  const title = (typeof raw.title === 'string' ? raw.title : '').toLowerCase()
  const slug = (typeof raw.slug === 'string' ? raw.slug : '').toLowerCase()
  const hay = `${title} ${slug}`
  const isF1 = /\bf1\b|grand prix|formula/.test(hay)
  const isWinner = /winner|to win/.test(hay)
  // Exclude season-long outright markets ("2026 F1 Drivers Championship winner").
  const isChampionship = /championship|title|drivers'? champion|constructor/.test(hay)
  return isF1 && isWinner && !isChampionship
}

export interface PickEventOptions {
  /** Session date (ms) — events ending near it are strongly preferred. */
  targetDateMs?: number
}

/**
 * Choose the best F1 winner event for a query from a Gamma search/response list.
 * Ranking (strongest first): shared canonical round (GP/country/circuit synonym)
 * → proximity of the event's end date to the race date → raw title-token overlap
 * → live (active & not-closed) → trading volume. The canonical-round match and
 * date proximity together disambiguate the RIGHT weekend even when Polymarket's
 * naming differs from ours. Returns null when nothing plausibly matches.
 */
export function pickBestEvent(
  events: unknown,
  query: string,
  opts: PickEventOptions = {}
): RawEvent | null {
  const list = Array.isArray(events) ? (events as RawEvent[]) : []
  const qTokens = new Set(tokenize(query))
  const qKeys = canonicalGpKeys(query)
  let best: { ev: RawEvent; score: number; matched: boolean } | null = null

  for (const ev of list) {
    if (!ev || typeof ev !== 'object') continue
    if (!isWinnerEvent(ev)) continue
    const title = typeof ev.title === 'string' ? ev.title : ''
    const slug = typeof ev.slug === 'string' ? ev.slug : ''
    const evKeys = canonicalGpKeys(`${title} ${slug}`)
    let keyOverlap = 0
    for (const k of qKeys) if (evKeys.has(k)) keyOverlap++
    const tokenOverlap = tokenize(title).filter((t) => qTokens.has(t)).length

    const live = asBool(ev.active) && !asBool(ev.closed)
    const vol = toNumber(ev.volume) ?? 0
    const dateBonus = dateProximityBonus(ev.endDate, opts.targetDateMs)

    // Canonical round dominates; date proximity is the key tie-breaker between
    // several GP winner markets; raw overlap, liveness and volume refine.
    const score =
      keyOverlap * 1000 +
      dateBonus +
      tokenOverlap * 100 +
      (live ? 40 : 0) +
      Math.min(20, Math.log10(vol + 1) * 3)
    const matched = keyOverlap > 0 || tokenOverlap > 0
    if (!best || score > best.score) best = { ev, score, matched }
  }

  if (!best) return null
  // Accept when we have an actual round/token match, or when the query is empty
  // (caller wants "any" winner market) and something F1 turned up.
  if (best.matched || qTokens.size === 0) return best.ev
  return null
}

/** 0–60 bonus for an event ending within a couple of weeks of the race date. */
function dateProximityBonus(endDate: unknown, targetDateMs?: number): number {
  if (targetDateMs == null || typeof endDate !== 'string') return 0
  const endMs = Date.parse(endDate)
  if (!Number.isFinite(endMs)) return 0
  const days = Math.abs(endMs - targetDateMs) / 86_400_000
  return Math.max(0, 60 - days * 4) // ~within 2 days ≈ 52; a week ≈ 32; >15 days → 0
}

/** Parse a CLOB prices-history payload into ascending time-ordered points. */
export function parseHistory(json: unknown): MarketHistoryPoint[] {
  const obj = (json ?? {}) as { history?: unknown }
  const arr = Array.isArray(obj.history) ? obj.history.slice(0, 20_000) : []
  const points: MarketHistoryPoint[] = []
  for (const raw of arr as Record<string, unknown>[]) {
    const t = toNumber(raw?.t)
    const p = toNumber(raw?.p)
    if (t == null || p == null) continue
    points.push({ t, p: Math.min(1, Math.max(0, p)) })
  }
  points.sort((a, b) => a.t - b.t)
  return points
}

/** Yes-price at (or just before) a wall-clock instant, from a history series. */
export function priceAt(points: MarketHistoryPoint[], unixSec: number): number | null {
  if (points.length === 0) return null
  if (unixSec <= points[0].t) return points[0].p
  let lo = 0
  let hi = points.length - 1
  let ans = points[0].p
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (points[mid].t <= unixSec) {
      ans = points[mid].p
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return ans
}
