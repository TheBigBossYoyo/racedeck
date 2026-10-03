import type {
  CurrentTyre,
  Driver,
  DriverSessionBests,
  DriverTyreStintHistory,
  LapPositionSeries,
  LapSample,
  PitLaneTime,
  RaceControlMessage,
  Stint,
  TeamRadioClip,
  WeatherSample
} from '@shared/models'
import { deepMergeF1, type F1StreamPoint } from '@shared/f1live'
import { FeedMemo } from '../FeedMemo'
import { applyCurrentTyresToStints, buildStints, lapRecordToSample, type LapRecord } from '../f1normalize'

/**
 * The replay cursor machinery: merged-state checkpoints, the per-cursor caches
 * (`ReplayView`) and the forward/backward movement over the timing feeds. Moved
 * from F1LiveProvider.ts; the provider keeps the checkpoint list and policy as
 * its own fields and passes them in.
 */

/**
 * Session-time spacing (s) between merged-state checkpoints. A backward seek
 * restores the nearest earlier checkpoint and re-merges at most this much timing
 * data, instead of replaying the feed from t=0.
 */
export const CHECKPOINT_INTERVAL_SEC = 60
/**
 * Bound on retained checkpoints (each holds a copy of the merged timing state).
 * 240 covers four hours at the interval above; past it a seek still works, it
 * just restores the last checkpoint and merges forward from there.
 */
export const MAX_CHECKPOINTS = 240

/**
 * Merged TimingData/TimingAppData state at `t`: every point with `t' <= t` is
 * merged into `timing`/`app`, and `tIdx`/`aIdx` are how many of each that is.
 * Restoring one (copying the state — merging mutates it) is exactly equivalent
 * to replaying the feed from the start up to `t`.
 */
export interface MergeCheckpoint {
  t: number
  tIdx: number
  aIdx: number
  timing: unknown
  app: unknown
}

/** The feeds a cursor merges; read at call time, never captured. */
export interface ReplayFeeds {
  timingPoints: F1StreamPoint[]
  appPoints: F1StreamPoint[]
}

/** How densely, and for how long, checkpoints are kept. */
export interface CheckpointPolicy {
  intervalSec: number
  max: number
}

/**
 * One replay cursor over the timing feeds plus every cache that hangs off its
 * position. The provider keeps two (see `playhead` / `wholeSession`).
 */
export class ReplayView {
  cursorT = -1
  tIdx = 0
  aIdx = 0
  timing: unknown = {}
  app: unknown = {}
  /** Number of app points merged; equals `aIdx`, and keys the stint cache. */
  appStateVersion = 0
  stintCacheVersion = -1
  stintCache: Stint[] = []
  lapCacheKey = ''
  /** Pit-lap index the cached laps were flagged with; part of the cache's identity. */
  lapCachePitLaps: { in: Set<string>; out: Set<string> } | undefined
  lapCache: LapSample[] = []
  /** Last `CurrentTyres` gap-fill, keyed on both inputs' identity (see `stintsWithTyres`). */
  private gapFilledStints: { stints: Stint[]; tyres: CurrentTyre[]; result: Stint[] } | null = null
  /**
   * Clock at which each driver's Overtake eligibility most recently began.
   * Not a replayable timeline (see `ErsEstimator.eligibilityDurationSec`) —
   * just enough state to answer "how long has this held" during forward
   * playback, the normal way a session is watched. Survives seeks; cleared only
   * when a new session replaces the feeds.
   */
  eligibleSinceClock = new Map<number, number>()

  /**
   * One memo per whole-feed derivation in `getSnapshotAt`. Each of these used to
   * rescan (and mostly deep-merge) its entire stream on every snapshot, four
   * times a second, so their combined cost grew without bound as a session ran.
   * See FeedMemo for why the prefix length plus the last point is a sound key.
   */
  memos = newSnapshotMemos()

  /** Back to the start of the feeds (cursor state only; memos are keyed by data). */
  resetCursor(): void {
    this.cursorT = -1
    this.tIdx = 0
    this.aIdx = 0
    this.timing = {}
    this.app = {}
    this.appStateVersion = 0
    this.invalidateDerived()
  }

  /** Continue from a checkpoint; the checkpoint keeps its own copy of the state. */
  restore(checkpoint: MergeCheckpoint): void {
    this.cursorT = checkpoint.t
    this.tIdx = checkpoint.tIdx
    this.aIdx = checkpoint.aIdx
    this.timing = structuredClone(checkpoint.timing)
    this.app = structuredClone(checkpoint.app)
    this.appStateVersion = checkpoint.aIdx
    this.invalidateDerived()
  }

  /**
   * `applyCurrentTyresToStints` returns a new array whenever a gap-fill applies,
   * which would give `snapshot.stints` a new identity on every call and defeat
   * every stints-keyed cache downstream. Both inputs are themselves identity-stable
   * between changes (the stint cache per app-data version, `CurrentTyres` via its
   * FeedMemo), so the result is reusable for as long as neither is replaced.
   */
  stintsWithTyres(stints: Stint[], tyres: CurrentTyre[]): Stint[] {
    const last = this.gapFilledStints
    if (last && last.stints === stints && last.tyres === tyres) return last.result
    const result = applyCurrentTyresToStints(stints, tyres)
    this.gapFilledStints = { stints, tyres, result }
    return result
  }

