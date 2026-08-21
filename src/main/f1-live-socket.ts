import WebSocket from 'ws'
import { inflateRawSync } from 'node:zlib'
import type {
  F1StreamPoint,
  F1SessionSummary,
  F1LiveDataDelta,
  LiveStatus
} from '@shared/f1live'
import { isF1FeedLive } from '@shared/f1-session-state'
import { deepMergeF1 } from '@shared/f1live'
import type { F1AuthContext } from './f1-auth'

/**
 * F1LiveSocket — the LIVE timing client.
 *
 * It connects to Formula 1's real-time timing feed over MODERN SignalR Core
 * (`/signalrcore`), the same public feed MultiViewer/FastF1 use. This feed needs
 * NO login: live *timing data* is a free public stream (the F1 TV subscription is
 * only for the *video*). The one non-obvious requirement is that the negotiate
 * response pins the session to a specific backend via an `AWSALB` sticky cookie,
 * which the websocket upgrade must carry back or it 404s.
 *
 * The classic `/signalr` endpoint (clientProtocol 1.5) is now auth-gated and
 * returns 401 for EVERY credential (verified: anonymous, cookies, and a valid
 * F1 TV entitlement token all get 401), so `/signalrcore` is the only live route.
 *
 * GATED FEEDS. Since the 2025 Dutch GP, `CarData.z` (telemetry) and `Position.z`
 * (car positions) require an F1 TV subscription; everything else is public. The
 * server does not error on a gated topic — it silently OMITS it from the
 * Subscribe result, so the only honest proof the gate opened is those topics
 * actually arriving (`gatedData`).
 *
 * The gate accepts exactly ONE credential: the `subscriptionToken` unwrapped from
 * the `login-session` cookie (see `@shared/f1-subscription-token`, which also
 * documents the two look-alike tokens that silently fail). Verified mid-session:
 * anonymous and token-bearing connections differ by precisely those two topics,
 * which begin flowing at ~1 Hz the moment the right token is presented.
 *
 * Incoming feed items are accumulated into the SAME decoded shape as the archive
 * (topic → [{t,d}]), so the existing F1LiveProvider reconstruction + all widgets
 * work unchanged. Every step logs under RACEDECK_DEBUG and is surfaced via status.
 */

const HTTP_BASE = 'https://livetiming.formula1.com/signalrcore'
const WSS_BASE = 'wss://livetiming.formula1.com/signalrcore'
/** SignalR Core message terminator (record separator, 0x1e). */
const RS = '\x1e'
const UA = 'BestHTTP'
/** Client keepalive ping cadence (server KeepAliveInterval default is 15s). */
const PING_MS = 10_000

/**
 * Retention ceiling for the two heavyweight telemetry topics.
 *
 * Measured live: CarData ~292 KB/min and Position ~262 KB/min of decoded JSON —
 * together 77% of the feed's entire volume, versus ~170 KB/min for every other
 * topic combined. Both arrive at ~1 Hz, so 20,000 points is over five hours of
 * running: a full race weekend day of ACTUAL running never reaches it, and the
 * cap exists only to stop an indefinitely-open connection growing without bound.
 *
 * Only these two are capped. The remaining topics are small enough that bounding
 * them would trade real history for negligible memory.
 */
const MAX_TELEMETRY_POINTS = 20_000
/** Points discarded per trim, so trimming is amortised rather than per-message. */
const TELEMETRY_TRIM_CHUNK = 2_000
const CAPPED_TOPICS = new Set(['CarData', 'Position'])

/**
 * Do we hold credentials worth presenting to F1's feed? Only the subscription
 * bearer opens the gated feeds; cookies alone still authenticate the negotiate,
 * so we present whatever we have and let the feed decide.
 */
export function hasUsableAuth(
  ctx?: { bearer?: string | null; cookieHeader?: string } | null
): boolean {
  return Boolean(ctx?.bearer || ctx?.cookieHeader)
}

/**
 * Topics to subscribe to. F1's server silently DROPS topics it does not serve, so
 * over-asking is free — the Subscribe result only ever contains real ones. The
 * list below was verified against a live session by subscribing to a candidate
 * superset and reading back which names the server accepted.
 *
 * `CarData.z` / `Position.z` are kept deliberately even though F1 no longer
 * serves them live (see the file header): if they come back, they just work.
 */
