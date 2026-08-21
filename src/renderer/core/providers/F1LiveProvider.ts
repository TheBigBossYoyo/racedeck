import type {
  Driver,
  LapSample,
  PositionSample,
  SessionInfo,
  Stint,
  TelemetrySample,
  TimingEntry,
  WeatherSample
} from '@shared/models'
import { clamp } from '@renderer/lib/utils'
import { hasBridge, bridge } from '@renderer/lib/ipc'
import { persist } from '@renderer/store/persist'
import { STORE_NS } from '@shared/ipc-contract'
import {
  deepMergeF1,
  indexedToArray,
  CAR_CHANNELS,
  ch45ToAeroMode,
  parseSessionClock,
  sessionClockRemainingAt,
  type F1SessionData,
  type F1LiveDataDelta,
  type F1StreamPoint,
  type SessionClockPoint
} from '@shared/f1live'
import type { DataProvider, ProviderCapabilities, RaceSnapshot, SessionTimeline } from './types'
import { buildTimeline } from '@renderer/core/engines/SessionPhaseEngine'
import {
  initErsState,
  integrateErs,
  computeErsEstimate,
  applyOvertakeEligibility,
  type ErsDriverState,
  type ErsEstimate,
  type ErsTelemetrySample
} from '@renderer/core/engines/ErsEstimator'
import { nearestAtOrBefore } from './normalize'
import {
  buildClosedTrackPath,
  buildStints,
  buildTiming,
  buildTrackPath,
  collectRaceControl,
  currentStint,
  lapCountAt,
  lapRecordToSample,
  normalizeDrivers,
  normalizeSessionInfo,
  parseLapTime,
  positionCoordinatesAt,
  positionAvailability,
  buildLapPositions,
  buildSessionBests,
  collectPitLaneTimes,
  collectTeamRadio,
  buildCurrentTyres,
  applyCurrentTyres,
  mergeTopThreeDrivers,
  latestTrackMessage,
  qualifyingPartAt,
  trackStatusAt,
  weatherAt,
  type LapRecord
} from './f1normalize'
import { isF1SessionLive } from '@shared/f1-session-state'

const PRECOMPUTE_YIELD_EVERY = 400
const ENRICHMENT_CHUNK_LIMIT = 500 // matches the main-process hard maximum
const ENRICHMENT_EARLY_CHUNK_LIMIT = 250 // finer early Position chunks → earlier closed-lap checks
const ENRICHMENT_EARLY_CHUNK_WINDOW = 1_000 // points; covers a formation lap + first racing lap
const ENRICHMENT_NOTIFY_MIN_MS = 300 // bound snapshot fan-out while chunks stream in

/**
 * Cooperative yield between preprocessing chunks. `scheduler.yield()` (or a
 * MessageChannel hop) resumes in ~0.1 ms; `setTimeout(0)` is clamped to ~4 ms
 * once nested, which adds up over the dozens of yields a session load takes.
 * Exported as an object so tests can observe/replace the yield.
 */
export const renderScheduler = {
  yieldToRenderer: (): Promise<void> => {
    const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler
    if (scheduler?.yield) return scheduler.yield.call(scheduler)
    return new Promise<void>((resolve) => {
      const channel = new MessageChannel()
      channel.port1.onmessage = () => {
        channel.port1.close()
        resolve()
      }
      channel.port2.postMessage(null)
    })
  }
}
const yieldToRenderer = (): Promise<void> => renderScheduler.yieldToRenderer()

/**
 * F1LiveProvider — real Formula 1 data from F1's OWN official timing archive
 * (livetiming.formula1.com), fetched + decoded in the main process and replayed
 * here. Same source MultiViewer/FastF1 use; public, no login. It reconstructs a
 * normalized snapshot at any session time by replaying the incremental feed, so
 * it powers replay of any session AND near-live (the archive fills in during a
 * live session, and RaceDeck's sync offset absorbs the short delay).
 */
export class F1LiveProvider implements DataProvider {
  readonly capabilities: ProviderCapabilities = {
    id: 'f1live',
    label: 'F1 Live Timing (Official)',
    description:
      "Formula 1's own official timing feed (livetiming.formula1.com) — real timing, tyres, telemetry, positions, weather & race control for any session. Public data, no login. The same source MultiViewer uses.",
    supportsHistorical: true,
    supportsLive: true,
    supportsReplay: true,
    requiresAuth: false,
    requiresSubscription: false,
    riskLevel: 'low',
    latencyClass: 'near-real-time'
  }

  private data: F1SessionData | null = null
  private session: SessionInfo | null = null
  private drivers: Driver[] = []

  private timingPoints: F1StreamPoint[] = []
  private appPoints: F1StreamPoint[] = []
  private weatherPoints: F1StreamPoint[] = []
  private trackStatusPoints: F1StreamPoint[] = []
  private lapCountPoints: F1StreamPoint[] = []
  private raceControlPoints: F1StreamPoint[] = []
  private lapSeriesPoints: F1StreamPoint[] = []
  private timingStatsPoints: F1StreamPoint[] = []
  private topThreePoints: F1StreamPoint[] = []
  private pitLanePoints: F1StreamPoint[] = []
  private teamRadioPoints: F1StreamPoint[] = []
  private currentTyrePoints: F1StreamPoint[] = []
  private tlaRcmPoints: F1StreamPoint[] = []
  private positionPoints: F1StreamPoint[] = []
  private carDataPoints: F1StreamPoint[] = []
  private sessionClockPoints: SessionClockPoint[] = []

