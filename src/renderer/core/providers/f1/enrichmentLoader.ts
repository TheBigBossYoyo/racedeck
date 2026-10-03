import type { F1StreamPoint } from '@shared/f1live'
import { bridge } from '@renderer/lib/ipc'
import type { EnrichmentFeedProgress, EnrichmentProgress } from '../types'
import { yieldToRenderer } from './scheduler'

const ENRICHMENT_CHUNK_LIMIT = 500 // matches the main-process hard maximum
const ENRICHMENT_EARLY_CHUNK_LIMIT = 250 // finer early Position chunks → earlier closed-lap checks
const ENRICHMENT_EARLY_CHUNK_WINDOW = 1_000 // points; covers a formation lap + first racing lap

export type EnrichmentFeed = 'position' | 'carData'

/**
 * What the loader needs from the provider. Everything the chunks are applied to
 * stays provider state; the loader only decides when to request the next chunk,
 * and tracks per-feed progress. Moved from F1LiveProvider.ts.
 */
export interface EnrichmentHost {
  /** Current session-load generation; a superseded load must stop touching state. */
  loadVersion(): number
  sessionId(): string | undefined
  positionsPublished(): boolean
  /** Session duration (s) as currently known, for `totalSeconds`. */
  duration(): number
  /** How many TimingData points are held; the tail resumes from there. */
  timingPointCount(): number
  /** Append a timing chunk and preprocess it (feed quality, lap history). */
  appendTiming(points: F1StreamPoint[], loadVersion: number): Promise<void>
  /** The whole timing tail has landed: publish it as complete. */
  completeTiming(duration: number): void
  appendPosition(points: F1StreamPoint[], done: boolean, duration: number): void
  appendCarData(
    points: F1StreamPoint[],
    done: boolean,
    duration: number,
    loadVersion: number
  ): Promise<void>
  /** Record why a feed was abandoned (diagnostics). */
  recordIssue(issue: { feed: EnrichmentFeed; message: string }): void
  /** Announce a progress change; `force` bypasses the provider's throttle. */
  notify(force: boolean): void
}

/** The chunked Position/CarData download that follows an archive session's core load. */
export class EnrichmentLoader {
  /** Live progress of the chunked Position/CarData load; null when none is running. */
  private enrichment: {
    position: EnrichmentFeedProgress
    carData: EnrichmentFeedProgress
  } | null = null

  constructor(private readonly host: EnrichmentHost) {}

  /** Forget any progress (fresh session, or the load was cancelled). */
  reset(): void {
    this.enrichment = null
  }

  progress(): EnrichmentProgress | null {
    if (!this.enrichment) return null
    const duration = this.host.duration()
    return { ...this.enrichment, totalSeconds: duration > 0 ? duration : null }
  }

  private failFeed(feed: EnrichmentFeed, loadVersion: number): void {
    this.setFeed(feed, loadVersion, { state: 'failed' })
    if (loadVersion === this.host.loadVersion()) this.host.notify(true)
  }

  /** Record one feed's state; a superseded load must not touch the next session's. */
  private setFeed(
    feed: EnrichmentFeed,
    loadVersion: number,
    patch: Partial<EnrichmentFeedProgress>
  ): void {
    if (!this.enrichment || loadVersion !== this.host.loadVersion()) return
    this.enrichment = { ...this.enrichment, [feed]: { ...this.enrichment[feed], ...patch } }
  }

  /** Pull the still-downloading TimingData tail and preprocess it as it lands. */
  async streamCoreTiming(sessionId: string, loadVersion: number): Promise<void> {
    let offset = this.host.timingPointCount()
    let duration = this.host.duration()
    for (;;) {
      const chunk = await bridge().f1.loadSessionEnrichment({
        path: sessionId,
        feed: 'timing',
        carDataOffset: 0,
        positionOffset: 0,
        timingOffset: offset,
        limit: ENRICHMENT_CHUNK_LIMIT
      })
      if (loadVersion !== this.host.loadVersion() || this.host.sessionId() !== sessionId) {
        throw new Error('F1 session load was superseded.')
      }
      const points = chunk.timing ?? []
      offset = chunk.nextTimingOffset ?? offset + points.length
      duration = Math.max(duration, chunk.duration)
      if (points.length > 0) {
        await this.host.appendTiming(points, loadVersion)
        if (loadVersion !== this.host.loadVersion())
          throw new Error('F1 session load was superseded.')
      }
      if (chunk.done) break
      await yieldToRenderer()
      if (loadVersion !== this.host.loadVersion() || this.host.sessionId() !== sessionId) {
        throw new Error('F1 session load was superseded.')
      }
    }
    this.host.completeTiming(duration)
  }