export const SUBSCRIBE_TOPICS = [
  'Heartbeat',
  'SessionInfo',
  'SessionStatus',
  'DriverList',
  'TimingData',
  'TimingAppData',
  'TimingStats',
  'TopThree',
  'WeatherData',
  'RaceControlMessages',
  'TrackStatus',
  'LapCount',
  'SessionData',
  'ExtrapolatedClock',
  'TeamRadio',
  'PitLaneTimeCollection',
  'TyreStintSeries',
  'CurrentTyres',
  'LapSeries',
  'WeatherDataSeries',
  'TlaRcm',
  // Kept in case F1 restores them; absent from the live feed today.
  'CarData.z',
  'Position.z'
]

export class F1LiveSocket {
  private ws: WebSocket | null = null
  private streams: Record<string, F1StreamPoint[]> = {}
  /**
   * Points dropped from the FRONT of each stream by trimming.
   *
   * Cursors handed to the renderer are absolute positions in the topic's full
   * history, not indices into the retained array. Without this offset, trimming
   * would shift every index and the renderer would silently re-receive or skip
   * points — the delta protocol assumes append-only numbering.
   */
  private dropped: Record<string, number> = {}
  private sessionInfo: unknown = null
  /** Latest value of the dedicated `SessionStatus` topic (fresher than SessionInfo). */
  private sessionStatus: string | null = null
  private t0 = 0
  private messages = 0
  /** Feed deltas on real session topics (excludes Heartbeat, which ticks when idle). */
  private substantiveMessages = 0
  private handshakeDone = false
  private authed = false
  /** Set once a GATED feed (CarData/Position) actually delivers usable data. */
  private gatedData = false
  /** True once the renderer has read a snapshot, after which streams are append-only. */
  private published = false
  private generation = 0
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private status: LiveStatus = {
    state: 'idle',
    detail: null,
    sessionName: null,
    messages: 0,
    subscription: false,
    live: false,
    updatedAt: new Date().toISOString()
  }
  private onStatus: ((s: LiveStatus) => void) | null = null

  setStatusListener(cb: (s: LiveStatus) => void): void {
    this.onStatus = cb
  }

  getStatus(): LiveStatus {
    return this.status
  }

  private debug(...args: unknown[]): void {
    if (process.env.RACEDECK_DEBUG) console.log('[f1live-socket]', ...args)
  }

  private patch(p: Partial<LiveStatus>): void {
    this.status = {
      ...this.status,
      ...p,
      messages: this.messages,
      subscription: this.authed,
      gatedData: this.gatedData,
      live: p.live ?? this.computeLive(),
      updatedAt: new Date().toISOString()
    }
    this.onStatus?.(this.status)
  }

  /**
   * Is the connected feed an ACTUALLY-live session? F1 always serves the last
   * event's final snapshot when nothing is racing, so we decide from the feed's
   * own finished-markers (SessionStatus / ArchiveStatus) and schedule window
   * rather than merely "we got data". Delegates to the shared, unit-tested rule.
   */
  private computeLive(): boolean {
    const si = this.sessionInfo as
      | {
          SessionStatus?: string
          ArchiveStatus?: { Status?: string }
          StartDate?: string
          EndDate?: string
          GmtOffset?: string
        }
      | null
    if (!si) return false
    return isF1FeedLive({
      // The dedicated SessionStatus topic pushes transitions (Started/Finalised)
      // that a SessionInfo keyframe alone can go stale on, so prefer it.
      sessionStatus: this.sessionStatus ?? si.SessionStatus ?? null,
      archiveStatus: si.ArchiveStatus?.Status ?? null,
      startDate: si.StartDate ?? null,
      endDate: si.EndDate ?? null,
      gmtOffset: si.GmtOffset ?? null,
      substantiveMessages: this.substantiveMessages
    })
  }