  private lapsByDriver = new Map<number, LapRecord[]>()
  private totalLaps: number | null = null
  private trackPath: { x: number; y: number }[] = []
  private timelineCache: SessionTimeline | null = null
  private sessionLoadVersion = 0
  private updateListeners = new Set<() => void>()
  private liveCursors: Record<string, number> = {}
  private liveGeneration = 0
  private telemetryAvailable = false
  /**
   * Rolling forward-scan state for lap history / drivers, kept across CONTINUING
   * live polls (same socket generation) and partial-timing streaming so each
   * update only processes newly appended points instead of re-merging the whole
   * session every few seconds.
   */
  private lapBuild = newLapBuild()
  private driverBuild = newDriverBuild()
  private ersProcessed = 0
  /**
   * Markers are held back until the circuit outline exists, so the map appears
   * complete (path + cars together) — but as soon as one confidently closed lap
   * of Position data has streamed in, not when the whole feed has downloaded.
   */
  private positionsPublished = false
  private lastEnrichmentNotifyAt = 0

  /**
   * Per-time ERS estimate, decimated for O(1)-ish lookup. The public F1 feed does
   * NOT expose battery state of charge, so this is a MODEL derived from real
   * throttle/brake telemetry (harvest under braking, deploy under power) — always
   * surfaced with `energyIsEstimate: true`. Empty when CarData is unavailable.
   */
  private ersPoints: { t: number; byDriver: Record<number, ErsEstimate> }[] = []

  /** Rolling ERS integration state, so telemetry batches integrate as they stream. */
  private ersBuild = newErsBuild()

  // Forward-merge cursor (re-used across playback ticks; reset on backward seek).
  private cursorT = -1
  private tIdx = 0
  private aIdx = 0
  private mergedTiming: unknown = {}
  private mergedApp: unknown = {}
  private appStateVersion = 0
  private stintCacheVersion = -1
  private stintCache: Stint[] = []
  private lapCacheKey = ''
  private lapCache: LapSample[] = []

  async listSessions(): Promise<SessionInfo[]> {
    if (!hasBridge()) return []
    const year = new Date().getUTCFullYear()
    const years = [year, year - 1]
    const all: SessionInfo[] = []
    for (const y of years) {
      try {
        const list = await bridge().f1.listSessions(y)
        for (const s of list) {
          all.push({
            id: s.path,
            meetingId: String(s.key),
            name: s.name,
            type: mapType(s.type),
            meetingName: s.meetingName,
            circuitName: s.circuitShortName,
            circuitShortName: s.circuitShortName,
            countryName: s.countryName,
            countryCode: s.countryCode,
            location: s.location,
            dateStart: s.startDate,
            dateEnd: s.endDate,
            gmtOffset: s.gmtOffset,
            year: s.year,
            totalLaps: null,
            provider: 'f1live'
          })
        }
      } catch {
        /* skip a year that fails */
      }
      if (all.length > 0) break // latest season with data is enough
    }
    return all.sort((a, b) => Date.parse(b.dateStart ?? '') - Date.parse(a.dateStart ?? ''))
  }

  async loadSession(sessionId: string): Promise<SessionInfo> {
    const loadVersion = ++this.sessionLoadVersion
    if (!hasBridge()) throw new Error('F1 Live Timing requires the desktop app.')
    if (sessionId !== 'live') {
      // Returning to this socket later must request a fresh full state, even if
      // the underlying connection generation did not change while viewing replay.
      this.liveCursors = {}
      this.liveGeneration = 0
    }
    // `live` pulls the accumulated real-time buffer; otherwise the archive.
    let data: F1SessionData | null
    let continuing = false
    let cachedTrackPath: Promise<{ x: number; y: number }[] | null> | null = null
    if (sessionId === 'live') {
      const delta = await bridge().f1.getLive(this.liveCursors, this.liveGeneration)
      if (loadVersion !== this.sessionLoadVersion) throw new Error('F1 session load was superseded.')
      const merged = this.mergeLiveDelta(delta)
      data = merged.data
      continuing = merged.continuing
      // First poll of a live session: the feed names its own weekend, so an
      // outline traced during an earlier session at this circuit can seed the
      // map now instead of waiting for a car to complete a lap on the feed.
      if (data && !continuing) {
        cachedTrackPath = this.loadCachedTrackPath(sessionId, data.summary.feedPath)
      }
    } else {
      cachedTrackPath = this.loadCachedTrackPath(sessionId)
      data = await bridge().f1.loadSession(sessionId)
      if (loadVersion !== this.sessionLoadVersion) throw new Error('F1 session load was superseded.')
    }
    if (!data) throw new Error('Not connected to F1 live timing yet — sign in and connect first.')
    const session = await this.ingest(data, loadVersion, continuing)
    if (loadVersion !== this.sessionLoadVersion) throw new Error('F1 session load was superseded.')
    if (cachedTrackPath) {
      // A previous session of this race weekend already proved the circuit
      // outline (one meeting = one layout). Reusing it lets the map publish
      // with the FIRST position chunk instead of waiting for a closed lap.
      const cached = await cachedTrackPath
      if (loadVersion !== this.sessionLoadVersion) throw new Error('F1 session load was superseded.')
      if (cached && this.trackPath.length === 0) this.trackPath = cached
    }
    if (sessionId !== 'live' && data.partialTiming) {
      // The timing tail is still downloading: stream and preprocess it before
      // the session counts as loaded, so "loaded" still means fully scrubable.
      await this.streamCoreTiming(sessionId, loadVersion)
      if (loadVersion !== this.sessionLoadVersion) throw new Error('F1 session load was superseded.')
    }
    if (sessionId !== 'live') void this.loadEnrichment(sessionId, loadVersion)
    return session
  }