  resetDerived(): void {
    this.memos = newSnapshotMemos()
    this.eligibleSinceClock = new Map()
    this.gapFilledStints = null
  }

  private invalidateDerived(): void {
    this.stintCacheVersion = -1
    this.stintCache = []
    this.lapCacheKey = ''
    this.lapCachePitLaps = undefined
    this.lapCache = []
    this.gapFilledStints = null
  }

  lapsUpTo(
    clock: number,
    lapsByDriver: Map<number, LapRecord[]>,
    pitLaps: { in: Set<string>; out: Set<string> } | undefined
  ): LapSample[] {
    const completedCounts: number[] = []
    for (const recs of lapsByDriver.values()) {
      let count = 0
      while (count < recs.length && recs[count].tComplete <= clock) count++
      completedCounts.push(count)
    }
    // Each sample's pit in-/out-lap flags come from the pit-lap index, which grows
    // when a pit entry arrives for an already-completed lap. Its identity is part
    // of the key so that entry is not hidden until some car next completes a lap.
    const cacheKey = completedCounts.join(',')
    if (cacheKey === this.lapCacheKey && pitLaps === this.lapCachePitLaps) return this.lapCache

    const out: LapSample[] = []
    for (const recs of lapsByDriver.values()) {
      for (const r of recs) {
        if (r.tComplete <= clock) out.push(lapRecordToSample(r, pitLaps))
      }
    }
    this.lapCacheKey = cacheKey
    this.lapCachePitLaps = pitLaps
    this.lapCache = out
    return this.lapCache
  }

  stintsAtCurrentState(drivers: Driver[]): Stint[] {
    if (this.stintCacheVersion !== this.appStateVersion) {
      this.stintCacheVersion = this.appStateVersion
      this.stintCache = buildStints(this.app, drivers)
    }
    return this.stintCache
  }
}

export function newSnapshotMemos() {
  return {
    raceControl: new FeedMemo<RaceControlMessage[]>(),
    drivers: new FeedMemo<Driver[]>(),
    currentTyres: new FeedMemo<CurrentTyre[]>(),
    tyreStintHistory: new FeedMemo<DriverTyreStintHistory[]>(),
    weatherHistory: new FeedMemo<WeatherSample[]>(),
    lapPositions: new FeedMemo<LapPositionSeries[]>(),
    sessionBests: new FeedMemo<DriverSessionBests[]>(),
    pitLaneTimes: new FeedMemo<PitLaneTime[]>(),
    teamRadio: new FeedMemo<TeamRadioClip[]>(),
    trackMessage: new FeedMemo<string | null>()
  }
}

/**
 * Advance `view`'s cursor to session time `clock`, leaving a checkpoint behind
 * at each interval boundary it crosses beyond the last one. A backward seek
 * restores the nearest checkpoint at or before `clock` instead of re-merging
 * from t=0.
 */
export function advanceView(
  view: ReplayView,
  clock: number,
  checkpoints: MergeCheckpoint[],
  feeds: ReplayFeeds,
  policy: CheckpointPolicy
): void {
  if (clock < view.cursorT) rewindView(view, clock, checkpoints)
  let boundary = nextCheckpointT(checkpoints, policy)
  while (boundary != null && boundary <= clock && view.cursorT <= boundary) {
    mergeThrough(view, boundary, feeds)
    checkpoints.push({
      t: boundary,
      tIdx: view.tIdx,
      aIdx: view.aIdx,
      timing: structuredClone(view.timing),
      app: structuredClone(view.app)
    })
    boundary = nextCheckpointT(checkpoints, policy)
  }
  mergeThrough(view, clock, feeds)
  view.cursorT = clock
}

function nextCheckpointT(checkpoints: MergeCheckpoint[], policy: CheckpointPolicy): number | null {
  if (checkpoints.length >= policy.max) return null
  const last = checkpoints[checkpoints.length - 1]
  return (last?.t ?? 0) + policy.intervalSec
}

function rewindView(view: ReplayView, clock: number, checkpoints: MergeCheckpoint[]): void {
  let lo = 0
  let hi = checkpoints.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (checkpoints[mid].t <= clock) {
      found = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  if (found < 0) view.resetCursor()
  else view.restore(checkpoints[found])
}

/** Merge every not-yet-merged timing/app point with `t <= through` into `view`. */
function mergeThrough(view: ReplayView, through: number, feeds: ReplayFeeds): void {
  const timingPoints = feeds.timingPoints
  while (view.tIdx < timingPoints.length && timingPoints[view.tIdx].t <= through) {
    view.timing = deepMergeF1(view.timing, timingPoints[view.tIdx].d)
    view.tIdx++
  }
  const appPoints = feeds.appPoints
  while (view.aIdx < appPoints.length && appPoints[view.aIdx].t <= through) {
    view.app = deepMergeF1(view.app, appPoints[view.aIdx].d)
    view.aIdx++
    view.appStateVersion++
  }
}