  /**
   * Negotiate + open the SignalR Core websocket. With an F1 TV subscription token
   * in `ctx` we authenticate (unlocking gated live data — positions/telemetry);
   * With a valid F1 TV subscription token we authenticate (unlocking telemetry
   * and car positions); without one we connect anonymously for public timing. An
   * authenticated negotiate that is rejected retries anonymously, so a stale
   * token can never leave the user worse off than no token at all.
   */
  async connect(ctx?: F1AuthContext): Promise<LiveStatus> {
    this.generation++
    this.disconnect()
    this.streams = {}
    this.dropped = {}
    this.sessionInfo = null
    this.sessionStatus = null
    this.messages = 0
    this.substantiveMessages = 0
    this.handshakeDone = false
    this.authed = false
    this.gatedData = false
    this.published = false
    this.t0 = Date.now()
    const authed = hasUsableAuth(ctx)
    this.patch({
      state: 'connecting',
      detail: authed ? 'negotiating (F1 TV subscription)…' : 'negotiating…',
      sessionName: null
    })

    // Try authenticated first; fall back to anonymous on ANY authed failure so a
    // signed-in user can never end up worse off than an anonymous one (rejection,
    // network error, or a missing token all fall through to public timing).
    let neg = await this.negotiate(ctx)
    if (authed && (neg.authRejected || neg.error || !neg.connectionToken)) {
      this.debug('authenticated negotiate failed — retrying anonymously', neg.error ?? `rejected=${neg.authRejected}`)
      this.patch({
        detail: neg.authRejected
          ? 'F1 TV subscription rejected — falling back to public timing…'
          : 'subscription connect failed — falling back to public timing…'
      })
      const anon = await this.negotiate(undefined)
      if (anon.connectionToken && !anon.error) neg = anon
    }
    if (neg.error || !neg.connectionToken) {
      return this.fail(neg.error ?? 'Negotiate returned no connection token.')
    }
    const usedAuth = neg.usedAuth

    const cookieParts = [neg.stickyCookie]
    if (usedAuth && ctx?.cookieHeader) cookieParts.push(ctx.cookieHeader)
    const cookie = cookieParts.filter(Boolean).join('; ')
    const wsHeaders: Record<string, string> = { 'User-Agent': UA, Accept: '*/*' }
    if (cookie) wsHeaders.Cookie = cookie
    if (usedAuth && ctx?.bearer) wsHeaders.Authorization = `Bearer ${ctx.bearer}`

    let wsUrl = `${WSS_BASE}?id=${encodeURIComponent(neg.connectionToken)}`
    // SignalR Core also accepts the token via the access_token query param
    // (websockets can't always set headers). Belt and suspenders.
    if (usedAuth && ctx?.bearer) wsUrl += `&access_token=${encodeURIComponent(ctx.bearer)}`
    this.debug('ws connect authed=', usedAuth, 'cookie?', Boolean(cookie))
    this.authed = usedAuth

    return new Promise<LiveStatus>((resolve) => {
      const ws = new WebSocket(wsUrl, { headers: wsHeaders })
      this.ws = ws
      let settled = false
      const settle = (s: LiveStatus) => {
        if (!settled) {
          settled = true
          resolve(s)
        }
      }

      ws.on('open', () => {
        this.debug('ws open — sending handshake')
        // SignalR Core handshake: protocol + version, terminated by RS.
        ws.send(JSON.stringify({ protocol: 'json', version: 1 }) + RS)
        this.patch({ state: 'connecting', detail: 'handshaking…' })
      })

      ws.on('message', (raw) => this.onFrames(raw.toString(), ws, settle))

      ws.on('error', (err) => {
        this.debug('ws error', err.message)
        settle(this.fail(`WebSocket error: ${err.message}`))
      })

      ws.on('close', (code) => {
        this.debug('ws close', code)
        this.stopPing()
        if (this.status.state !== 'error') this.patch({ state: 'closed', detail: `closed (${code})` })
      })
    })
  }