  /**
   * Meeting-scoped store key: same weekend ⇒ same physical circuit layout.
   *
   * A LIVE session's id is the literal "live", which yields no meeting and so
   * previously locked live sessions out of this cache in both directions — the
   * live map had to wait for a car to complete a whole lap before an outline
   * existed, even when the same circuit had just been replayed. `feedPath` is the
   * live feed's own archive path, so live now shares the weekend's cache entry.
   */
  private trackPathCacheKey(sessionId: string, feedPath?: string | null): string | null {
    const source = sessionId === 'live' ? (feedPath ?? '') : sessionId
    const segments = source.split('/').filter(Boolean)
    if (segments.length < 2) return null
    // electron-store paths split on dots; keep the key flat.
    return segments.slice(0, 2).join('/').replace(/\./g, '_')
  }

  /**
   * The session's archive path — the directory its media and feeds live under.
   *
   * Live sessions carry it as `feedPath` (their `path` is the literal "live");
   * archive sessions ARE addressed by `path`. Both need it: team-radio clips are
   * resolved relative to this directory in replay exactly as they are live.
   */
  private currentFeedPath(): string | null {
    const summary = this.data?.summary
    if (!summary) return null
    if (summary.feedPath) return summary.feedPath
    return summary.path && summary.path !== 'live' ? summary.path : null
  }

  private async loadCachedTrackPath(
    sessionId: string,
    feedPath?: string | null
  ): Promise<{ x: number; y: number }[] | null> {
    try {
      const key = this.trackPathCacheKey(sessionId, feedPath)
      if (!key) return null
      const value = await persist.get<unknown>(STORE_NS.TRACK_PATHS, key)
      if (!Array.isArray(value) || value.length < 20 || value.length > 400) return null
      const path: { x: number; y: number }[] = []
      for (const raw of value) {
        const point = rec(raw)
        const x = point.x
        const y = point.y
        if (typeof x !== 'number' || typeof y !== 'number' || !isFinite(x) || !isFinite(y)) return null
        path.push({ x, y })
      }
      return path
    } catch {
      return null
    }
  }

  private saveTrackPathCache(path: { x: number; y: number }[]): void {
    const sessionId = this.session?.id
    if (!sessionId || path.length < 20) return
    // Live sessions may now SAVE too (keyed by the feed's own path), so the
    // outline traced during FP1 is instantly available to FP2 and the race.
    const key = this.trackPathCacheKey(sessionId, this.currentFeedPath())
    if (!key) return
    void persist.set(STORE_NS.TRACK_PATHS, key, path).catch(() => undefined)
  }

  private mergeLiveDelta(delta: F1LiveDataDelta | null): { data: F1SessionData | null; continuing: boolean } {
    if (!delta) return { data: null, continuing: false }
    const continuing =
      this.session?.id === 'live' &&
      this.data != null &&
      this.liveGeneration === delta.generation
    this.liveCursors = delta.cursors
    this.liveGeneration = delta.generation
    if (!continuing || !this.data) return { data: delta, continuing: false }
    const streams = { ...this.data.streams }
    for (const [topic, points] of Object.entries(delta.streams)) {
      streams[topic] = [...(streams[topic] ?? []), ...points]
    }
    return {
      data: {
        summary: delta.summary,
        sessionInfo: delta.sessionInfo,
        streams,
        duration: Math.max(this.data.duration, delta.duration)
      },
      continuing: true
    }
  }

  /** Pull the still-downloading TimingData tail and preprocess it as it lands. */
  private async streamCoreTiming(sessionId: string, loadVersion: number): Promise<void> {
    let offset = this.timingPoints.length
    let duration = this.data?.duration ?? 0
    for (;;) {
      const chunk = await bridge().f1.loadSessionEnrichment({
        path: sessionId,
        feed: 'timing',
        carDataOffset: 0,
        positionOffset: 0,
        timingOffset: offset,
        limit: ENRICHMENT_CHUNK_LIMIT
      })
      if (loadVersion !== this.sessionLoadVersion || this.session?.id !== sessionId) {
        throw new Error('F1 session load was superseded.')
      }
      const points = chunk.timing ?? []
      offset = chunk.nextTimingOffset ?? offset + points.length
      duration = Math.max(duration, chunk.duration)
      if (points.length > 0) {
        this.timingPoints.push(...points)
        await this.appendLapHistory(loadVersion)
        if (loadVersion !== this.sessionLoadVersion) throw new Error('F1 session load was superseded.')
      }
      if (chunk.done) break
      await yieldToRenderer()
      if (loadVersion !== this.sessionLoadVersion || this.session?.id !== sessionId) {
        throw new Error('F1 session load was superseded.')
      }
    }
    if (this.data) {
      this.data = {
        ...this.data,
        duration: Math.max(this.data.duration, duration),
        streams: { ...this.data.streams, TimingData: this.timingPoints },
        partialTiming: false
      }
    }
    this.timelineCache = this.buildSessionTimeline(this.lapBuild.qualifyingParts)
  }

  onUpdate(listener: () => void): () => void {
    this.updateListeners.add(listener)
    return () => this.updateListeners.delete(listener)
  }

  cancelPendingLoads(): void {
    this.sessionLoadVersion++
  }

