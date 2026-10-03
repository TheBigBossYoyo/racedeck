import { create } from 'zustand'
import type { LapSample, RaceControlMessage, SessionInfo } from '@shared/models'
import { DataProviderManager } from '@renderer/core/DataProviderManager'
import type { ProviderCapabilities } from '@renderer/core/providers/types'
import type { RaceSnapshot } from '@renderer/core/model/snapshot'
import type { SessionTimeline } from '@renderer/core/model/timeline'
import { clamp } from '@renderer/lib/utils'
import { errorMessage } from '@renderer/lib/errorMessage'
import { useSyncStore } from './syncStore'
import { useAlertStore } from './alertStore'
import { useSettingsStore } from './settingsStore'
import { useRaceStoryStore } from './raceStoryStore'
import { useEngineerNotesStore } from './engineerNotesStore'
import { useRadioNotifyStore } from './radioNotifyStore'
import { useAnnotationsStore } from './annotationsStore'
import { useProfileStore } from './profileStore'
import { syncMath } from '@renderer/core/engines/SessionSyncEngine'
import { shouldPauseAtDataEdge } from '@shared/f1-session-state'
import { buildRaceBookmarks, type RaceBookmark } from '@renderer/core/engines/RaceBookmarks'
import { recordDerivation } from '@renderer/core/engines/DerivationTimings'

const manager = new DataProviderManager()

let ticker: ReturnType<typeof setInterval> | null = null
let lastTick = 0
let sessionLoadVersion = 0
let sessionListVersion = 0
let reloadPromise: Promise<boolean> | null = null
/** A caller that did NOT defer joined the in-flight reload: it is owed a publish
 * even if the reload itself was started with `deferPublish`. */
let reloadNeedsPublish = false
/** >0 while code that follows the data (not the user) is moving the playhead. */
let programmaticSeekDepth = 0

/**
 * Run `fn` with any `seek` it makes treated as the app following the data (the
 * live-edge follow), not the user navigating: it moves the playhead but is not
 * recorded in `recentSeeks`, which the command palette offers as "resume where
 * I was".
 */
export function asProgrammaticSeek<T>(fn: () => T): T {
  programmaticSeekDepth++
  try {
    return fn()
  } finally {
    programmaticSeekDepth--
  }
}

/**
 * Clear every store that holds data derived from the previous provider/session.
 * One place so a provider switch and a successful session load can't drift apart
 * (a switch used to leave the old provider's alerts, story and radio notices up
 * until — and unless — the next session loaded).
 */
function resetSessionScopedStores(): void {
  useAlertStore.getState().resetEngine()
  useRaceStoryStore.getState().reset()
  useEngineerNotesStore.getState().reset()
  useRadioNotifyStore.getState().reset()
}

function isKnownLapAtTime(lap: LapSample, dataTime: number, currentLap: number | null): boolean {
  if (lap.sessionTime != null && Number.isFinite(lap.sessionTime))
    return lap.sessionTime <= dataTime
  if (currentLap != null) return lap.lapNumber <= currentLap
  return true
}

interface SessionStoreState {
  providerId: string
  catalog: ProviderCapabilities[]
  sessions: SessionInfo[]
  sessionsLoading: boolean
  currentSession: SessionInfo | null
  loadingSession: boolean
  error: string | null

  clock: number
  duration: number
  playing: boolean
  speed: number
  snapshot: RaceSnapshot | null
  timeline: SessionTimeline | null
  /** Whole-session clickable markers (start, SC/VSC, pits, lead changes, penalties, radio, fastest lap). */
  bookmarks: RaceBookmark[]
  /** Most recent explicit seek targets (data-clock seconds), newest first, capped at 8. */
  recentSeeks: number[]

  focusDriver: number | null
  comparison: [number, number] | null
  noSpoiler: boolean