  /**
   * One SignalR Core negotiate. Returns the connection token + AWSALB sticky
   * cookie, or an error. `authRejected` is set on 401/403 so the caller can
   * transparently fall back to anonymous.
   */
  private async negotiate(
    ctx?: F1AuthContext
  ): Promise<{
    connectionToken?: string
    stickyCookie: string
    usedAuth: boolean
    error?: string
    authRejected?: boolean
  }> {
    const usedAuth = hasUsableAuth(ctx)
    const headers: Record<string, string> = {
      'User-Agent': UA,
      Accept: '*/*',
      'Content-Length': '0'
    }
    // Present whatever we hold: bearer when sniffed, cookies always. Cookie-only
    // still authenticates a returning subscriber whose token wasn't re-captured.
    if (usedAuth && ctx?.bearer) headers.Authorization = `Bearer ${ctx.bearer}`
    if (usedAuth && ctx?.cookieHeader) headers.Cookie = ctx.cookieHeader
    try {
      const res = await fetch(`${HTTP_BASE}/negotiate?negotiateVersion=1`, { method: 'POST', headers })
      this.debug('negotiate status', res.status, 'authed', usedAuth)
      const setCookies =
        typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : []
      const stickyCookie = setCookies.map((c) => c.split(';')[0]).join('; ')
      if (res.status === 401 || res.status === 403) {
        return { stickyCookie, usedAuth, authRejected: true, error: `Live feed rejected auth (${res.status}).` }
      }
      if (!res.ok) return { stickyCookie, usedAuth, error: `Negotiate failed (${res.status}).` }
      const body = (await res.json()) as { connectionToken?: string }
      return { connectionToken: body.connectionToken, stickyCookie, usedAuth }
    } catch (e) {
      return { stickyCookie: '', usedAuth, error: `Negotiate error: ${(e as Error).message}` }
    }
  }

  /** Handle one websocket payload, which may batch several RS-delimited frames. */
  private onFrames(text: string, ws: WebSocket, settle: (s: LiveStatus) => void): void {
    for (const frame of text.split(RS)) {
      if (!frame) continue
      let msg: Record<string, unknown>
      try {
        msg = JSON.parse(frame)
      } catch {
        continue
      }

      // First frame after connect is the handshake response: {} or {error}.
      if (!this.handshakeDone) {
        this.handshakeDone = true
        if (typeof msg.error === 'string') {
          settle(this.fail(`Handshake rejected: ${msg.error}`))
          return
        }
        this.debug('handshake ok — subscribing')
        ws.send(
          JSON.stringify({ type: 1, invocationId: '0', target: 'Subscribe', arguments: [SUBSCRIBE_TOPICS] }) +
            RS
        )
        this.startPing()
        this.patch({
          state: 'connected',
          detail: this.authed
            ? 'F1 TV subscription sent — waiting for session…'
            : 'public timing (sign in for telemetry) — waiting for session…'
        })
        settle(this.status)
        continue
      }

      const type = msg.type as number | undefined
      if (type === 6) continue // server ping/keepalive
      if (type === 7) {
        // close message
        this.debug('server close frame', msg.error)
        continue
      }
      if (type === 3) {
        // Completion of our Subscribe → full initial state (topic → value).
        const result = msg.result as Record<string, unknown> | undefined
        if (result && typeof result === 'object') {
          for (const [topic, data] of Object.entries(result)) this.ingest(topic, data)
          this.debug('initial state topics', Object.keys(result))
        }
        this.patch({ detail: this.connectedDetail(), sessionName: this.currentSessionName() })
        continue
      }
      if (type === 1) {
        // Server invoking a client method — the live feed: arguments [topic, data, ts].
        const args = msg.arguments as unknown[] | undefined
        if (msg.target === 'feed' && Array.isArray(args) && args.length >= 2) {
          this.messages++
          const topic = String(args[0])
          // Heartbeat ticks even when nothing is racing — it is NOT evidence of a
          // live session, so it doesn't count toward substantive activity.
          if (topic !== 'Heartbeat') this.substantiveMessages++
          this.ingest(topic, args[1])
          if (this.messages === 1 || this.messages % 25 === 0) {
            this.patch({ detail: this.connectedDetail(), sessionName: this.currentSessionName() })
          }
        }
        continue
      }
    }
  }

