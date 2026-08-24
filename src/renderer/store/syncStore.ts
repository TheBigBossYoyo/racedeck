import { create } from 'zustand'
import { STORE_NS } from '@shared/ipc-contract'
import type { RaceControlMessage, SyncState, VideoPlaybackProbe } from '@shared/models'
import { persist } from './persist'
import { bridge, hasBridge } from '@renderer/lib/ipc'
import {
  SessionSyncEngine,
  type SyncCandidate,
  type SyncEventType
} from '@renderer/core/engines/SessionSyncEngine'
import {
  anchorFrom,
  followStep,
  FOLLOW_DEADBAND_SEC,
  type FollowAnchor,
  type FollowStatus
} from '@renderer/core/engines/VideoFollowEngine'

const engine = new SessionSyncEngine()
let syncReadVersion = 0

/**
 * How often the TOD player's clock is read while follow is on.
 *
 * Each read is one `executeJavaScript` returning four numbers, so it is far
 * cheaper than a render; a second is frequent enough that a pause is reflected
 * before the user looks back at the dashboard.
 */
const FOLLOW_POLL_MS = 1_000
let followTimer: ReturnType<typeof setTimeout> | null = null
let followGeneration = 0
let followRequestVersion = 0
const FOLLOW_ENABLED_KEY = 'follow-enabled'

const OFF_FOLLOW_STATE: FollowState = {
  enabled: false,
  status: 'off',
  detail: null,
  videoTime: null,
  paused: false
}

function clearFollowTimer(): void {
  if (!followTimer) return
  clearTimeout(followTimer)
  followTimer = null
}

function invalidateFollowLifecycle(): number {
  clearFollowTimer()
  followGeneration += 1
  return followGeneration
}

function followStateWithoutContext(follow: FollowState): FollowState {
  if (!follow.enabled) return { ...OFF_FOLLOW_STATE }
  return {
    ...follow,
    status: 'uncalibrated',
    detail: null,
    videoTime: null,
    paused: false
  }
}

function clearFollowContext(): void {
  useSyncStore.setState((state) => ({
    anchor: null,
    follow: followStateWithoutContext(state.follow)
  }))
}

function scheduleFollowTask(task: 'anchor' | 'tick', generation: number): void {
  clearFollowTimer()
  if (generation !== followGeneration) return
  const state = useSyncStore.getState()
  if (!state.follow.enabled || !state.followEligible) return
  followTimer = setTimeout(() => {
    followTimer = null
    if (task === 'anchor') {
      void restartFollowFromCurrentOffset(engine.getState().offsetSeconds)
      return
    }
    void runFollowTick()
  }, FOLLOW_POLL_MS)
}

function beginFollowRequest(): { readonly generation: number; readonly version: number } {
  return { generation: followGeneration, version: ++followRequestVersion }
}

function isCurrentFollowRequest(request: {
  readonly generation: number
  readonly version: number
}): boolean {
  const state = useSyncStore.getState()
  return (
    request.generation === followGeneration &&
    request.version === followRequestVersion &&
    state.follow.enabled &&
    state.followEligible
  )
}

export interface FollowState {
  enabled: boolean
  status: FollowStatus
  detail: string | null
  /** Player clock at the last successful read, for the diagnostics line. */
  videoTime: number | null
  paused: boolean
}

interface SyncStoreState {
  sync: SyncState
  candidates: SyncCandidate[]
  wizardEvent: SyncEventType
  follow: FollowState
  anchor: FollowAnchor | null
  /**
   * Whether following the video can mean anything right now.
   *
   * The identity follow rests on — real time advances the data — only holds on a
   * LIVE session. In replay the dashboard's clock is the app's own, so a paused
   * video says nothing about how far behind the data it is. The session store
   * owns that fact and pushes it here, rather than this store reaching back into
   * it (which would close an import cycle).
   */
  followEligible: boolean
  /** Human label of the last event the offset was calibrated against, for a sync-health readout. */
  lastMatchedEvent: string | null
  /** Wall-clock ms of the last successful player-clock probe. */
  lastProbeAtMs: number | null
  setFollowEligible: (eligible: boolean) => void
  setFollowEnabled: (enabled: boolean) => Promise<void>
  /**
   * Declare the current offset correct and anchor follow to it. Every path that
   * establishes a delay (the wizard, the slider, a preset) goes through here, so
   * follow never keeps tracking against a superseded value. `eventLabel`, when
   * given, records what was matched for the sync-health panel; omitted (a manual
   * nudge/preset, or a plain re-anchor to the current moment) leaves the
   * previously recorded label as-is.
   */
  calibrate: (offsetSeconds: number, eventLabel?: string) => Promise<void>
  hydrate: () => Promise<void>
  setOffset: (seconds: number) => void
  nudge: (delta: number) => void
  setBroadcaster: (b: string) => Promise<void>
  setScope: (scopeKey: string | null) => Promise<void>
  setCalibrating: (v: boolean) => void
  setWizardEvent: (t: SyncEventType) => void
  buildCandidates: (
    messages: RaceControlMessage[],
    markLiveSec: number,
    sessionStartMs: number
  ) => void
  clearCandidates: () => void
}