  private async loadEnrichment(sessionId: string, loadVersion: number): Promise<void> {
    // Ordering guarantee: the map always publishes before telemetry STARTS.
    // Once it has, CarData streams concurrently with the Position tail — the
    // tail is only needed for scrubbing ahead, so telemetry no longer waits for
    // the whole Position download.
    let carDataStream: Promise<void> | null = null
    const startCarData = (): void => {
      if (carDataStream) return
      carDataStream = this.streamEnrichmentFeed(sessionId, loadVersion, 'carData').catch(() => {
        // Telemetry is optional; core timing and the map remain fully usable.
      })
    }
    try {
      await this.streamEnrichmentFeed(sessionId, loadVersion, 'position', () => {
        if (this.positionsPublished) startCarData()
      })
    } catch {
      // Position is optional; telemetry can still enrich the timing session.
    }
    if (loadVersion !== this.sessionLoadVersion || this.session?.id !== sessionId) return
    startCarData()
    await carDataStream
  }

  /**
   * Pull one high-rate feed chunk-by-chunk and APPLY each chunk as it arrives.
   * The main process serves chunks while the `.z` file is still downloading, so
   * the map (and then telemetry) become usable at the replay start long before
   * the feed's tail exists locally.
   */
  private async streamEnrichmentFeed(
    sessionId: string,
    loadVersion: number,
    feed: 'position' | 'carData',
    onApplied?: () => void
  ): Promise<void> {
    let offset = 0
    let duration = 0
    for (;;) {
      // Position starts with finer chunks so the closed-lap check (and hence the
      // map) can trigger as early in the download as possible.
      const limit = feed === 'position' && !this.positionsPublished && offset < ENRICHMENT_EARLY_CHUNK_WINDOW
        ? ENRICHMENT_EARLY_CHUNK_LIMIT
        : ENRICHMENT_CHUNK_LIMIT
      const chunk = await bridge().f1.loadSessionEnrichment({
        path: sessionId,
        feed,
        carDataOffset: feed === 'carData' ? offset : 0,
        positionOffset: feed === 'position' ? offset : 0,
        limit
      })
      if (loadVersion !== this.sessionLoadVersion || this.session?.id !== sessionId) return
      const points = feed === 'position' ? chunk.position : chunk.carData
      offset = feed === 'position' ? chunk.nextPositionOffset : chunk.nextCarDataOffset
      duration = Math.max(duration, chunk.duration)
      if (feed === 'position') this.appendPositionPoints(points, chunk.done, duration)
      else await this.appendCarDataPoints(points, chunk.done, duration, loadVersion)
      if (loadVersion !== this.sessionLoadVersion) return
      onApplied?.()
      if (chunk.done) return
      await yieldToRenderer()
      if (loadVersion !== this.sessionLoadVersion || this.session?.id !== sessionId) return
    }
  }

  private appendPositionPoints(points: F1StreamPoint[], done: boolean, duration: number): void {
    if (points.length > 0) this.positionPoints.push(...points)
    let justPublished = false
    if (!this.positionsPublished) {
      if (this.trackPath.length > 0 && this.positionPoints.length > 0) {
        // The circuit outline is already known (cached from this weekend) —
        // markers can publish with the very first coordinates.
        this.positionsPublished = true
        justPublished = true
      } else {
        const path = done
          ? buildTrackPath(this.positionPoints)
          : buildClosedTrackPath(this.positionPoints)
        if (path && path.length > 0) {
          this.trackPath = path
          this.positionsPublished = true
          justPublished = true
          this.saveTrackPathCache(path)
        } else if (done) {
          // No drawable circuit in this feed; still expose the raw coordinates.
          this.positionsPublished = true
          justPublished = true
        }
      }
    }
    if (done && this.data) {
      this.data = {
        ...this.data,
        duration: Math.max(this.data.duration, duration),
        streams: { ...this.data.streams, Position: this.positionPoints }
      }
    }
    this.notifyEnrichmentProgress(done || justPublished)
  }

  private async appendCarDataPoints(
    points: F1StreamPoint[],
    done: boolean,
    duration: number,
    loadVersion: number
  ): Promise<void> {
    if (points.length > 0) {
      this.carDataPoints.push(...points)
      if (!this.telemetryAvailable) this.telemetryAvailable = hasUsableCarData(points)
      this.ersProcessed = this.carDataPoints.length
      await this.integrateErsBatch(points, loadVersion)
      if (loadVersion !== this.sessionLoadVersion) return
    }
    if (done && this.data) {
      this.data = {
        ...this.data,
        duration: Math.max(this.data.duration, duration),
        streams: { ...this.data.streams, CarData: this.carDataPoints }
      }
    }
    this.notifyEnrichmentProgress(done)
  }

  private notifyEnrichmentProgress(force: boolean): void {
    const now = performance.now()
    if (!force && now - this.lastEnrichmentNotifyAt < ENRICHMENT_NOTIFY_MIN_MS) return
    this.lastEnrichmentNotifyAt = now
    for (const listener of this.updateListeners) listener()
  }

