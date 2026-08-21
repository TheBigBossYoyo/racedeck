import { inflateRawSync } from 'node:zlib'
import {
  F1_LIVETIMING_BASE,
  stripBom,
  parseJsonStream,
  splitStreamLine,
  type F1SessionSummary,
  type F1SessionData,
  type F1SessionEnrichmentRequest,
  type F1SessionEnrichmentChunk,
  type F1StreamPoint
} from '@shared/f1live'

/**
 * F1LiveService (main process) — fetches Formula 1's OWN official timing archive
 * from `livetiming.formula1.com/static/…` and decodes it for the renderer.
 *
 * This is PUBLIC data (the same feed FastF1/MultiViewer read): no login, no
 * token, no credential — RaceDeck never touches your F1 TV account here (that's
 * only for video, via TOD). Running in the main process avoids browser CORS and
 * gives us Node's zlib to inflate the `.z` telemetry/position feeds. All parsing
 * is delegated to the pure helpers in `@shared/f1live`.
 */

const REQUEST_TIMEOUT_MS = 30_000
const CORE_FEED_TIMEOUT_MS = 120_000
const CORE_FEED_ATTEMPTS = 2
const POSITION_FEED_TIMEOUT_MS = 90_000
const CARDATA_FEED_TIMEOUT_MS = 180_000
const Z_FEED_ATTEMPTS = 2 // retry one transient timeout/network failure in the background
const DECODE_YIELD_EVERY_LINES = 100 // keep the main-process event loop responsive during bursts
/**
 * Hard cap on how long a gated request may sit between headers and body read
 * (the Position request is issued immediately but only consumed once required
 * timing validates; the wait is bounded by the required-feed retry budget).
 */
const READ_GATE_MAX_WAIT_MS = CORE_FEED_TIMEOUT_MS * 2 + 30_000
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

// Decimation targets keep the one-shot IPC payload sane on long races.
const CARDATA_MIN_DT = 1 // 1 Hz telemetry; sufficient for dashboard traces/ERS
const POSITION_MIN_DT = 0.5 // 2 Hz positions, interpolated in the renderer for smooth motion
const MAX_CACHED_SESSIONS = 1
const MAX_ENRICHMENT_OFFSET = 1_000_000

const LIGHT_FEEDS = [
  'DriverList',
  'TimingData',
  'TimingAppData',
  'WeatherData',
  'RaceControlMessages',
  'TrackStatus',
  'LapCount',
  'ExtrapolatedClock'
] as const
const REQUIRED_FEEDS = ['DriverList', 'TimingData'] as const

/**
 * Feeds the LIVE socket subscribes to, fetched for replays as well so an
 * archived session is as rich as a live one — team radio, speed traps, official
 * per-lap positions, measured pit-lane times and the weather history all exist in
 * the archive and were simply never requested. Together they add ~0.6 MB against
 * TimingData's ~5.7 MB for a race, so the cost is marginal.
 *
 * Kept SEPARATE from LIGHT_FEEDS because these are optional: a session that lacks
 * one is not a degraded load, so a miss here must not suppress caching the way a
 * missing core feed rightly does.
 */
const OPTIONAL_FEEDS = [
  'LapSeries',
  'TimingStats',
  'TopThree',
  'TeamRadio',
  'PitLaneTimeCollection',
  'CurrentTyres',
  'TyreStintSeries',
  'WeatherDataSeries',
  'TlaRcm',
  'SessionStatus'
] as const

interface RawSession {
  Key: number
  Type?: string
  Number?: number
  Name?: string
  StartDate?: string
  EndDate?: string
  GmtOffset?: string
  Path?: string
}
interface RawMeeting {
  Key?: number
  Name?: string
  OfficialName?: string
  Location?: string
  Country?: { Code?: string; Name?: string }
  Circuit?: { ShortName?: string }
  Sessions?: RawSession[]
}
interface RawSeasonIndex {
  Year?: number
  Meetings?: RawMeeting[]
}

type HighRateFeed = F1SessionEnrichmentRequest['feed']

/**
 * A high-rate feed decoded progressively while it downloads. Chunk requests can
 * be answered as soon as their offset window is decoded, instead of waiting for
 * the full multi-megabyte `.z` file — the renderer streams the map/telemetry in
 * while the tail of the file is still on the wire.
 */
interface HighRateLoad {
  path: string
  points: F1StreamPoint[]
  duration: number
  done: boolean
  error: unknown
  /** Resolves whenever `points`/`done`/`error` advance; re-armed after each advance. */
  progress: Promise<void>
  advance: () => void
}