  async load(sessionId: string, loadVersion: number): Promise<void> {
    // Ordering guarantee: the map always publishes before telemetry STARTS.
    // Once it has, CarData streams concurrently with the Position tail — the
    // tail is only needed for scrubbing ahead, so telemetry no longer waits for
    // the whole Position download.
    if (loadVersion === this.host.loadVersion()) {
      const waiting: EnrichmentFeedProgress = {
        state: 'pending',
        pointsApplied: 0,
        coveredSeconds: null
      }
      this.enrichment = { position: waiting, carData: waiting }
    }
    let carDataStream: Promise<void> | null = null
    const startCarData = (): void => {
      if (carDataStream) return
      carDataStream = this.streamFeed(sessionId, loadVersion, 'carData').catch((e: unknown) => {
        // Telemetry is optional; core timing and the map remain fully usable.
        // Still recorded (APP_IMPROVEMENT_ROADMAP.md P2 item 32/28) so a
        // silent degrade is visible in diagnostics instead of reading as a freeze.
        this.host.recordIssue({
          feed: 'carData',
          message: e instanceof Error ? e.message : 'Unknown error'
        })
        this.failFeed('carData', loadVersion)
      })
    }
    try {
      await this.streamFeed(sessionId, loadVersion, 'position', () => {
        if (this.host.positionsPublished()) startCarData()
      })
    } catch (e) {
      // Position is optional; telemetry can still enrich the timing session.
      this.host.recordIssue({
        feed: 'position',
        message: e instanceof Error ? e.message : 'Unknown error'
      })
      this.failFeed('position', loadVersion)
    }
    if (loadVersion !== this.host.loadVersion() || this.host.sessionId() !== sessionId) return
    startCarData()
    await carDataStream
  }

  /**
   * Pull one high-rate feed chunk-by-chunk and APPLY each chunk as it arrives.
   * The main process serves chunks while the `.z` file is still downloading, so
   * the map (and then telemetry) become usable at the replay start long before
   * the feed's tail exists locally.
   */
  private async streamFeed(
    sessionId: string,
    loadVersion: number,
    feed: EnrichmentFeed,
    onApplied?: () => void
  ): Promise<void> {
    let offset = 0
    let duration = 0
    this.setFeed(feed, loadVersion, { state: 'loading' })
    for (;;) {
      // Position starts with finer chunks so the closed-lap check (and hence the
      // map) can trigger as early in the download as possible.
      const limit =
        feed === 'position' &&
        !this.host.positionsPublished() &&
        offset < ENRICHMENT_EARLY_CHUNK_WINDOW
          ? ENRICHMENT_EARLY_CHUNK_LIMIT
          : ENRICHMENT_CHUNK_LIMIT
      const chunk = await bridge().f1.loadSessionEnrichment({
        path: sessionId,
        feed,
        carDataOffset: feed === 'carData' ? offset : 0,
        positionOffset: feed === 'position' ? offset : 0,
        limit
      })
      if (loadVersion !== this.host.loadVersion() || this.host.sessionId() !== sessionId) return
      const points = feed === 'position' ? chunk.position : chunk.carData
      offset = feed === 'position' ? chunk.nextPositionOffset : chunk.nextCarDataOffset
      duration = Math.max(duration, chunk.duration)
      // Recorded before the append so the change notification it fires already
      // carries this chunk's progress.
      this.setFeed(feed, loadVersion, {
        pointsApplied: offset,
        ...(points.length > 0 ? { coveredSeconds: points[points.length - 1].t } : {})
      })
      if (feed === 'position') this.host.appendPosition(points, chunk.done, duration)
      else await this.host.appendCarData(points, chunk.done, duration, loadVersion)
      if (loadVersion !== this.host.loadVersion()) return
      if (chunk.done) {
        // Marked complete only once the chunk is fully applied (telemetry
        // integrates asynchronously), then announced so the UI drops the entry.
        this.setFeed(feed, loadVersion, { state: 'done' })
        this.host.notify(true)
      }
      onApplied?.()
      if (chunk.done) return
      await yieldToRenderer()
      if (loadVersion !== this.host.loadVersion() || this.host.sessionId() !== sessionId) return
    }
  }
}