  /**
   * Set up internal state from a fetched (archive or live) session payload.
   * When `continuing` (a live poll on the same socket generation, append-only
   * data), the rolling builds and playback cursor are KEPT and only the newly
   * appended points are processed — a live poll costs O(new points), not
   * O(whole session).
   */
  private async ingest(
    data: F1SessionData,
    expectedLoadVersion = this.sessionLoadVersion,
    continuing = false
  ): Promise<SessionInfo> {
    if (expectedLoadVersion !== this.sessionLoadVersion) throw new Error('F1 session load was superseded.')
    this.data = data
    this.session = normalizeSessionInfo(data.summary)

    const s = data.streams
    this.timingPoints = s.TimingData ?? []
    this.appPoints = s.TimingAppData ?? []
    this.weatherPoints = s.WeatherData ?? []
    this.trackStatusPoints = s.TrackStatus ?? []
    this.lapCountPoints = s.LapCount ?? []
    this.raceControlPoints = s.RaceControlMessages ?? []
    this.lapSeriesPoints = s.LapSeries ?? []
    this.timingStatsPoints = s.TimingStats ?? []
    this.topThreePoints = s.TopThree ?? []
    this.pitLanePoints = s.PitLaneTimeCollection ?? []
    this.teamRadioPoints = s.TeamRadio ?? []
    this.currentTyrePoints = s.CurrentTyres ?? []
    this.tlaRcmPoints = s.TlaRcm ?? []
    this.positionPoints = s.Position ?? []
    this.carDataPoints = s.CarData ?? []
    this.sessionClockPoints = parseSessionClock(s.ExtrapolatedClock ?? [])
    // Live payloads carry Position inline; archive sessions stream it in later.
    this.positionsPublished = this.positionPoints.length > 0
    this.lastEnrichmentNotifyAt = 0
    if (!continuing) {
      // Fresh session: REPLACE (not clear) the rolling builds so a superseded
      // load that is still mid-yield can only ever write into orphans.
      this.lapBuild = newLapBuild()
      this.driverBuild = newDriverBuild()
      this.lapsByDriver = new Map()
      this.ersBuild = newErsBuild()
      this.ersPoints = []
      this.ersProcessed = 0
      this.telemetryAvailable = hasUsableCarData(this.carDataPoints)
    } else if (!this.telemetryAvailable) {
      this.telemetryAvailable = hasUsableCarData(this.carDataPoints.slice(this.ersProcessed))
    }

    // Drivers = the merged DriverList (near-static keyframe); only new points merge.
    const driverBuild = this.driverBuild
    const driverList = s.DriverList ?? []
    while (driverBuild.processed < driverList.length) {
      driverBuild.state = deepMergeF1(driverBuild.state, driverList[driverBuild.processed].d)
      driverBuild.processed += 1
    }
    this.drivers = normalizeDrivers(driverBuild.state)

    this.totalLaps = this.deriveTotalLaps()
    if (this.session) {
      this.session.totalLaps = this.session.type === 'race' ? this.totalLaps : null
    }

    await yieldToRenderer()
    if (expectedLoadVersion !== this.sessionLoadVersion) throw new Error('F1 session load was superseded.')
    await this.appendLapHistory(expectedLoadVersion)
    if (expectedLoadVersion !== this.sessionLoadVersion) throw new Error('F1 session load was superseded.')
    this.timelineCache = this.buildSessionTimeline(this.lapBuild.qualifyingParts)
    await yieldToRenderer()
    if (expectedLoadVersion !== this.sessionLoadVersion) throw new Error('F1 session load was superseded.')
    this.trackPath = buildTrackPath(this.positionPoints)
    // Persist the traced outline (no-op below the minimum length). Live sessions
    // save too, so FP1's trace seeds FP2 and the race at the same circuit.
    this.saveTrackPathCache(this.trackPath)
    await yieldToRenderer()
    if (expectedLoadVersion !== this.sessionLoadVersion) throw new Error('F1 session load was superseded.')
    const newCarData = this.ersProcessed > 0
      ? this.carDataPoints.slice(this.ersProcessed)
      : this.carDataPoints
    this.ersProcessed = this.carDataPoints.length
    if (newCarData.length > 0) {
      await this.integrateErsBatch(newCarData, expectedLoadVersion)
      if (expectedLoadVersion !== this.sessionLoadVersion) throw new Error('F1 session load was superseded.')
    }
    // A continuing live poll appends strictly newer points: the forward-merge
    // cursor stays valid and the next snapshot advances incrementally instead
    // of re-merging the whole session.
    if (!continuing) this.resetCursor()
    return this.session
  }

  getDuration(): number {
    return this.data?.duration ?? 0
  }

  getInitialClock(): number {
    return this.session?.id === 'live' ? this.getDuration() : this.lapBuild.initialClock
  }

  getSnapshotAt(t: number): RaceSnapshot {
    if (!this.session) throw new Error('F1LiveProvider: no session loaded')
    const clock = clamp(t, 0, this.getDuration() || t)
    this.advanceTo(clock)

    const raceControl = collectRaceControl(this.raceControlPoints, clock)
    // TopThree independently names the leading drivers, recovering identity for
    // anyone the DriverList keyframe hasn't described yet.
    const drivers = mergeTopThreeDrivers(this.drivers, this.topThreePoints, clock)
    const timing = buildTiming(this.mergedTiming, this.mergedApp, drivers, raceControl)
    const currentTyres = buildCurrentTyres(this.currentTyrePoints, clock)
    applyCurrentTyres(timing, currentTyres)
    this.attachErs(timing, clock)
    const weatherHistory = this.weatherPoints
      .filter((p) => p.t <= clock)
      .map((p) => weatherAt(p))
      .filter((w): w is WeatherSample => w !== null)
    const weather = weatherAt(nearestAtOrBefore(this.weatherPoints, clock, (p) => p.t))
    const lc = lapCountAt(nearestAtOrBefore(this.lapCountPoints, clock, (p) => p.t))
    const trackStatus = trackStatusAt(nearestAtOrBefore(this.trackStatusPoints, clock, (p) => p.t))
    const positions = this.positionsAt(clock, timing)
    const availablePositions = positionAvailability(positions)

    const maxLapNo = Math.max(0, ...timing.map((e) => e.lapNumber ?? 0)) || null
    const currentLap = this.session.type === 'race' ? lc.current ?? maxLapNo : null

    return {
      session: this.session,
      drivers,
      timing,
      laps: this.lapsUpTo(clock),
      stints: this.stintsAtCurrentState(),
      raceControl,
      weather,
      weatherHistory,
      positions,
      trackPath: this.trackPath,
      lapPositions: buildLapPositions(this.lapSeriesPoints, clock),
      sessionBests: buildSessionBests(this.timingStatsPoints, clock),
      pitLaneTimes: collectPitLaneTimes(this.pitLanePoints, clock),
      teamRadio: collectTeamRadio(this.teamRadioPoints, clock, this.currentFeedPath()),
      currentTyres,
      trackMessage: latestTrackMessage(this.tlaRcmPoints, clock),
      availability: {
        timing: timing.length > 0,
        laps: this.lapsByDriver.size > 0,
        stints: timing.some((entry) => entry.compound != null && entry.compound !== 'UNKNOWN'),
        intervals: timing.some((e) => typeof e.intervalAhead === 'number'),
        raceControl: this.raceControlPoints.length > 0,
        weather: this.weatherPoints.length > 0,
        positions: availablePositions.positions,
        positionProgress: availablePositions.positionProgress,
        telemetry: this.telemetryAvailable,
        live: this.data
          ? isF1SessionLive({
              path: this.data.summary.path,
              archiveStatus: this.data.summary.archiveStatus,
              startDate: this.data.summary.startDate,
              endDate: this.data.summary.endDate,
              liveStreamActive: this.data.summary.liveStreamActive
            })
          : false
      },
      clock,
      currentLap,
      totalLaps: this.totalLaps,
      trackStatus,
      qualifyingPart: qualifyingPartAt(this.mergedTiming),
      sessionClock: sessionClockRemainingAt(this.sessionClockPoints, clock)
    }
  }