function createHighRateLoad(path: string): HighRateLoad {
  let resolveProgress: () => void = () => {}
  const load: HighRateLoad = {
    path,
    points: [],
    duration: 0,
    done: false,
    error: null,
    progress: Promise.resolve(),
    advance: () => {}
  }
  const arm = (): void => {
    load.progress = new Promise<void>((resolve) => {
      resolveProgress = resolve
    })
  }
  load.advance = () => {
    const resolve = resolveProgress
    arm()
    resolve()
  }
  arm()
  return load
}

const yieldMain = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export class F1LiveService {
  /** Single-entry decoded caches prevent multi-session heap growth. */
  private cache = new Map<string, F1SessionData>()
  private highRateLoads = new Map<string, HighRateLoad>()
  private completePaths = new Set<string>()

  constructor(
    private readonly fetchImpl: FetchLike = (input, init) => globalThis.fetch(input, init)
  ) {}

  private async getText(url: string, signal: AbortSignal): Promise<string> {
    const res = await this.fetchImpl(url, {
      headers: { accept: '*/*', 'user-agent': UA },
      signal
    })
    if (!res.ok) throw new Error(`F1 archive ${res.status} for ${url}`)
    return stripBom(await res.text())
  }

  private withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    return fn(controller.signal).finally(() => clearTimeout(timer))
  }

  private async getTextWithRetry(url: string, timeoutMs: number, attempts: number): Promise<string> {
    let lastError: unknown = new Error(`F1 archive request failed for ${url}`)
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        return await this.getText(url, controller.signal)
      } catch (error) {
        lastError = error
      } finally {
        clearTimeout(timer)
      }
    }
    throw lastError
  }

  /**
   * Stream-parse a plain `.jsonStream` feed: lines are split and JSON-parsed as
   * network chunks arrive instead of buffering the multi-megabyte response and
   * parsing it in one main-thread burst after the download.
   */
  private async getStreamPointsWithRetry(
    url: string,
    timeoutMs: number,
    attempts: number
  ): Promise<F1StreamPoint[]> {
    let lastError: unknown = new Error(`F1 archive request failed for ${url}`)
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const res = await this.fetchImpl(url, {
          headers: { accept: '*/*', 'user-agent': UA },
          signal: controller.signal
        })
        if (!res.ok) throw new Error(`F1 archive ${res.status} for ${url}`)
        const points: F1StreamPoint[] = []
        await this.consumeResponseLines(res, (raw) => {
          const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
          if (!line.trim()) return
          const split = splitStreamLine(line)
          if (!split) return
          try {
            points.push({ t: split.t, d: JSON.parse(split.rest) })
          } catch {
            /* skip malformed line */
          }
        })
        return points
      } catch (error) {
        lastError = error
      } finally {
        clearTimeout(timer)
      }
    }
    throw lastError
  }

  /** Split a response into lines as chunks arrive, yielding the event loop periodically. */
  private async consumeResponseLines(res: Response, onLine: (line: string) => void): Promise<void> {
    let sinceYield = 0
    const maybeYield = async (): Promise<void> => {
      if (++sinceYield >= DECODE_YIELD_EVERY_LINES) {
        sinceYield = 0
        await yieldMain()
      }
    }
    const body = res.body
    if (body && typeof body.getReader === 'function') {
      const reader = body.getReader()
      const decoder = new TextDecoder() // strips a leading UTF-8 BOM
      let pending = ''
      for (;;) {
        const { done, value } = await reader.read()
        let text = pending
        if (value) text += decoder.decode(value, { stream: true })
        if (done) text += decoder.decode()
        let lineStart = 0
        for (;;) {
          const newline = text.indexOf('\n', lineStart)
          if (newline < 0) break
          onLine(text.slice(lineStart, newline))
          lineStart = newline + 1
          await maybeYield()
        }
        pending = lineStart > 0 ? text.slice(lineStart) : text
        if (done) break
      }
      if (pending) onLine(pending)
    } else {
      // Response without a readable body (tests / exotic stacks): buffered path.
      const text = stripBom(await res.text())
      let lineStart = 0
      while (lineStart <= text.length) {
        const newline = text.indexOf('\n', lineStart)
        onLine(newline < 0 ? text.slice(lineStart) : text.slice(lineStart, newline))
        if (newline < 0) break
        lineStart = newline + 1
        await maybeYield()
      }
    }
  }

  /** List sessions for a season from the archive index (newest first). */
  async listSessions(year: number): Promise<F1SessionSummary[]> {
    return this.withTimeout(async (signal) => {
      const text = await this.getText(`${F1_LIVETIMING_BASE}/${year}/Index.json`, signal)
      const index = JSON.parse(text) as RawSeasonIndex
      const out: F1SessionSummary[] = []
      for (const m of index.Meetings ?? []) {
        for (const s of m.Sessions ?? []) {
          if (!s.Path) continue
          out.push({
            path: s.Path,
            key: s.Key,
            year: index.Year ?? year,
            meetingName: m.Name ?? 'Grand Prix',
            meetingOfficialName: m.OfficialName ?? null,
            name: s.Name ?? s.Type ?? 'Session',
            type: s.Type ?? 'Unknown',
            number: s.Number ?? null,
            circuitShortName: m.Circuit?.ShortName ?? null,
            countryName: m.Country?.Name ?? null,
            countryCode: m.Country?.Code ?? null,
            location: m.Location ?? null,
            startDate: s.StartDate ?? null,
            endDate: s.EndDate ?? null,
            gmtOffset: s.GmtOffset ?? null,
            archiveStatus: null,
            liveStreamActive: false
          })
        }
      }
      return out.reverse() // archive lists oldest→newest; show newest first
    })
  }

  /** Fetch + decode a full session (cached). `path` is the archive session path. */
  async loadSession(path: string): Promise<F1SessionData> {
    path = validateArchivePath(path)
    const cached = this.cache.get(path)
    if (cached) return cached

    const base = `${F1_LIVETIMING_BASE}/${ensureTrailingSlash(path)}`
    const streams: Record<string, F1StreamPoint[]> = {}

    // The commit gates only on DriverList plus a VALIDATED-USABLE TimingData
    // prefix — the timing tail keeps streaming through the enrichment channel
    // while the renderer already preprocesses what exists. The optional light
    // feeds are each a small fraction of TimingData's size, so they download
    // alongside it; only the high-rate `.z` bodies are held back (those
    // genuinely starve TimingData on constrained links).
    let sessionInfo: unknown = null
    let archiveStatus: string | null = null
    const sessionInfoLoad = this.getTextWithRetry(`${base}SessionInfo.json`, REQUEST_TIMEOUT_MS, 1)
      .then((text) => {
        sessionInfo = JSON.parse(text)
        archiveStatus =
          (sessionInfo as { ArchiveStatus?: { Status?: string } })?.ArchiveStatus?.Status ?? null
      })
      .catch(() => undefined)
    let lightFeedFailed = false
    const lightLoads = LIGHT_FEEDS
      .filter((feed) => !REQUIRED_FEEDS.includes(feed as (typeof REQUIRED_FEEDS)[number]))
      .map(async (feed) => {
        try {
          const text = await this.getTextWithRetry(`${base}${feed}.jsonStream`, REQUEST_TIMEOUT_MS, 1)
          streams[feed] = parseJsonStream(text)
        } catch {
          streams[feed] = []
          lightFeedFailed = true
        }
      })
    // Optional feeds load alongside; a miss yields an empty stream and is NOT
    // treated as a failed load (see OPTIONAL_FEEDS).
    const optionalLoads = OPTIONAL_FEEDS.map(async (feed) => {
      try {
        const text = await this.getTextWithRetry(`${base}${feed}.jsonStream`, REQUEST_TIMEOUT_MS, 1)
        streams[feed] = parseJsonStream(text)
      } catch {
        streams[feed] = []
      }
    })

    // Position is requested immediately (saving its TTFB and letting Chromium
    // buffer the response) but its body is only consumed once the TIMING stream
    // has fully decoded: inflating Position on the main thread while timing is
    // still streaming/serving time-slices the two pipelines against each other
    // and measurably delays BOTH the timing commit and the map. Until then TCP
    // backpressure bounds what the unread response can take from the network.
    let releasePositionGate: () => void = () => {}
    const positionGate = new Promise<void>((resolve) => {
      releasePositionGate = resolve
    })
    this.ensureHighRateLoad(path, 'position', positionGate)
    {
      const timingLoad = this.ensureHighRateLoad(path, 'timing')
      void (async () => {
        while (!timingLoad.done && timingLoad.error == null) await timingLoad.progress
        releasePositionGate()
      })()
      const [driverList] = await Promise.all([
        this.getStreamPointsWithRetry(`${base}DriverList.jsonStream`, CORE_FEED_TIMEOUT_MS, CORE_FEED_ATTEMPTS),
        this.waitForUsableTiming(timingLoad),
        sessionInfoLoad
      ])
      streams.DriverList = driverList
      if (!hasUsableDriverList(streams.DriverList)) {
        throw new Error('This F1 session has no usable timing data yet. Check your connection and retry.')
      }
      await Promise.all([...lightLoads, ...optionalLoads])

      const partialTiming = !timingLoad.done
      streams.TimingData = partialTiming ? timingLoad.points.slice(0) : timingLoad.points
      streams.CarData = []
      streams.Position = []

      const duration = Math.max(
        timingLoad.duration,
        Object.values(streams).reduce(
          (max, pts) => (pts.length ? Math.max(max, pts[pts.length - 1].t) : max),
          0
        )
      )
      const summary = this.summaryFromSessionInfo(path, sessionInfo, archiveStatus)
      const data: F1SessionData = { summary, sessionInfo, streams, duration, ...(partialTiming ? { partialTiming } : {}) }

      // The renderer only pulls timing chunks for a partial commit; otherwise
      // drop the progressive buffer so TimingData isn't held twice (and a
      // still-generating session can't be served a stale completed buffer).
      if (!partialTiming) this.highRateLoads.delete(`${path}:timing`)

      // Only cache completed sessions; a live one must keep refetching. A
      // session with a transiently failed optional feed — or a still-streaming
      // timing tail — is served but NOT cached, so a reselect heals/refreshes.
      if (data.summary.archiveStatus === 'Complete') {
        this.completePaths.add(path)
        this.cache.delete(path)
        if (!lightFeedFailed && !partialTiming) {
          this.cache.set(path, data)
          while (this.cache.size > MAX_CACHED_SESSIONS) {
            const oldest = this.cache.keys().next().value
            if (oldest == null) break
            this.cache.delete(oldest)
            this.completePaths.delete(oldest)
          }
        }
      } else this.completePaths.delete(path)
      return data
    }
  }

  /** Resolve as soon as one structurally usable timing frame has decoded. */
  private async waitForUsableTiming(load: HighRateLoad): Promise<void> {
    let scanned = 0
    for (;;) {
      while (scanned < load.points.length) {
        if (isUsableTimingPoint(load.points[scanned])) return
        scanned += 1
      }
      if (load.done || load.error != null) break
      await load.progress
    }
    if (load.error != null) {
      throw load.error instanceof Error ? load.error : new Error(String(load.error))
    }
    throw new Error('This F1 session has no usable timing data yet. Check your connection and retry.')
  }

  /** Start (or reuse) the progressive download+decode of one streamed feed. */
  private ensureHighRateLoad(path: string, feed: HighRateFeed, readGate?: Promise<void>): HighRateLoad {
    const key = `${path}:${feed}`
    const existing = this.highRateLoads.get(key)
    // A failed load is not a cache — replace it so a retry gets a fresh pump.
    if (existing && existing.error == null) return existing
    if (existing) this.highRateLoads.delete(key)
    // Keep at most one session's decoded feeds in memory.
    for (const [otherKey, other] of this.highRateLoads) {
      if (other.path !== path) this.highRateLoads.delete(otherKey)
    }
    const load = createHighRateLoad(path)
    this.highRateLoads.set(key, load)
    void this.pumpHighRateFeed(load, path, feed, readGate)
    return load
  }

  private feedSpec(path: string, feed: HighRateFeed): {
    url: string
    timeoutMs: number
    makeDecoder: () => (line: string) => F1StreamPoint | null
  } {
    const base = `${F1_LIVETIMING_BASE}/${ensureTrailingSlash(path)}`
    if (feed === 'timing') {
      return {
        url: `${base}TimingData.jsonStream`,
        timeoutMs: CORE_FEED_TIMEOUT_MS,
        makeDecoder: () => (line) => {
          const split = splitStreamLine(line)
          if (!split) return null
          try {
            return { t: split.t, d: JSON.parse(split.rest) }
          } catch {
            return null
          }
        }
      }
    }
    const minDt = feed === 'position' ? POSITION_MIN_DT : CARDATA_MIN_DT
    return {
      url: feed === 'position' ? `${base}Position.z.jsonStream` : `${base}CarData.z.jsonStream`,
      timeoutMs: feed === 'position' ? POSITION_FEED_TIMEOUT_MS : CARDATA_FEED_TIMEOUT_MS,
      makeDecoder: () => {
        let lastT = -Infinity
        return (line) => {
          const split = splitStreamLine(line)
          if (!split || split.t < lastT + minDt) return null
          const decoded = this.inflateZ(split.rest)
          if (decoded == null) return null
          lastT = split.t
          return { t: split.t, d: decoded }
        }
      }
    }
  }

  /** Download+decode one feed, publishing points into `load` as they decode. */
  private async pumpHighRateFeed(
    load: HighRateLoad,
    path: string,
    feed: HighRateFeed,
    readGate?: Promise<void>
  ): Promise<void> {
    const { url, timeoutMs, makeDecoder } = this.feedSpec(path, feed)
    let lastError: unknown = null
    for (let attempt = 0; attempt < Z_FEED_ATTEMPTS && !load.done; attempt += 1) {
      try {
        await this.streamFeedAttempt(url, timeoutMs, load, makeDecoder(), attempt === 0 ? readGate : undefined)
        if (load.points.length === 0) throw new Error(`F1 feed was empty for ${url}`)
        load.done = true
      } catch (error) {
        lastError = error
      }
    }
    if (!load.done) load.error = lastError ?? new Error(`F1 feed failed for ${url}`)
    load.advance()
  }

  async loadSessionEnrichmentChunk(rawRequest: unknown): Promise<F1SessionEnrichmentChunk> {
    const req = validateEnrichmentRequest(rawRequest)
    const load = this.ensureHighRateLoad(req.path, req.feed)
    const offset = req.feed === 'position'
      ? req.positionOffset
      : req.feed === 'carData'
        ? req.carDataOffset
        : req.timingOffset ?? 0
    // Serve as soon as the requested window is decoded — not when the download ends.
    while (!load.done && load.error == null && load.points.length < offset + req.limit) {
      await load.progress
    }
    if (load.error != null && load.points.length <= offset) {
      this.highRateLoads.delete(`${req.path}:${req.feed}`)
      throw load.error instanceof Error ? load.error : new Error(String(load.error))
    }
    const slice = load.points.slice(offset, offset + req.limit)
    const nextOffset = offset + slice.length
    const done = (load.done || load.error != null) && nextOffset >= load.points.length
    // Completed feeds for Complete sessions stay as the warm-repeat cache; a
    // still-live session (or a failed stream) must never be served as immutable.
    if (done && (load.error != null || !this.completePaths.has(req.path))) {
      this.highRateLoads.delete(`${req.path}:${req.feed}`)
    }
    return {
      carData: req.feed === 'carData' ? slice : [],
      position: req.feed === 'position' ? slice : [],
      ...(req.feed === 'timing' ? { timing: slice, nextTimingOffset: nextOffset } : {}),
      duration: load.duration,
      nextCarDataOffset: req.feed === 'carData' ? nextOffset : req.carDataOffset,
      nextPositionOffset: req.feed === 'position' ? nextOffset : req.positionOffset,
      done
    }
  }

  /**
   * Stream one feed attempt: split lines as network chunks arrive, decode each
   * retained line, and append into `load`. A retry re-decodes the identical
   * static file from the start and appends only past what the first attempt
   * already published, so served offsets stay valid across a mid-stream network
   * failure. When `readGate` is given, the request goes out immediately but the
   * body is only consumed once the gate resolves — TCP backpressure bounds the
   * bandwidth it can take from the required feeds in the meantime.
   */
  private async streamFeedAttempt(
    url: string,
    timeoutMs: number,
    load: HighRateLoad,
    decodeLine: (line: string) => F1StreamPoint | null,
    readGate?: Promise<void>
  ): Promise<void> {
    const controller = new AbortController()
    const hardTimer = setTimeout(() => controller.abort(), timeoutMs + (readGate ? READ_GATE_MAX_WAIT_MS : 0))
    let decodeTimer: ReturnType<typeof setTimeout> | null = null
    try {
      const res = await this.fetchImpl(url, {
        headers: { accept: '*/*', 'user-agent': UA },
        signal: controller.signal
      })
      if (!res.ok) throw new Error(`F1 archive ${res.status} for ${url}`)
      if (readGate) {
        await readGate
        // The decode budget starts once the body may actually be consumed.
        decodeTimer = setTimeout(() => controller.abort(), timeoutMs)
      }

      let produced = 0
      await this.consumeResponseLines(res, (raw) => {
        const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
        if (!line.trim()) return
        const point = decodeLine(line)
        if (point == null) return
        produced += 1
        if (produced > load.points.length) {
          load.points.push(point)
          load.duration = point.t
          load.advance()
        }
      })
    } finally {
      clearTimeout(hardTimer)
      if (decodeTimer) clearTimeout(decodeTimer)
    }
  }

  /** `"<base64>"` (a JSON string of zlib-raw-deflated JSON) → decoded object. */
  private inflateZ(rest: string): unknown {
    try {
      const b64 = JSON.parse(rest) as unknown
      if (typeof b64 !== 'string' || !b64) return null
      const json = inflateRawSync(Buffer.from(b64, 'base64')).toString('utf8')
      return JSON.parse(json)
    } catch {
      return null
    }
  }

  private summaryFromSessionInfo(
    path: string,
    sessionInfo: unknown,
    archiveStatus: string | null
  ): F1SessionSummary {
    const si = (sessionInfo ?? {}) as {
      Meeting?: {
        Key?: number
        Name?: string
        OfficialName?: string
        Location?: string
        Country?: { Code?: string; Name?: string }
        Circuit?: { ShortName?: string }
      }
      Key?: number
      Type?: string
      Name?: string
      Number?: number
      StartDate?: string
      EndDate?: string
      GmtOffset?: string
    }
    const m = si.Meeting ?? {}
    const yearMatch = /^(\d{4})/.exec(path)
    return {
      path,
      key: si.Key ?? 0,
      year: yearMatch ? +yearMatch[1] : new Date().getUTCFullYear(),
      meetingName: m.Name ?? 'Grand Prix',
      meetingOfficialName: m.OfficialName ?? null,
      name: si.Name ?? si.Type ?? 'Session',
      type: si.Type ?? 'Unknown',
      number: si.Number ?? null,
      circuitShortName: m.Circuit?.ShortName ?? null,
      countryName: m.Country?.Name ?? null,
      countryCode: m.Country?.Code ?? null,
      location: m.Location ?? null,
      startDate: si.StartDate ?? null,
      endDate: si.EndDate ?? null,
      gmtOffset: si.GmtOffset ?? null,
      archiveStatus,
      liveStreamActive: false
    }
  }
}