  init: () => Promise<void>
  setProvider: (id: string) => Promise<void>
  refreshSessions: () => Promise<void>
  selectSession: (id: string, opts?: { seekFraction?: number }) => Promise<void>
  /**
   * Re-fetch the current session (extends a live session's timeline).
   * `deferPublish` updates duration/timeline but leaves the snapshot to the
   * caller's next `seek`/`recompute`, so a live poll that is about to move the
   * playhead publishes once instead of twice.
   */
  reloadSession: (opts?: { deferPublish?: boolean }) => Promise<boolean>

  play: () => void
  pause: () => void
  togglePlay: () => void
  seek: (t: number) => void
  seekFraction: (f: number) => void
  step: (deltaSec: number) => void
  setSpeed: (s: number) => void

  setFocusDriver: (n: number | null) => void
  setComparison: (a: number, b: number) => void
  setNoSpoiler: (v: boolean) => void
  recompute: () => void
  effectiveDataTime: () => number

  getDriverLaps: (n: number) => ReturnType<DataProviderManager['getDriverLaps']>
  getTelemetry: (n: number, windowSec?: number) => ReturnType<DataProviderManager['getTelemetry']>
  getRaceControlHistory: () => RaceControlMessage[]
  /** Whole-session snapshot (not the current playhead) — for exports/bookmarks. */
  getFullSnapshot: () => RaceSnapshot | null
  /** Cache/enrichment diagnostics for the active provider, when it exposes any. */
  getDiagnostics: () => ReturnType<DataProviderManager['getDiagnostics']>
}