  getDriverLaps(driverNumber: number): LapSample[] {
    return (this.lapsByDriver.get(driverNumber) ?? []).map(lapRecordToSample)
  }

  getTimeline(): SessionTimeline {
    if (this.timelineCache) return this.timelineCache
    return this.buildSessionTimeline([])
  }

  private buildSessionTimeline(qualifyingParts: { t: number; part: 1 | 2 | 3 }[]): SessionTimeline {
    const trackStatus = this.trackStatusPoints.map((p) => ({ t: p.t, status: trackStatusAt(p) }))
    const lapCount = this.lapCountPoints.map((p) => {
      const lc = lapCountAt(p)
      return { t: p.t, current: lc.current, total: lc.total }
    })
    const chequeredTimes = this.findChequeredTimes()
    const qualifyingPhaseEnds = qualifyingParts.flatMap((part, index) => {
      const nextStart = qualifyingParts[index + 1]?.t ?? Number.POSITIVE_INFINITY
      const end = chequeredTimes.find((time) => time >= part.t && time < nextStart)
      return end == null ? [] : [{ t: end, part: part.part }]
    })
    return buildTimeline({
      duration: this.getDuration(),
      type: this.session?.type ?? 'unknown',
      trackStatus,
      lapCount,
      qualifyingParts,
      qualifyingPhaseEnds,
      chequeredHint: chequeredTimes[chequeredTimes.length - 1] ?? null
    })
  }

  /** Feed times (s) of chequered flags, including Q1/Q2/Q3 phase ends. */
  private findChequeredTimes(): number[] {
    const times: number[] = []
    for (const p of this.raceControlPoints) {
      const msgs = rec(p.d).Messages
      const list = Array.isArray(msgs) ? msgs : indexedToArray(msgs)
      for (const raw of list) {
        const m = rec(raw)
        const flag = String(m.Flag ?? '').toUpperCase()
        const text = String(m.Message ?? '').toUpperCase()
        if (flag === 'CHEQUERED' || text.includes('CHEQUERED') || text.includes('CHECKERED')) {
          if (times[times.length - 1] !== p.t) times.push(p.t)
          break
        }
      }
    }
    return times
  }

  getTelemetry(driverNumber: number, t: number, windowSec = 8): TelemetrySample[] {
    const key = String(driverNumber)
    const lo = t - windowSec
    const out: TelemetrySample[] = []
    // Binary-search the window start; a linear scan re-walks the whole session
    // on every widget render once the playhead is deep into a race.
    let low = 0
    let high = this.carDataPoints.length
    while (low < high) {
      const mid = (low + high) >> 1
      if (this.carDataPoints[mid].t < lo) low = mid + 1
      else high = mid
    }
    for (let i = low; i < this.carDataPoints.length; i++) {
      const p = this.carDataPoints[i]
      if (p.t > t) break
      const entries = indexedToArray(rec(p.d).Entries)
      for (const e of entries) {
        const car = rec(rec(rec(e).Cars)[key]).Channels
        if (!car) continue
        const ch = rec(car)
        const drs = num(ch[CAR_CHANNELS.drs])
        out.push({
          driverNumber,
          date: new Date(p.t * 1000).toISOString(),
          speed: num(ch[CAR_CHANNELS.speed]),
          throttle: num(ch[CAR_CHANNELS.throttle]),
          brake: num(ch[CAR_CHANNELS.brake]),
          gear: num(ch[CAR_CHANNELS.gear]),
          rpm: num(ch[CAR_CHANNELS.rpm]),
          drs,
          drsActive: drs != null && [10, 12, 14].includes(drs),
          aeroMode: ch45ToAeroMode(drs)
        })
      }
    }
    return out
  }

  // ── reconstruction internals ────────────────────────────────────────────────

  private resetCursor(): void {
    this.cursorT = -1
    this.tIdx = 0
    this.aIdx = 0
    this.mergedTiming = {}
    this.mergedApp = {}
    this.appStateVersion = 0
    this.stintCacheVersion = -1
    this.stintCache = []
    this.lapCacheKey = ''
    this.lapCache = []
  }