function ensureTrailingSlash(p: string): string {
  return p.endsWith('/') ? p : `${p}/`
}

function validateArchivePath(path: unknown): string {
  if (typeof path !== 'string') throw new Error('Invalid F1 archive session path.')
  const normalized = path.replace(/\\/g, '/')
  if (
    normalized.length === 0 ||
    normalized.length > 300 ||
    normalized.startsWith('/') ||
    normalized.includes('..') ||
    !/^\d{4}\/[A-Za-z0-9_+%.,()' \-]+\/[A-Za-z0-9_+%.,()' \-]+\/?$/.test(normalized)
  ) {
    throw new Error('Invalid F1 archive session path.')
  }
  return normalized
}

function boundedOffset(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 0
  return Math.min(MAX_ENRICHMENT_OFFSET, Math.trunc(value))
}

function validateEnrichmentRequest(value: unknown): F1SessionEnrichmentRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid F1 enrichment request.')
  }
  const req = value as Record<string, unknown>
  if (req.feed !== 'position' && req.feed !== 'carData' && req.feed !== 'timing') {
    throw new Error('Invalid F1 enrichment feed.')
  }
  const limit = typeof req.limit === 'number' && Number.isFinite(req.limit)
    ? Math.min(500, Math.max(1, Math.trunc(req.limit)))
    : 250
  return {
    path: validateArchivePath(req.path),
    feed: req.feed,
    carDataOffset: boundedOffset(req.carDataOffset),
    positionOffset: boundedOffset(req.positionOffset),
    timingOffset: boundedOffset(req.timingOffset),
    limit
  }
}

function hasUsableDriverList(points: F1StreamPoint[] | undefined): boolean {
  return (points ?? []).some((point) =>
    point.d != null &&
    typeof point.d === 'object' &&
    !Array.isArray(point.d) &&
    Object.entries(point.d).some(([key, value]) => /^\d+$/.test(key) && isNonEmptyRecord(value))
  )
}

function isUsableTimingPoint(point: F1StreamPoint): boolean {
  if (!point.d || typeof point.d !== 'object' || Array.isArray(point.d)) return false
  const lines = (point.d as Record<string, unknown>).Lines
  return Boolean(
    lines &&
    typeof lines === 'object' &&
    !Array.isArray(lines) &&
    Object.entries(lines).some(([key, value]) => /^\d+$/.test(key) && isNonEmptyRecord(value))
  )
}

function isNonEmptyRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0)
}
