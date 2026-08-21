import { create } from 'zustand'
import type { LapSample, RaceControlMessage, SessionInfo } from '@shared/models'
import { DataProviderManager } from '@renderer/core/DataProviderManager'
import type { ProviderCapabilities, RaceSnapshot, SessionTimeline } from '@renderer/core/providers/types'
import { clamp } from '@renderer/lib/utils'
import { useSyncStore } from './syncStore'
import { useAlertStore } from './alertStore'
import { useSettingsStore } from './settingsStore'
import { useRaceStoryStore } from './raceStoryStore'
import { useEngineerNotesStore } from './engineerNotesStore'
import { syncMath } from '@renderer/core/engines/SessionSyncEngine'
import { shouldPauseAtDataEdge } from '@shared/f1-session-state'

const manager = new DataProviderManager()

let ticker: ReturnType<typeof setInterval> | null = null
let lastTick = 0
let sessionLoadVersion = 0
let sessionListVersion = 0
let reloadPromise: Promise<boolean> | null = null

function isKnownLapAtTime(lap: LapSample, dataTime: number, currentLap: number | null): boolean {
  if (lap.sessionTime != null && Number.isFinite(lap.sessionTime)) return lap.sessionTime <= dataTime
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

  focusDriver: number | null
  comparison: [number, number] | null
  noSpoiler: boolean

  init: () => Promise<void>
  setProvider: (id: string) => Promise<void>
  refreshSessions: () => Promise<void>
  selectSession: (id: string, opts?: { seekFraction?: number }) => Promise<void>
  /** Re-fetch the current session (extends a live session's timeline). */
  reloadSession: () => Promise<boolean>

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
    sessionLoadVersion++
    get().pause()
    try {
      const caps = manager.setActive(id)
      set({ providerId: caps.id, sessions: [], currentSession: null, snapshot: null, timeline: null, loadingSession: false, error: null })
      await get().refreshSessions()
    } catch (e) {
      set({ error: (e as Error).message })
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
      set({ sessionsLoading: false, error: `Could not load sessions: ${(e as Error).message}` })
    }
  },

  selectSession: async (id, opts) => {
    if (get().loadingSession) return
    const requestVersion = ++sessionLoadVersion
    const providerId = get().providerId
    get().pause()
    set({ loadingSession: true, error: null })
    try {
      const pendingReload = reloadPromise
      if (pendingReload) await pendingReload
      if (requestVersion !== sessionLoadVersion || get().providerId !== providerId) return
      const session = await manager.loadSession(id)
      if (requestVersion !== sessionLoadVersion || get().providerId !== providerId) return
      const duration = manager.getDuration()
      await useSyncStore.getState().setScope(`${get().providerId}:${session.id}`)
      useAlertStore.getState().resetEngine()
      useRaceStoryStore.getState().reset()
      useEngineerNotesStore.getState().reset()
      const startClock = opts?.seekFraction != null
        ? clamp(opts.seekFraction * duration, 0, duration)
        : clamp(manager.getInitialClock() + useSyncStore.getState().sync.offsetSeconds, 0, duration)
      set({
        currentSession: session,
        duration,
        clock: startClock,
        timeline: manager.getTimeline(),
        loadingSession: false,
        focusDriver: null,
        comparison: null
      })
      get().recompute()
    } catch (e) {
      if (requestVersion !== sessionLoadVersion || get().providerId !== providerId) return
      set({ loadingSession: false, error: `Could not load session: ${(e as Error).message}` })
    }
  },

  reloadSession: async () => {
    if (get().loadingSession) return false
    if (reloadPromise) return reloadPromise
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
        ) return false
        const duration = manager.getDuration()
        set({ duration, timeline: manager.getTimeline() })
        get().recompute()
        return true
      } catch (e) {
        if (requestVersion === sessionLoadVersion && get().providerId === providerId) {
          set({ error: `Could not refresh session: ${(e as Error).message}` })
        }
        return false
      } finally {
        reloadPromise = null
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
    set({ clock: clamp(t, 0, duration) })
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
      const snapshot = manager.getSnapshotAt(get().effectiveDataTime())
      set({ snapshot })
      useAlertStore.getState().ingest(snapshot)
      useRaceStoryStore.getState().ingest(snapshot)
      useEngineerNotesStore.getState().ingest(snapshot)
    } catch (e) {
      set({ error: (e as Error).message })
    }
  },

  getDriverLaps: (n) => {
    const dataTime = get().effectiveDataTime()
    const snapshot = get().snapshot ?? (get().currentSession ? manager.getSnapshotAt(dataTime) : null)
    const currentLap = snapshot?.currentLap ?? null
    return manager.getDriverLaps(n).filter((lap) => isKnownLapAtTime(lap, dataTime, currentLap))
  },
  getTelemetry: (n, windowSec) => manager.getTelemetry(n, get().effectiveDataTime(), windowSec),
  getRaceControlHistory: () => {
    const duration = get().duration
    if (duration <= 0) return []
    return manager.getSnapshotAt(duration).raceControl
  }
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