  /** Advance the forward-merge cursor to session time `clock`. */
  private advanceTo(clock: number): void {
    if (clock < this.cursorT) this.resetCursor()
    while (this.tIdx < this.timingPoints.length && this.timingPoints[this.tIdx].t <= clock) {
      this.mergedTiming = deepMergeF1(this.mergedTiming, this.timingPoints[this.tIdx].d)
      this.tIdx++
    }
    while (this.aIdx < this.appPoints.length && this.appPoints[this.aIdx].t <= clock) {
      this.mergedApp = deepMergeF1(this.mergedApp, this.appPoints[this.aIdx].d)
      this.aIdx++
      this.appStateVersion++
    }
    this.cursorT = clock
  }

  private positionsAt(clock: number, timing: TimingEntry[]): PositionSample[] {
    const entries = this.positionsPublished
      ? positionCoordinatesAt(this.positionPoints, clock)
      : {}
    const iso = new Date(clock * 1000).toISOString()
    return timing.map((e) => {
      const p = entries[String(e.driverNumber)]
      return {
        driverNumber: e.driverNumber,
        date: iso,
        x: p?.x ?? null,
        y: p?.y ?? null,
        z: p?.z ?? null,
        position: e.position,
        lapProgress: null
      }
    })
  }

  private lapsUpTo(clock: number): LapSample[] {
    const completedCounts: number[] = []
    for (const recs of this.lapsByDriver.values()) {
      let count = 0
      while (count < recs.length && recs[count].tComplete <= clock) count++
      completedCounts.push(count)
    }
    const cacheKey = completedCounts.join(',')
    if (cacheKey === this.lapCacheKey) return this.lapCache

    const out: LapSample[] = []
    for (const recs of this.lapsByDriver.values()) {
      for (const r of recs) {
        if (r.tComplete <= clock) out.push(lapRecordToSample(r))
      }
    }
    this.lapCacheKey = cacheKey
    this.lapCache = out
    return this.lapCache
  }

  private stintsAtCurrentState(): Stint[] {
    if (this.stintCacheVersion !== this.appStateVersion) {
      this.stintCacheVersion = this.appStateVersion
      this.stintCache = buildStints(this.mergedApp, this.drivers)
    }
    return this.stintCache
  }

  private deriveTotalLaps(): number | null {
    let total: number | null = null
    for (const p of this.lapCountPoints) {
      const t = lapCountAt(p).total
      if (t != null) total = t
    }
    return total
  }

  /**
   * Forward-scan newly appended TimingData into per-lap history (time + sectors
   * + compound). The scan state lives in `lapBuild`, so archive ingest, the
   * partial-timing tail and continuing live polls all process each point
   * exactly once. Captures the build + lap map locally: a superseded load that
   * is still mid-yield can only write into orphaned objects.
   */
  private async appendLapHistory(expectedLoadVersion = this.sessionLoadVersion): Promise<void> {
    const build = this.lapBuild
    const laps = this.lapsByDriver
    const points = this.timingPoints
    const appPoints = this.appPoints
    let sinceYield = 0

    while (build.processedTiming < points.length) {
      const point = points[build.processedTiming]
      // Keep tyre state in step by time for the compound stamp.
      while (build.appIndex < appPoints.length && appPoints[build.appIndex].t <= point.t) {
        build.app = deepMergeF1(build.app, appPoints[build.appIndex].d)
        build.appIndex += 1
      }
      build.timing = deepMergeF1(build.timing, point.d)
      const part = qualifyingPartAt(build.timing)
      if (part != null && part !== build.previousPart) {
        build.qualifyingParts.push({ t: point.t, part })
        build.previousPart = part
      }

      const lines = rec(rec(build.timing).Lines)
      if (!build.foundInitialTiming && Object.keys(lines).some((key) => /^\d+$/.test(key))) {
        build.initialClock = point.t
        build.foundInitialTiming = true
      }
      const appLines = rec(rec(build.app).Lines)
      // A lap can only complete for a driver whose line is IN THIS PATCH —
      // scanning every merged line for every point multiplies the dominant
      // preprocessing cost by the field size for nothing. The values are still
      // read from the MERGED line, since a patch may carry NumberOfLaps while
      // the lap time/sectors arrived in earlier patches.
      const patchLines = rec(rec(point.d).Lines)
      for (const key of Object.keys(patchLines)) {
        if (!/^\d+$/.test(key)) continue
        const line = rec(lines[key])
        const lapCount = num(line.NumberOfLaps)
        if (lapCount == null) continue
        const dn = +key
        const prev = build.prevLaps.get(dn) ?? 0
        if (lapCount > prev) {
          build.prevLaps.set(dn, lapCount)
          const last = rec(line.LastLapTime)
          const sectors = indexedToArray(line.Sectors)
          const arr = laps.get(dn) ?? []
          arr.push({
            driverNumber: dn,
            lapNumber: lapCount,
            lapTime: parseLapTime(last.Value),
            sector1: parseLapTime(rec(sectors[0]).Value),
            sector2: parseLapTime(rec(sectors[1]).Value),
            sector3: parseLapTime(rec(sectors[2]).Value),
            compound: currentStint(appLines[key]).compound,
            tComplete: point.t
          })
          laps.set(dn, arr)
        }
      }
      build.processedTiming += 1
      if (++sinceYield >= PRECOMPUTE_YIELD_EVERY) {
        sinceYield = 0
        await yieldToRenderer()
        if (expectedLoadVersion !== this.sessionLoadVersion) return
      }
    }
  }