  private startPing(): void {
    this.stopPing()
    this.pingTimer = setInterval(() => {
      try {
        this.ws?.send(JSON.stringify({ type: 6 }) + RS)
      } catch {
        /* ignore */
      }
    }, PING_MS)
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer)
      this.pingTimer = null
    }
  }

  /** Normalize one feed item into a decoded {t,d} point on its topic stream. */
  private ingest(topic: string, data: unknown): void {
    const t = Math.max(0, (Date.now() - this.t0) / 1000)
    let decoded: unknown = data
    let key = topic
    if (topic.endsWith('.z')) {
      key = topic.slice(0, -2) // "CarData.z" → "CarData"
      decoded = this.inflate(data)
      if (decoded == null) return
    }
    // Merge SessionInfo deltas onto the keyframe so liveness/metadata stay
    // complete as a session transitions (a small delta must not wipe the rest).
    if (topic === 'SessionInfo') this.sessionInfo = deepMergeF1(this.sessionInfo, decoded)
    if (topic === 'SessionStatus') {
      const status = (decoded as { Status?: string } | null)?.Status
      if (typeof status === 'string' && status) this.sessionStatus = status
    }
    // WeatherDataSeries is the session's weather history as one keyframe. Expanded
    // into the ordinary WeatherData stream, it backfills the trend for a mid-
    // session connect — which otherwise starts empty, since WeatherData only ever
    // delivers readings from the moment we connected onward.
    if (topic === 'WeatherDataSeries') {
      this.expandWeatherSeries(decoded)
      return
    }
    // The GATED feeds arriving is the ONLY honest proof the subscription unlocked
    // telemetry — a decoded CarData/Position frame flips gatedData true. F1 omits
    // gated topics silently, so arrival is the only trustworthy proof.
    if (!this.gatedData && (key === 'CarData' || key === 'Position')) this.gatedData = true
    const arr = this.streams[key] ?? []
    arr.push({ t, d: decoded })
    if (arr.length > MAX_TELEMETRY_POINTS && CAPPED_TOPICS.has(key)) {
      arr.splice(0, TELEMETRY_TRIM_CHUNK)
      this.dropped[key] = (this.dropped[key] ?? 0) + TELEMETRY_TRIM_CHUNK
      this.debug('trimmed', key, 'dropped total', this.dropped[key])
    }
    this.streams[key] = arr
  }

  /**
   * Fold a WeatherDataSeries keyframe into the WeatherData stream.
   *
   * Samples predating the connection get a NEGATIVE `t` (seconds relative to
   * connect), which the renderer's `t <= clock` history filter and
   * nearest-at-or-before lookups both handle. The stream is re-sorted afterwards
   * because the current-conditions keyframe may already have landed at t=0.
   */
  private expandWeatherSeries(decoded: unknown): void {
    const series = (decoded as { Series?: unknown } | null)?.Series
    if (!Array.isArray(series)) return
    const existing = this.streams.WeatherData ?? []
    const seen = new Set(existing.map((p) => p.t))
    // Once the renderer has read a snapshot it tracks these streams by cursor
    // index, so inserting history behind the cursor would silently skip points.
    // Backfill is therefore only allowed before the first read; afterwards this
    // degrades to append-only, which later deltas satisfy naturally anyway.
    const lastT = existing.length > 0 ? existing[existing.length - 1].t : -Infinity
    const appendOnly = this.published
    let added = false
    for (const raw of series) {
      const entry = raw as { Timestamp?: unknown; Weather?: unknown }
      if (typeof entry?.Timestamp !== 'string' || !entry.Weather) continue
      const ms = Date.parse(entry.Timestamp)
      if (!Number.isFinite(ms)) continue
      const t = (ms - this.t0) / 1000
      if (seen.has(t) || (appendOnly && t <= lastT)) continue
      seen.add(t)
      existing.push({ t, d: entry.Weather })
      added = true
    }
    if (!added) return
    if (!appendOnly) existing.sort((a, b) => a.t - b.t)
    this.streams.WeatherData = existing
  }

  private inflate(data: unknown): unknown {
    if (typeof data !== 'string' || !data) return null
    try {
      return JSON.parse(inflateRawSync(Buffer.from(data, 'base64')).toString('utf8'))
    } catch {
      return null
    }
  }

  private currentSessionName(): string | null {
    const si = this.sessionInfo as { Meeting?: { Name?: string }; Name?: string } | null
    if (!si) return null
    return [si.Meeting?.Name, si.Name].filter(Boolean).join(' · ') || null
  }

  /**
   * Human status line for the connected state. When a session is genuinely live
   * we say so; when the feed is only replaying the last finished event we say
   * THAT plainly, so the app never implies a stale race is happening now.
   *
   * The no-telemetry case must be specific about WHY, because the two causes need
   * opposite responses from the user: no/expired token is fixed by signing in,
   * while a valid token means the data is simply not flowing yet.
   */
  private connectedDetail(): string {
    if (this.computeLive()) {
      if (this.gatedData) return 'live session — full F1 TV data (telemetry + positions)'
      if (this.authed) return 'live session — waiting for telemetry; if it doesn’t start, sign in to F1 TV again to refresh your token'
      return 'live session — public timing. Sign in with F1 TV for car telemetry & positions.'
    }
    const name = this.currentSessionName()
    return name
      ? `No live session right now — F1's feed last covered ${name} (finished). It'll load automatically when a session goes live.`
      : 'Connected — no live session right now. It’ll load automatically when one starts.'
  }

  /** Snapshot the accumulated live feed as an F1SessionData for the provider. */
  getData(rawCursors: Record<string, number> = {}, generation?: number): F1LiveDataDelta | null {
    if (this.status.state === 'idle') return null
    this.published = true
    const duration = Object.values(this.streams).reduce(
      (max, pts) => (pts.length ? Math.max(max, pts[pts.length - 1].t) : max),
      0
    )
    const summary = this.summary()
    const streams: Record<string, F1StreamPoint[]> = {}
    const cursors: Record<string, number> = {}
    const effectiveCursors = generation === this.generation ? rawCursors : {}
    for (const [topic, points] of Object.entries(this.streams)) {
      const dropped = this.dropped[topic] ?? 0
      const rawOffset = effectiveCursors[topic]
      // Cursors are absolute; subtract what was trimmed to index the retained
      // array. A cursor pointing into trimmed history clamps to 0, so the reader
      // receives everything still held rather than silently skipping a gap.
      const offset = Number.isFinite(rawOffset)
        ? Math.min(points.length, Math.max(0, Math.trunc(rawOffset) - dropped))
        : 0
      streams[topic] = points.slice(offset)
      cursors[topic] = dropped + points.length
    }
    return { summary, sessionInfo: this.sessionInfo, streams, duration, cursors, generation: this.generation }
  }

  private summary(): F1SessionSummary {
    const si = (this.sessionInfo ?? {}) as {
      Meeting?: { Key?: number; Name?: string; OfficialName?: string; Location?: string; Country?: { Code?: string; Name?: string }; Circuit?: { ShortName?: string } }
      Key?: number
      Type?: string
      Name?: string
      Path?: string
      StartDate?: string
      EndDate?: string
      GmtOffset?: string
    }
    const m = si.Meeting ?? {}
    return {
      path: 'live',
      key: si.Key ?? 0,
      year: new Date().getUTCFullYear(),
      meetingName: m.Name ?? 'Live Session',
      meetingOfficialName: m.OfficialName ?? null,
      name: si.Name ?? si.Type ?? 'Live',
      type: si.Type ?? 'Unknown',
      number: null,
      circuitShortName: m.Circuit?.ShortName ?? null,
      countryName: m.Country?.Name ?? null,
      countryCode: m.Country?.Code ?? null,
      location: m.Location ?? null,
      startDate: si.StartDate ?? null,
      endDate: si.EndDate ?? null,
      gmtOffset: si.GmtOffset ?? null,
      archiveStatus: (si as { ArchiveStatus?: { Status?: string } }).ArchiveStatus?.Status ?? null,
      liveStreamActive: this.computeLive(),
      // `path` stays "live" (the app's session id); this carries the real one so
      // meeting-scoped caches can identify the event being streamed.
      feedPath: si.Path ?? null
    }
  }

  private fail(detail: string): LiveStatus {
    this.patch({ state: 'error', detail })
    this.closeSocket()
    return this.status
  }

  private closeSocket(): void {
    this.stopPing()
    if (this.ws) {
      try {
        this.ws.removeAllListeners()
        this.ws.close()
      } catch {
        /* ignore */
      }
      this.ws = null
    }
  }

  disconnect(): void {
    this.closeSocket()
    if (this.status.state === 'connected' || this.status.state === 'connecting') {
      this.patch({ state: 'closed', detail: 'disconnected' })
    }
  }
}
