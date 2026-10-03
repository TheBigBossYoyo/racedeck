import type {
  Driver,
  LapSample,
  SessionInfo,
  TelemetrySample
} from '@shared/models'
import { clamp } from '@renderer/lib/utils'
import { hasBridge, bridge } from '@renderer/lib/ipc'
import {
  deepMergeF1,
  LIVE_CAPPED_TOPICS,
  LIVE_HIGH_RATE_RETENTION,
  parseSessionClock,
  sessionClockRemainingAt,
  type F1SessionData,
  type F1LiveDataDelta,
  type F1StreamPoint,
  type SessionClockPoint
} from '@shared/f1live'
import type {
  DataProvider,
  ProviderCapabilities,
  ProviderDiagnostics,
  RaceSnapshot,
  SessionTimeline
} from './types'
import { nearestAtOrBefore } from './normalize'
import {
  debugTrackTraceInfo,
  collectRaceControl,
  lapCountAt,
  lapRecordToSample,
  buildTiming,
  normalizeDrivers,
  normalizeSessionInfo,
  positionAvailability,
  buildLapPositions,
  buildSessionBests,
  collectPitLaneTimes,
  collectTeamRadio,
  buildCurrentTyres,
  applyCurrentTyres,
  buildTyreStintHistory,
  mergeTopThreeDrivers,
  latestTrackMessage,
  qualifyingPartAt,
  trackStatusAt,
  weatherAt,
  type LapRecord
} from './f1normalize'
import { DRIVER_FEED_TOPICS, DriverFeedTracker } from './DriverFeedTracker'
import { FeedQualityTracker } from './f1/FeedQualityTracker'
import { renderScheduler, yieldToRenderer } from './f1/scheduler'
import {
  TRACK_PATH_CACHE_SCHEMA_VERSION,
  TrackPathCache,
  type TrackPathCacheStorage
} from './f1/trackPathCache'
import { persistTrackPathStorage, saveBoundedTrackPath } from './f1/persistTrackPathStorage'
import { TrackOutline } from './f1/trackOutline'
import { PitLapIndexCache } from './f1/pitLapIndexCache'
import { positionsAt } from './f1/positions'
import { appendToStream, computeFeedFreshness, stampFeedFreshness } from './f1/liveStreams'
import {
  CHECKPOINT_INTERVAL_SEC,
  MAX_CHECKPOINTS,
  ReplayView,
  advanceView,
  type MergeCheckpoint
} from './f1/replay'
import { attachErs, integrateErsBatch, newErsBuild, trimErsPoints, type ErsPoint } from './f1/ers'
import { appendLapHistory, newDriverBuild, newLapBuild } from './f1/lapHistory'
import { buildSessionTimeline, deriveTotalLaps } from './f1/sessionTimeline'
import { hasUsableCarData, telemetryWindow } from './f1/carData'
import { listF1Sessions } from './f1/sessionList'
import { isSessionDataLive } from './f1/sessionLive'
import { weatherHistoryUpTo } from './f1/weatherHistory'
import { EnrichmentLoader } from './f1/enrichmentLoader'

// Live in ./f1/*; re-exported so importers keep reaching them through this module.
export { TRACK_PATH_CACHE_SCHEMA_VERSION, saveBoundedTrackPath, renderScheduler }