  // ── ERS estimate (2026 ~50%-electric power unit) ────────────────────────────
  //
  // The public F1 feed exposes throttle/brake/speed/aero but NOT battery state.
  // We derive a labelled ESTIMATE via the shared, unit-tested `ErsEstimator`
  // engine (harvest under braking, deploy under power, mean-reverting to a
  // working window), computed once in a forward pass and decimated for lookup.
  // energyIsEstimate is always set; values are absent entirely without CarData.

  /**
   * Integrate one chronological batch of CarData into the decimated ERS
   * timeline. Called with the full array at ingest (live payloads) and with
   * each streamed chunk during archive enrichment — same math either way.
   */
  private async integrateErsBatch(
    points: F1StreamPoint[],
    expectedLoadVersion: number
  ): Promise<void> {
    // Capture both so a superseded load can only ever write into orphans.
    const build = this.ersBuild
    const target = this.ersPoints

    for (let pointIndex = 0; pointIndex < points.length; pointIndex++) {
      const point = points[pointIndex]
      for (const e of indexedToArray(rec(point.d).Entries)) {
        const cars = rec(rec(e).Cars)
        for (const [key, carRaw] of Object.entries(cars)) {
          if (!/^\d+$/.test(key)) continue
          const dn = +key
          const ch = rec(rec(carRaw).Channels)
          const sample: ErsTelemetrySample = {
            throttle: num(ch[CAR_CHANNELS.throttle]),
            speed: num(ch[CAR_CHANNELS.speed]),
            brake: num(ch[CAR_CHANNELS.brake]),
            aeroChannel: num(ch[CAR_CHANNELS.drs])
          }
          const dt = point.t - (build.lastT.get(dn) ?? point.t) // integrateErs clamps this
          build.lastT.set(dn, point.t)
          build.states.set(dn, integrateErs(build.states.get(dn) ?? initErsState(), sample, dt))
          build.lastSample.set(dn, sample)
        }
      }
      // Emit a decimated snapshot of everyone's estimate (SoC + inferred mode).
      const yieldDue = pointIndex > 0 && pointIndex % PRECOMPUTE_YIELD_EVERY === 0
      if (point.t - build.lastEmit >= ERS_EMIT_DT) {
        build.lastEmit = point.t
        const byDriver: Record<number, ErsEstimate> = {}
        for (const [dn, st] of build.states) {
          byDriver[dn] = computeErsEstimate(st, build.lastSample.get(dn) ?? null)
        }
        target.push({ t: point.t, byDriver })
      }
      if (yieldDue) {
        await yieldToRenderer()
        if (expectedLoadVersion !== this.sessionLoadVersion) return
      }
    }
  }

  /** Attach the ERS estimate to each timing entry at session time `clock`. */
  private attachErs(timing: TimingEntry[], clock: number): void {
    if (this.ersPoints.length === 0) return
    const point = nearestAtOrBefore(this.ersPoints, clock, (p) => p.t)
    if (!point) return
    for (const e of timing) {
      const est = point.byDriver[e.driverNumber]
      if (!est || est.energyPct == null) continue
      e.energyPct = est.energyPct
      // Overtake Mode is distinct from Boost and is only available when the car
      // is within one second at detection. Timing gives us an honest eligibility
      // signal; the public feed does not expose the driver's button press.
      e.deployMode = applyOvertakeEligibility(est.deployMode, e.intervalAhead)
      e.energyIsEstimate = true
    }
  }
}

/** Decimation spacing (s) for the ERS lookup timeline (~1.5s ≈ display cadence). */
const ERS_EMIT_DT = 1.5

// ── local helpers ────────────────────────────────────────────────────────────────

interface ErsBuild {
  states: Map<number, ErsDriverState>
  lastSample: Map<number, ErsTelemetrySample>
  lastT: Map<number, number>
  lastEmit: number
}

function newErsBuild(): ErsBuild {
  return { states: new Map(), lastSample: new Map(), lastT: new Map(), lastEmit: -Infinity }
}

/** Rolling forward-scan state for the lap-history/qualifying extraction. */
interface LapBuild {
  timing: unknown
  app: unknown
  appIndex: number
  processedTiming: number
  prevLaps: Map<number, number>
  qualifyingParts: { t: number; part: 1 | 2 | 3 }[]
  previousPart: 1 | 2 | 3 | null
  foundInitialTiming: boolean
  initialClock: number
}

function newLapBuild(): LapBuild {
  return {
    timing: {},
    app: {},
    appIndex: 0,
    processedTiming: 0,
    prevLaps: new Map(),
    qualifyingParts: [],
    previousPart: null,
    foundInitialTiming: false,
    initialClock: 0
  }
}

interface DriverBuild {
  state: unknown
  processed: number
}

function newDriverBuild(): DriverBuild {
  return { state: {}, processed: 0 }
}

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
}
function num(v: unknown): number | null {
  if (typeof v === 'number') return isFinite(v) ? v : null
  if (typeof v === 'string' && v.trim()) {
    const n = parseFloat(v)
    return isFinite(n) ? n : null
  }
  return null
}

function hasUsableCarData(points: F1StreamPoint[]): boolean {
  for (const point of points) {
    for (const entry of indexedToArray(rec(point.d).Entries)) {
      if (Object.keys(rec(rec(entry).Cars)).some((key) => /^\d+$/.test(key))) return true
    }
  }
  return false
}
function mapType(type: string): SessionInfo['type'] {
  const s = type.toLowerCase()
  if (s.includes('sprint') && s.includes('qual')) return 'sprint-qualifying'
  if (s.includes('sprint')) return 'sprint'
  if (s.includes('qual')) return 'qualifying'
  if (s.includes('practice')) return 'practice'
  if (s.includes('race')) return 'race'
  return 'unknown'
}