export const useSessionStore = create<SessionStoreState>((set, get) => ({
  providerId: manager.activeProviderId,
  catalog: manager.catalog,
  sessions: [],
  sessionsLoading: false,
  currentSession: null,
  loadingSession: false,
  error: null,

  clock: 0,
  duration: 0,
  playing: false,
  speed: 1,
  snapshot: null,
  timeline: null,
  bookmarks: [],
  recentSeeks: [],

  focusDriver: null,
  comparison: null,
  noSpoiler: false,

  init: async () => {
    // Default to the safe, offline demo provider and land mid-race so the
    // dashboard is immediately rich (synthetic data → no spoiler concern).
    manager.setActive('demo')
    set({ providerId: 'demo', catalog: manager.catalog })
    await get().refreshSessions()
    await get().selectSession('demo-2024-gp', { seekFraction: 0.42 })
  },

  setProvider: async (id) => {
    const requestVersion = ++sessionLoadVersion
    get().pause()
    try {
      const caps = manager.setActive(id)
      // Clear every store scoped to the outgoing provider/session BEFORE this
      // store's own reset, so nothing can observe sessionStore already
      // cleared while a dependent store (annotations, follow-eligibility)
      // still holds state from the previous provider.
      useSyncStore.getState().setFollowEligible(false)
      useAnnotationsStore.getState().reset()
      resetSessionScopedStores()
      // The old session's sync offset must not follow us to the new provider.
      // Best-effort: a failed offset read only means the offset stays at its default.
      void useSyncStore
        .getState()
        .setScope(null)
        .catch(() => undefined)
      set({
        providerId: caps.id,
        sessions: [],
        currentSession: null,
        snapshot: null,
        timeline: null,
        bookmarks: [],
        recentSeeks: [],
        loadingSession: false,
        error: null
      })
      await get().refreshSessions()
    } catch (e) {
      // A newer setProvider/selectSession call may have already superseded
      // this one — don't let a late failure stomp its state with our error.
      if (requestVersion !== sessionLoadVersion) return
      set({ error: errorMessage(e) })
    }
  },

  refreshSessions: async () => {
    const requestVersion = ++sessionListVersion
    const providerId = get().providerId
    set({ sessionsLoading: true, error: null })
    try {
      const sessions = await manager.listSessions()
      if (requestVersion !== sessionListVersion || get().providerId !== providerId) return
      set({ sessions, sessionsLoading: false })
    } catch (e) {
      if (requestVersion !== sessionListVersion || get().providerId !== providerId) return
      set({ sessionsLoading: false, error: `Could not load sessions: ${errorMessage(e)}` })
    }
  },

  selectSession: async (id, opts) => {
    if (get().loadingSession) return
    const requestVersion = ++sessionLoadVersion
    const providerId = get().providerId
    get().pause()
    useSyncStore.getState().setFollowEligible(false)
    set({ loadingSession: true, error: null })
    try {
      const pendingReload = reloadPromise
      if (pendingReload) await pendingReload
      if (requestVersion !== sessionLoadVersion || get().providerId !== providerId) return
      const session = await manager.loadSession(id)
      if (requestVersion !== sessionLoadVersion || get().providerId !== providerId) return
      const duration = manager.getDuration()
      await useSyncStore.getState().setScope(`${get().providerId}:${session.id}`)
      resetSessionScopedStores()
      void useAnnotationsStore.getState().hydrateForSession(session.id)
      const startClock =
        opts?.seekFraction != null
          ? clamp(opts.seekFraction * duration, 0, duration)
          : clamp(
              manager.getInitialClock() + useSyncStore.getState().sync.offsetSeconds,
              0,
              duration
            )
      const timeline = manager.getTimeline()
      // Bookmarks need the WHOLE session, not the current playhead, so they're
      // built once here from a full-duration snapshot — never per tick.
      const bookmarks =
        duration > 0
          ? buildRaceBookmarks(manager.getSnapshotAt(duration), timeline?.greenStart ?? null)
          : []
      set({
        currentSession: session,
        duration,
        clock: startClock,
        timeline,
        bookmarks,
        recentSeeks: [],
        loadingSession: false,
        focusDriver: null,
        comparison: null
      })
      // Auto-apply a saved race-watch profile (APP_IMPROVEMENT_ROADMAP.md P3
      // item 33) for this session's type, when one exists and the user hasn't
      // turned auto-apply off.
      const profileStore = useProfileStore.getState()
      if (profileStore.autoApply && profileStore.hasProfile(session.type)) {
        profileStore.applyProfile(session.type)
      }
      // Following the TOD video only means anything while the data clock IS real
      // time. Told here rather than from the sync widget, so it stays right even
      // when that widget is not part of the user's layout.
      useSyncStore.getState().setFollowEligible(providerId === 'f1live' && session.id === 'live')
      get().recompute()
    } catch (e) {
      if (requestVersion !== sessionLoadVersion || get().providerId !== providerId) return
      set({ loadingSession: false, error: `Could not load session: ${errorMessage(e)}` })
    }
  },

  reloadSession: async (opts) => {
    if (get().loadingSession) return false
    if (reloadPromise) {
      if (!opts?.deferPublish) reloadNeedsPublish = true
      return reloadPromise
    }
    const cur = get().currentSession
    if (!cur) return false
    const requestVersion = sessionLoadVersion
    const providerId = get().providerId
    reloadPromise = (async () => {
      try {
        await manager.loadSession(cur.id)
        if (
          requestVersion !== sessionLoadVersion ||
          get().providerId !== providerId ||
          get().currentSession?.id !== cur.id
        )
          return false
        const duration = manager.getDuration()
        set({ duration, timeline: manager.getTimeline() })
        if (!opts?.deferPublish || reloadNeedsPublish) get().recompute()
        return true
      } catch (e) {
        if (requestVersion === sessionLoadVersion && get().providerId === providerId) {
          set({ error: `Could not refresh session: ${errorMessage(e)}` })
        }
        return false
      } finally {
        reloadPromise = null
        reloadNeedsPublish = false
      }
    })()
    return reloadPromise
  },

  play: () => {
    if (get().playing || get().duration <= 0) return
    set({ playing: true })
    lastTick = performance.now()
    // Low-power mode halves the recompute rate (spec: performance mode).
    const tickMs = useSettingsStore.getState().performanceMode ? 600 : 250
    ticker = setInterval(() => {
      const s = get()
      const now = performance.now()
      const dt = ((now - lastTick) / 1000) * s.speed
      lastTick = now
      const next = s.clock + dt
      if (next >= s.duration) {
        if (s.clock !== s.duration) {
          set({ clock: s.duration })
          get().recompute()
        }
        if (shouldPauseAtDataEdge(s.providerId, s.currentSession?.id ?? null)) get().pause()
        return
      }
      set({ clock: next })
      get().recompute()
    }, tickMs)
  },

  pause: () => {
    if (ticker) {
      clearInterval(ticker)
      ticker = null
    }
    if (get().playing) set({ playing: false })
  },

  togglePlay: () => (get().playing ? get().pause() : get().play()),

  seek: (t) => {
    const duration = get().duration
    const clock = clamp(t, 0, duration)
    if (programmaticSeekDepth > 0) {
      set({ clock })
    } else {
      const recentSeeks = [clock, ...get().recentSeeks.filter((s) => s !== clock)].slice(0, 8)
      set({ clock, recentSeeks })
    }
    get().recompute()
  },

  seekFraction: (f) => get().seek(f * get().duration),

  step: (deltaSec) => get().seek(get().clock + deltaSec),

  setSpeed: (s) => set({ speed: clamp(s, 0.25, 16) }),

  setFocusDriver: (n) => set({ focusDriver: n }),

  setComparison: (a, b) => set({ comparison: [a, b], focusDriver: a }),

  setNoSpoiler: (v) => set({ noSpoiler: v }),

  effectiveDataTime: () => {
    const offset = useSyncStore.getState().sync.offsetSeconds
    // The data is rendered shifted by the broadcast offset so adjusting sync
    // visibly aligns the dashboard with the (delayed) video.
    return syncMath.dataTimeForVideo(get().clock, offset, get().duration)
  },

  recompute: () => {
    const s = get()
    if (!s.currentSession) return
    try {
      const startedAt = performance.now()
      const snapshot = manager.getSnapshotAt(get().effectiveDataTime())
      set({ snapshot })
      const builtAt = performance.now()
      useAlertStore.getState().ingest(snapshot)
      useRaceStoryStore.getState().ingest(snapshot)
      useEngineerNotesStore.getState().ingest(snapshot)
      useRadioNotifyStore.getState().ingest(snapshot)
      recordDerivation(builtAt - startedAt, performance.now() - builtAt)
    } catch (e) {
      set({ error: errorMessage(e) })
    }
  },

  getDriverLaps: (n) => {
    const dataTime = get().effectiveDataTime()
    const snapshot =
      get().snapshot ?? (get().currentSession ? manager.getSnapshotAt(dataTime) : null)
    const currentLap = snapshot?.currentLap ?? null
    return manager.getDriverLaps(n).filter((lap) => isKnownLapAtTime(lap, dataTime, currentLap))
  },
  getTelemetry: (n, windowSec) => manager.getTelemetry(n, get().effectiveDataTime(), windowSec),
  getRaceControlHistory: () => {
    const duration = get().duration
    if (duration <= 0) return []
    return manager.getSnapshotAt(duration).raceControl
  },
  getFullSnapshot: () => {
    const duration = get().duration
    if (duration <= 0) return null
    return manager.getSnapshotAt(duration)
  },
  getDiagnostics: () => manager.getDiagnostics()
}))

// When the sync offset changes while paused, re-render the shifted snapshot.
useSyncStore.subscribe((state, prev) => {
  if (state.sync.offsetSeconds !== prev.sync.offsetSeconds) {
    const s = useSessionStore.getState()
    if (!s.playing) s.recompute()
  }
})

// Apply a performance-mode cadence change immediately, even during playback.
useSettingsStore.subscribe((state, previous) => {
  if (state.performanceMode === previous.performanceMode) return
  const session = useSessionStore.getState()
  if (!session.playing) return
  session.pause()
  session.play()
})

manager.setUpdateListener(() => {
  const session = useSessionStore.getState()
  if (!session.currentSession || session.loadingSession) return
  useSessionStore.setState({ duration: manager.getDuration(), timeline: manager.getTimeline() })
  session.recompute()
})

export { manager as dataManager }

/**
 * Non-reactive read of the recompute timing rings (see DerivationTimings). A
 * plain function rather than store state so sampling never triggers a render;
 * callers poll it on open / a slow interval.
 */
export { getDerivationTimingStats } from '@renderer/core/engines/DerivationTimings'