const ENRICHMENT_NOTIFY_MIN_MS = 300 // bound snapshot fan-out while chunks stream in

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
  private pitLapIndexCache = new PitLapIndexCache()
  private teamRadioPoints: F1StreamPoint[] = []
  private currentTyrePoints: F1StreamPoint[] = []
  private tyreStintSeriesPoints: F1StreamPoint[] = []
  private tlaRcmPoints: F1StreamPoint[] = []
  private positionPoints: F1StreamPoint[] = []
  private carDataPoints: F1StreamPoint[] = []
  private sessionClockPoints: SessionClockPoint[] = []

  private lapsByDriver = new Map<number, LapRecord[]>()
  private totalLaps: number | null = null
  /**
   * The circuit outline and the state that decides when it may change (a closed
   * trace is final for the session). Replaced wholesale at a fresh session.
   */
  private outline = new TrackOutline()
  /** Whether the outline has been proven to be a complete lap. */
  private get trackPathClosed(): boolean {
    return this.outline.closed
  }
  /**
   * Stream arrays this provider has copied and therefore owns, so later live
   * deltas can be appended in place. An array that arrived from the socket (or a
   * caller) is never mutated: the first append copies it, once.
   */
  private ownedStreams = new WeakSet<F1StreamPoint[]>()
  private timelineCache: SessionTimeline | null = null
  private sessionLoadVersion = 0
  private updateListeners = new Set<() => void>()
  private liveCursors: Record<string, number> = {}
  private liveGeneration = 0
  /**
   * Wall-clock ms (`Date.now()`) each raw feed topic last received new points,
   * for LIVE-session stale-feed detection (roadmap P0 item 5). Only stamped
   * while polling `live`; cleared whenever a non-live session loads.
   */
  private feedLastWallClockMs: Record<string, number> = {}
  /** Per-driver counterpart of `feedLastWallClockMs`; live only, reset with it. */
  private driverFeeds = new DriverFeedTracker()
  /** Feed shape anomaly counts (diagnostic only; never alters the data). */
  private feedQuality = new FeedQualityTracker()
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
  private ersPoints: ErsPoint[] = []

  /** Diagnostics (APP_IMPROVEMENT_ROADMAP.md P2 item 32) — set during loadSession/enrichment. */
  private trackPathCacheStatus: 'hit' | 'miss' | 'unavailable' = 'unavailable'
  private readonly trackPathCache: TrackPathCache
  private enrichmentIssue: { feed: 'position' | 'carData'; message: string } | null = null
  /** The chunked Position/CarData download and its progress; chunks apply to this provider. */
  private enrichment = new EnrichmentLoader({
    loadVersion: () => this.sessionLoadVersion,
    sessionId: () => this.session?.id,
    positionsPublished: () => this.positionsPublished,
    duration: () => this.getDuration(),
    timingPointCount: () => this.timingPoints.length,
    appendTiming: async (points, loadVersion) => {
      this.feedQuality.observe('TimingData', points)
      this.timingPoints.push(...points)
      await this.appendLapHistory(loadVersion)
    },
    completeTiming: (duration) => {
      this.publishStream('TimingData', this.timingPoints, duration, { partialTiming: false })
      this.timelineCache = this.buildSessionTimeline(this.lapBuild.qualifyingParts)
    },
    appendPosition: (points, done, duration) => this.appendPositionPoints(points, done, duration),
    appendCarData: (points, done, duration, loadVersion) =>
      this.appendCarDataPoints(points, done, duration, loadVersion),
    recordIssue: (issue) => {
      this.enrichmentIssue = issue
    },
    notify: (force) => this.notifyEnrichmentProgress(force)
  })

  /** Rolling ERS integration state, so telemetry batches integrate as they stream. */
  private ersBuild = newErsBuild()

  /**
   * Two independent replay cursors over the same immutable feed. The playhead
   * advances a little each tick; `wholeSession` answers end-of-session requests
   * (bookmarks, exports, the sync engine's race-control history). Sharing one
   * cursor made each of those requests drag it to the end, so the next tick paid
   * a full re-merge and the two callers overwrote each other's memos.
   */
  private playhead = new ReplayView()
  private wholeSession = new ReplayView()
  /** Merged-state snapshots at ascending session times, shared by both cursors. */
  private checkpoints: MergeCheckpoint[] = []
  private checkpointIntervalSec = CHECKPOINT_INTERVAL_SEC
  private maxCheckpoints = MAX_CHECKPOINTS

  /** The playhead's cursor time — kept across continuing live polls. */
  private get cursorT(): number {
    return this.playhead.cursorT
  }

  /** Drop everything derived from the previous session's feeds (fresh-session boundary). */
  private resetFeedMemos(): void {
    this.playhead.resetDerived()
    this.wholeSession.resetDerived()
  }

  /** A superseded load must stop before it touches the next session's state. */
  private assertCurrent(loadVersion: number): void {
    if (loadVersion !== this.sessionLoadVersion) throw new Error('F1 session load was superseded.')
  }

  /**
   * `trackPathStorage` is injected by `DataProviderManager`; it defaults to the persisted
   * store so a bare `new F1LiveProvider()` keeps caching outlines as it always has.
   */
  constructor(options: { trackPathStorage?: TrackPathCacheStorage } = {}) {
    this.trackPathCache = new TrackPathCache(options.trackPathStorage ?? persistTrackPathStorage)
  }

  listSessions(): Promise<SessionInfo[]> {
    return listF1Sessions()
  }

  async loadSession(sessionId: string): Promise<SessionInfo> {
    const loadVersion = ++this.sessionLoadVersion
    if (!hasBridge()) throw new Error('F1 Live Timing requires the desktop app.')
    if (sessionId !== 'live') {
      // Returning to this socket later must request a fresh full state, even if
      // the underlying connection generation did not change while viewing replay.
      this.liveCursors = {}
      this.liveGeneration = 0
      // A replay's clock isn't wall-clock time, so stale live timestamps must
      // not leak into (or persist stale into) a later live view.
      this.feedLastWallClockMs = {}
      this.driverFeeds.reset()
    }
    // `live` pulls the accumulated real-time buffer; otherwise the archive.
    let data: F1SessionData | null
    let continuing = false
    let cachedTrackPath: Promise<{ x: number; y: number }[] | null> | null = null
    if (sessionId === 'live') {
      const delta = await bridge().f1.getLive(this.liveCursors, this.liveGeneration)
      this.assertCurrent(loadVersion)
      const merged = this.mergeLiveDelta(delta)
      data = merged.data
      continuing = merged.continuing
      // First poll of a live session: the feed names its own weekend, so an
      // outline traced during an earlier session at this circuit can seed the
      // map now instead of waiting for a car to complete a lap on the feed.
      if (data && !continuing) {
        cachedTrackPath = this.trackPathCache.load(sessionId, data.summary.feedPath)
      }
    } else {
      cachedTrackPath = this.trackPathCache.load(sessionId)
      data = await bridge().f1.loadSession(sessionId)
      this.assertCurrent(loadVersion)
      this.feedQuality.reset()
      if (data) this.feedQuality.observeStreams(data.streams)
    }
    if (!data) throw new Error('Not connected to F1 live timing yet — sign in and connect first.')
    const session = await this.ingest(data, loadVersion, continuing)
    this.assertCurrent(loadVersion)
    if (cachedTrackPath) {
      // A previous session of this race weekend already proved the circuit
      // outline (one meeting = one layout). Reusing it lets the map publish
      // with the FIRST position chunk instead of waiting for a closed lap.
      const cached = await cachedTrackPath
      this.assertCurrent(loadVersion)
      if (cached && !this.trackPathClosed) {
        this.outline.seed(cached)
        this.trackPathCacheStatus = 'hit'
      } else if (!cached) {
        this.trackPathCacheStatus = 'miss'
      }
      this.publishPositionsIfReady(false)
    }
    if (sessionId !== 'live' && data.partialTiming) {
      // The timing tail is still downloading: stream and preprocess it before
      // the session counts as loaded, so "loaded" still means fully scrubable.
      await this.enrichment.streamCoreTiming(sessionId, loadVersion)
      this.assertCurrent(loadVersion)
    }
    if (sessionId !== 'live') void this.enrichment.load(sessionId, loadVersion)
    return session
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

  /** Adopt the best circuit outline the positions so far allow; true if it changed. */
  private adoptTrackPath(allowOpenFallback: boolean, force = false): boolean {
    return this.outline.adopt(this.positionPoints, allowOpenFallback, force, (path) =>
      this.trackPathCache.save(this.session?.id, this.currentFeedPath(), path)
    )
  }

  private publishPositionsIfReady(allowOpenFallback: boolean): boolean {
    if (this.positionsPublished || this.positionPoints.length === 0) return false
    if (this.outline.path.length === 0 && !allowOpenFallback) return false
    this.positionsPublished = true
    return true
  }

  /**
   * Bound the two high-rate feeds the renderer accumulates across live polls.
   *
   * The socket already caps its own buffers, but it caps what it HOLDS, not what
   * it has ever sent: the renderer stitches every delta onto the end of its own
   * array, so a connection left open across a whole race weekend day kept
   * growing after the socket had started discarding. Retaining the same window
   * the socket does keeps the renderer's footprint bounded by the same rule, and
   * discards the same points the socket has already let go of.
   *
   * `ersProcessed` indexes into `carDataPoints`, so it moves with the trim —
   * otherwise the ERS integrator would skip exactly the discarded points'
   * worth of new telemetry.
   *
   * Trims `points` in place: the caller owns it (see `appendToStream`).
   */
  private trimHighRateStream(topic: string, points: F1StreamPoint[]): void {
    if (points.length <= LIVE_HIGH_RATE_RETENTION) return
    const dropped = points.length - LIVE_HIGH_RATE_RETENTION
    points.splice(0, dropped)
    if (topic === 'CarData') {
      this.ersProcessed = Math.max(0, this.ersProcessed - dropped)
      trimErsPoints(this.ersPoints, points[0]?.t ?? Number.POSITIVE_INFINITY)
    }
  }

  private mergeLiveDelta(delta: F1LiveDataDelta | null): {
    data: F1SessionData | null
    continuing: boolean
  } {
    if (!delta) return { data: null, continuing: false }
    const continuing =
      this.session?.id === 'live' && this.data != null && this.liveGeneration === delta.generation
    this.liveCursors = delta.cursors
    this.liveGeneration = delta.generation
    // `delta.streams` is either just-arrived new points (continuing) or the
    // full current buffer (first poll) — either way, every topic present here
    // just became current as of now.
    stampFeedFreshness(this.feedLastWallClockMs, delta.streams)
    // A full buffer (first poll / new socket generation) replaces what was
    // known; an increment only extends it.
    if (!continuing) {
      this.driverFeeds.reset()
      this.feedQuality.reset()
    }
    this.feedQuality.observeStreams(delta.streams)
    for (const topic of DRIVER_FEED_TOPICS) {
      const points = delta.streams[topic]
      if (points) this.driverFeeds.observe(topic, points, false)
    }
    if (!continuing || !this.data) return { data: delta, continuing: false }
    const streams = { ...this.data.streams }
    for (const [topic, points] of Object.entries(delta.streams)) {
      const grown = appendToStream(this.ownedStreams, streams[topic], points)
      if (LIVE_CAPPED_TOPICS.has(topic)) this.trimHighRateStream(topic, grown)
      streams[topic] = grown
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

  onUpdate(listener: () => void): () => void {
    this.updateListeners.add(listener)
    return () => this.updateListeners.delete(listener)
  }

  cancelPendingLoads(): void {
    this.sessionLoadVersion++
    // The superseded stream loops stop without reporting, so nothing else would
    // ever move their feeds out of `loading`.
    this.enrichment.reset()
  }

  getDiagnostics(): ProviderDiagnostics {
    const trace = debugTrackTraceInfo(
      this.positionPoints,
      this.outline.updateReferenceDriver(this.positionPoints)
    )
    return {
      trackPathCacheStatus: this.trackPathCacheStatus,
      cacheSchemaVersion: TRACK_PATH_CACHE_SCHEMA_VERSION,
      enrichmentProcessedPoints: this.ersProcessed,
      enrichmentIssue: this.enrichmentIssue
        ? `${this.enrichmentIssue.feed}: ${this.enrichmentIssue.message}`
        : null,
      enrichmentProgress: this.enrichment.progress(),
      trackRawPointCount: trace.rawPointCount,
      trackReferenceDriver: trace.referenceDriver,
      trackOpenTraceLength: trace.openTraceLength,
      trackAdoptedLength: this.outline.path.length,
      trackPathClosed: this.outline.closed,
      feedQuality: this.feedQuality.report()
    }
  }

  private appendPositionPoints(points: F1StreamPoint[], done: boolean, duration: number): void {
    if (points.length > 0) {
      this.feedQuality.observe('Position', points)
      this.positionPoints.push(...points)
    }
    // The final chunk is the last chance to close the outline, so it is never throttled.
    const gainedOutline = this.adoptTrackPath(done, done)
    // Markers publish as soon as there is an outline to place them on — or,
    // once the whole feed is in, even without one.
    let justPublished = this.publishPositionsIfReady(done)
    justPublished ||= gainedOutline
    if (done) this.publishStream('Position', this.positionPoints, duration)
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
    if (done) this.publishStream('CarData', this.carDataPoints, duration)
    this.notifyEnrichmentProgress(done)
  }

  /** Fold a fully downloaded feed (and any longer duration) back into `data`. */
  private publishStream(
    topic: string,
    points: F1StreamPoint[],
    duration: number,
    extra: Partial<F1SessionData> = {}
  ): void {
    if (!this.data) return
    this.data = {
      ...this.data,
      duration: Math.max(this.data.duration, duration),
      streams: { ...this.data.streams, [topic]: points },
      ...extra
    }
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
    this.assertCurrent(expectedLoadVersion)
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
    this.tyreStintSeriesPoints = s.TyreStintSeries ?? []
    this.tlaRcmPoints = s.TlaRcm ?? []
    this.positionPoints = s.Position ?? []
    this.carDataPoints = s.CarData ?? []
    this.sessionClockPoints = parseSessionClock(s.ExtrapolatedClock ?? [])
    this.lastEnrichmentNotifyAt = 0
    if (!continuing) {
      // Fresh session: REPLACE (not clear) the rolling builds so a superseded
      // load that is still mid-yield can only ever write into orphans.
      this.lapBuild = newLapBuild()
      this.driverBuild = newDriverBuild()
      this.lapsByDriver = new Map()
      this.outline = new TrackOutline()
      this.pitLapIndexCache = new PitLapIndexCache()
      this.positionsPublished = false
      this.resetFeedMemos()
      this.ersBuild = newErsBuild()
      this.ersPoints = []
      this.ersProcessed = 0
      this.trackPathCacheStatus = 'unavailable'
      this.enrichmentIssue = null
      this.enrichment.reset()
      this.telemetryAvailable = hasUsableCarData(this.carDataPoints)
    } else if (!this.telemetryAvailable) {
      this.telemetryAvailable = hasUsableCarData(this.carDataPoints.slice(this.ersProcessed))
    }

    // Drivers = the merged DriverList (near-static keyframe); only new points merge.
    const driverBuild = this.driverBuild
    const driverList = s.DriverList ?? []
    const driversProcessedBefore = driverBuild.processed
    while (driverBuild.processed < driverList.length) {
      driverBuild.state = deepMergeF1(driverBuild.state, driverList[driverBuild.processed].d)
      driverBuild.processed += 1
    }
    // Re-normalizing yields an equal but NEW array, which invalidated the drivers
    // memo and every downstream memo keyed on it on every poll. Only a DriverList
    // point actually merged (or a fresh session) can change the answer.
    if (!continuing || driverBuild.processed !== driversProcessedBefore) {
      this.drivers = normalizeDrivers(driverBuild.state)
    }

    this.totalLaps = deriveTotalLaps(this.lapCountPoints)
    if (this.session) {
      this.session.totalLaps = this.session.type === 'race' ? this.totalLaps : null
    }

    await yieldToRenderer()
    this.assertCurrent(expectedLoadVersion)
    await this.appendLapHistory(expectedLoadVersion)
    this.assertCurrent(expectedLoadVersion)
    this.timelineCache = this.buildSessionTimeline(this.lapBuild.qualifyingParts)
    await yieldToRenderer()
    this.assertCurrent(expectedLoadVersion)
    // Closure is still tried first and wins the moment it succeeds, live or
    // not (`TrackOutline.adopt`) — the open trace is only ever a placeholder for
    // whichever poll shows up before that happens, never cached, and only
    // adopted once it clears its minimum length.
    this.adoptTrackPath(true)
    this.publishPositionsIfReady(true)
    await yieldToRenderer()
    this.assertCurrent(expectedLoadVersion)
    const newCarData =
      this.ersProcessed > 0 ? this.carDataPoints.slice(this.ersProcessed) : this.carDataPoints
    this.ersProcessed = this.carDataPoints.length
    if (newCarData.length > 0) {
      await this.integrateErsBatch(newCarData, expectedLoadVersion)
      this.assertCurrent(expectedLoadVersion)
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
    const view = this.viewFor(clock)
    this.advanceTo(view, clock)

    const raceControl = view.memos.raceControl.read(this.raceControlPoints, clock, () =>
      collectRaceControl(this.raceControlPoints, clock)
    )
    // TopThree independently names the leading drivers, recovering identity for
    // anyone the DriverList keyframe hasn't described yet.
    const drivers = view.memos.drivers.read(
      this.topThreePoints,
      clock,
      () => mergeTopThreeDrivers(this.drivers, this.topThreePoints, clock),
      [this.drivers]
    )
    const timing = buildTiming(view.timing, view.app, drivers, raceControl)
    const currentTyres = view.memos.currentTyres.read(this.currentTyrePoints, clock, () =>
      buildCurrentTyres(this.currentTyrePoints, clock)
    )
    applyCurrentTyres(timing, currentTyres)
    attachErs(timing, clock, this.ersPoints, view.eligibleSinceClock)
    const weatherHistory = view.memos.weatherHistory.read(this.weatherPoints, clock, () =>
      weatherHistoryUpTo(this.weatherPoints, clock)
    )
    const weather = weatherAt(nearestAtOrBefore(this.weatherPoints, clock, (p) => p.t))
    const lc = lapCountAt(nearestAtOrBefore(this.lapCountPoints, clock, (p) => p.t))
    const trackStatus = trackStatusAt(nearestAtOrBefore(this.trackStatusPoints, clock, (p) => p.t))
    const feedPath = this.currentFeedPath()
    const positions = positionsAt(this.positionPoints, this.positionsPublished, clock, timing)
    const availablePositions = positionAvailability(positions)

    const maxLapNo = Math.max(0, ...timing.map((e) => e.lapNumber ?? 0)) || null
    const currentLap = this.session.type === 'race' ? (lc.current ?? maxLapNo) : null
    // Wall-clock ages exist only for a live session; a replay has nothing to be stale against.
    const feedFreshness =
      this.session.id === 'live' ? computeFeedFreshness(this.feedLastWallClockMs) : undefined

    return {
      session: this.session,
      drivers,
      timing,
      laps: view.lapsUpTo(clock, this.lapsByDriver, this.pitLapIndex()),
      stints: view.stintsWithTyres(view.stintsAtCurrentState(this.drivers), currentTyres),
      raceControl,
      weather,
      weatherHistory,
      positions,
      trackPath: this.outline.path,
      lapPositions: view.memos.lapPositions.read(this.lapSeriesPoints, clock, () =>
        buildLapPositions(this.lapSeriesPoints, clock)
      ),
      sessionBests: view.memos.sessionBests.read(this.timingStatsPoints, clock, () =>
        buildSessionBests(this.timingStatsPoints, clock)
      ),
      pitLaneTimes: view.memos.pitLaneTimes.read(this.pitLanePoints, clock, () =>
        collectPitLaneTimes(this.pitLanePoints, clock)
      ),
      teamRadio: view.memos.teamRadio.read(
        this.teamRadioPoints,
        clock,
        () => collectTeamRadio(this.teamRadioPoints, clock, feedPath),
        [feedPath]
      ),
      currentTyres,
      tyreStintHistory: view.memos.tyreStintHistory.read(this.tyreStintSeriesPoints, clock, () =>
        buildTyreStintHistory(this.tyreStintSeriesPoints, clock)
      ),
      feedFreshness,
      driverFreshness: feedFreshness ? this.driverFeeds.ages(feedFreshness) : undefined,
      trackMessage: view.memos.trackMessage.read(this.tlaRcmPoints, clock, () =>
        latestTrackMessage(this.tlaRcmPoints, clock)
      ),
      availability: {
        timing: timing.length > 0,
        laps: this.lapsByDriver.size > 0,
        stints: timing.some((entry) => entry.compound != null && entry.compound !== 'UNKNOWN'),
        intervals: timing.some((e) => typeof e.intervalAhead === 'number'),
        raceControl: this.raceControlPoints.length > 0,
        weather: this.weatherPoints.length > 0,
        positions: this.positionsPublished,
        positionProgress: availablePositions.positionProgress,
        telemetry: this.telemetryAvailable,
        live: isSessionDataLive(this.data)
      },
      clock,
      currentLap,
      totalLaps: this.totalLaps,
      trackStatus,
      qualifyingPart: qualifyingPartAt(view.timing),
      sessionClock: sessionClockRemainingAt(this.sessionClockPoints, clock)
    }
  }

  getDriverLaps(driverNumber: number): LapSample[] {
    const pitLaps = this.pitLapIndex()
    return (this.lapsByDriver.get(driverNumber) ?? []).map((r) => lapRecordToSample(r, pitLaps))
  }

  /** F1's own pit in-/out-lap statement, when the feed carries it (see `PitLapIndexCache`). */
  private pitLapIndex(): { in: Set<string>; out: Set<string> } | undefined {
    return this.pitLapIndexCache.get(this.pitLanePoints)
  }

  getTimeline(): SessionTimeline {
    if (this.timelineCache) return this.timelineCache
    return this.buildSessionTimeline([])
  }

  private buildSessionTimeline(qualifyingParts: { t: number; part: 1 | 2 | 3 }[]): SessionTimeline {
    return buildSessionTimeline(
      {
        trackStatusPoints: this.trackStatusPoints,
        lapCountPoints: this.lapCountPoints,
        raceControlPoints: this.raceControlPoints,
        duration: this.getDuration(),
        type: this.session?.type ?? 'unknown'
      },
      qualifyingParts
    )
  }

  getTelemetry(driverNumber: number, t: number, windowSec = 8): TelemetrySample[] {
    return telemetryWindow(this.carDataPoints, driverNumber, t, windowSec)
  }

  // ── reconstruction internals ────────────────────────────────────────────────

  private resetCursor(): void {
    this.playhead.resetCursor()
    this.wholeSession.resetCursor()
    this.checkpoints = []
  }

  /**
   * A request at (or past) the end of the session is a whole-session read; it
   * gets its own cursor so it never drags the playhead's.
   */
  private viewFor(clock: number): ReplayView {
    const duration = this.getDuration()
    return duration > 0 && clock >= duration ? this.wholeSession : this.playhead
  }

  /** Move `view` to `clock` over the timing feeds (checkpoints: see `advanceView`). */
  private advanceTo(view: ReplayView, clock: number): void {
    advanceView(
      view,
      clock,
      this.checkpoints,
      { timingPoints: this.timingPoints, appPoints: this.appPoints },
      { intervalSec: this.checkpointIntervalSec, max: this.maxCheckpoints }
    )
  }

  private appendLapHistory(expectedLoadVersion = this.sessionLoadVersion): Promise<void> {
    return appendLapHistory(
      this.lapBuild,
      this.lapsByDriver,
      this.timingPoints,
      this.appPoints,
      () => expectedLoadVersion !== this.sessionLoadVersion
    )
  }

  private integrateErsBatch(points: F1StreamPoint[], expectedLoadVersion: number): Promise<void> {
    return integrateErsBatch(
      points,
      this.ersBuild,
      this.ersPoints,
      this.lapsByDriver,
      () => expectedLoadVersion !== this.sessionLoadVersion
    )
  }
}