export const syncOffsetKey = (broadcaster: string, scopeKey: string | null) =>
  scopeKey ? `offset:${broadcaster}:${encodeURIComponent(scopeKey)}` : `offset:${broadcaster}`

export const useSyncStore = create<SyncStoreState>((set, get) => ({
  sync: engine.getState(),
  candidates: [],
  // 'Anything' by default: making the user classify the event before marking it
  // was a step that mostly guessed wrong and rarely helped.
  wizardEvent: 'race-control',
  follow: { enabled: false, status: 'off', detail: null, videoTime: null, paused: false },
  anchor: null,
  followEligible: false,
  lastMatchedEvent: null,
  lastProbeAtMs: null,

  hydrate: async () => {
    const readVersion = ++syncReadVersion
    const b = engine.getState().broadcaster
    const saved = await persist.get<number>(STORE_NS.SYNC, syncOffsetKey(b, null))
    if (readVersion !== syncReadVersion || engine.getState().broadcaster !== b) return
    if (typeof saved === 'number') engine.setOffset(saved)
    set({ sync: engine.getState() })
    const followEnabled = await persist.get<boolean>(STORE_NS.SYNC, FOLLOW_ENABLED_KEY)
    if (readVersion !== syncReadVersion || engine.getState().broadcaster !== b) return
    if (followEnabled) await get().setFollowEnabled(true)
  },

  setOffset: (seconds) => {
    syncReadVersion++
    const sync = engine.setOffset(seconds)
    set({ sync })
    void persist.set(
      STORE_NS.SYNC,
      syncOffsetKey(sync.broadcaster, sync.scopeKey),
      sync.offsetSeconds
    )
    void reanchorIfFollowing(sync.offsetSeconds)
  },

  nudge: (delta) => {
    syncReadVersion++
    const sync = engine.nudge(delta)
    set({ sync })
    void persist.set(
      STORE_NS.SYNC,
      syncOffsetKey(sync.broadcaster, sync.scopeKey),
      sync.offsetSeconds
    )
    void reanchorIfFollowing(sync.offsetSeconds)
  },

  setBroadcaster: async (b) => {
    const readVersion = ++syncReadVersion
    invalidateFollowLifecycle()
    clearFollowContext()
    engine.setBroadcaster(b)
    const scopeKey = engine.getState().scopeKey
    const saved = await persist.get<number>(STORE_NS.SYNC, syncOffsetKey(b, scopeKey))
    const current = engine.getState()
    if (
      readVersion !== syncReadVersion ||
      current.broadcaster !== b ||
      current.scopeKey !== scopeKey
    )
      return
    if (typeof saved === 'number') engine.setOffset(saved)
    else engine.setOffset(0)
    set({ sync: engine.getState() })
    if (get().follow.enabled && get().followEligible) {
      void restartFollowFromCurrentOffset(engine.getState().offsetSeconds)
    }
  },

  setScope: async (scopeKey) => {
    const readVersion = ++syncReadVersion
    invalidateFollowLifecycle()
    clearFollowContext()
    engine.setScopeKey(scopeKey)
    const state = engine.getState()
    const broadcaster = state.broadcaster
    const scoped = await persist.get<number>(
      STORE_NS.SYNC,
      syncOffsetKey(state.broadcaster, scopeKey)
    )
    const current = engine.getState()
    if (
      readVersion !== syncReadVersion ||
      current.broadcaster !== broadcaster ||
      current.scopeKey !== scopeKey
    )
      return
    if (typeof scoped === 'number') engine.setOffset(scoped)
    else engine.setOffset(0)
    set({ sync: engine.getState(), candidates: [] })
    if (get().follow.enabled && get().followEligible) {
      void restartFollowFromCurrentOffset(engine.getState().offsetSeconds)
    }
  },

  setCalibrating: (v) => set({ sync: engine.setCalibrating(v) }),

  setWizardEvent: (t) => set({ wizardEvent: t }),

  buildCandidates: (messages, markLiveSec, sessionStartMs) => {
    const candidates = engine.buildCandidates(
      messages,
      markLiveSec,
      sessionStartMs,
      get().wizardEvent
    )
    set({ candidates })
  },

  clearCandidates: () => set({ candidates: [] }),

  setFollowEligible: (eligible) => {
    const alreadyEligible = get().followEligible === eligible
    if (!eligible) {
      invalidateFollowLifecycle()
      set({ followEligible: false })
      clearFollowContext()
      return
    }
    if (alreadyEligible) return
    set({ followEligible: true })
    if (get().follow.enabled) {
      void restartFollowFromCurrentOffset(engine.getState().offsetSeconds)
    }
  },

  setFollowEnabled: async (enabled) => {
    void persist.set(STORE_NS.SYNC, FOLLOW_ENABLED_KEY, enabled)
    invalidateFollowLifecycle()
    if (!enabled) {
      set({ anchor: null, follow: { ...OFF_FOLLOW_STATE } })
      return
    }
    set((state) => ({
      anchor: null,
      follow: {
        ...state.follow,
        enabled: true,
        status: 'uncalibrated',
        detail: null,
        videoTime: null,
        paused: false
      }
    }))
    if (!get().followEligible) return
    await restartFollowFromCurrentOffset(engine.getState().offsetSeconds)
  },

  calibrate: async (offsetSeconds, eventLabel) => {
    syncReadVersion++
    const sync = engine.setOffset(offsetSeconds)
    set(eventLabel != null ? { sync, lastMatchedEvent: eventLabel } : { sync })
    void persist.set(
      STORE_NS.SYNC,
      syncOffsetKey(sync.broadcaster, sync.scopeKey),
      sync.offsetSeconds
    )
    if (!get().follow.enabled) return
    await restartFollowFromCurrentOffset(sync.offsetSeconds)
  }
}))

/**
 * Re-take the anchor after the user has adjusted the offset by hand.
 *
 * Without this, a manual nudge while follow was on would be undone within the
 * second: the next tick recomputes the offset from the OLD anchor, which knows
 * nothing of the correction. Fine-tuning has to move the reference, not fight it.
 */
async function restartFollowFromCurrentOffset(offsetSeconds: number): Promise<void> {
  const state = useSyncStore.getState()
  if (!state.follow.enabled) return
  const generation = invalidateFollowLifecycle()
  if (!useSyncStore.getState().followEligible) {
    clearFollowContext()
    return
  }
  useSyncStore.setState((current) => ({
    anchor: null,
    follow: {
      ...current.follow,
      status: 'uncalibrated',
      detail: null,
      videoTime: null,
      paused: false
    }
  }))
  const request = beginFollowRequest()
  const probe = await readPlayback()
  if (!isCurrentFollowRequest(request)) return
  const anchor = anchorFrom(probe, offsetSeconds)
  useSyncStore.setState((current) => ({
    anchor,
    ...(probe.ok ? { lastProbeAtMs: probe.atMs } : {}),
    follow: {
      ...current.follow,
      status: anchor ? 'following' : 'waiting',
      detail: anchor ? null : (probe.reason ?? 'Waiting for the TOD player.'),
      videoTime: anchor ? probe.currentTime : current.follow.videoTime,
      paused: probe.ok ? probe.paused : current.follow.paused
    }
  }))
  scheduleFollowTask(anchor ? 'tick' : 'anchor', generation)
}

async function reanchorIfFollowing(offsetSeconds: number): Promise<void> {
  const before = useSyncStore.getState()
  if (!before.follow.enabled || !before.followEligible) return
  await restartFollowFromCurrentOffset(offsetSeconds)
}

/** Read the TOD player's clock, degrading to a miss when there is no bridge. */
async function readPlayback(): Promise<VideoPlaybackProbe> {
  if (!hasBridge()) {
    return {
      ok: false,
      currentTime: 0,
      paused: true,
      seekableEnd: null,
      mediaKey: null,
      atMs: Date.now(),
      reason: 'Video surface unavailable.'
    }
  }
  try {
    return await bridge().video.probePlayback()
  } catch (error) {
    return {
      ok: false,
      currentTime: 0,
      paused: true,
      seekableEnd: null,
      mediaKey: null,
      atMs: Date.now(),
      reason: error instanceof Error ? error.message : 'Could not read the TOD player.'
    }
  }
}

/**
 * One follow tick: read the player, derive the offset the reading implies, and
 * apply it if it has moved enough to matter.
 *
 * The corrected offset is applied to the engine but NOT persisted — it is a
 * measurement that will be re-derived from the anchor next second, and writing
 * it to disk every tick would be a store write per second for no benefit. The
 * anchor's own offset (set at calibration) is what gets persisted.
 */
async function runFollowTick(): Promise<void> {
  const store = useSyncStore.getState()
  if (!store.follow.enabled || !store.followEligible) return
  if (!store.anchor) {
    if (store.follow.status !== 'needs-calibration') {
      await restartFollowFromCurrentOffset(engine.getState().offsetSeconds)
    }
    return
  }
  const request = beginFollowRequest()
  const probe = await readPlayback()
  if (!isCurrentFollowRequest(request)) return

  const state = useSyncStore.getState()

  const result = followStep(true, state.anchor, probe)
  const applied =
    result.offset != null &&
    Math.abs(result.offset - engine.getState().offsetSeconds) >= FOLLOW_DEADBAND_SEC
      ? engine.setOffset(result.offset)
      : null

  useSyncStore.setState({
    anchor: result.anchor,
    ...(applied ? { sync: applied } : {}),
    ...(probe.ok ? { lastProbeAtMs: probe.atMs } : {}),
    follow: {
      enabled: true,
      status: result.status,
      detail: result.detail,
      videoTime: probe.ok ? probe.currentTime : state.follow.videoTime,
      paused: probe.ok ? probe.paused : state.follow.paused
    }
  })
  if (result.status === 'following' || result.status === 'waiting') {
    scheduleFollowTask('tick', request.generation)
  } else {
    clearFollowTimer()
  }
}

export function currentSyncOffset(): number {
  return engine.getState().offsetSeconds
}
