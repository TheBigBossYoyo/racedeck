import { create } from 'zustand'
import type { LiveStatus } from '@shared/f1live'
import { hasBridge, bridge } from '@renderer/lib/ipc'
import { errorMessage } from '@renderer/lib/errorMessage'
import { asProgrammaticSeek, useSessionStore } from './sessionStore'
import { useSettingsStore } from './settingsStore'

/**
 * liveStore — orchestrates the LIVE F1 timing connection: the in-app F1 sign-in,
 * the SignalR connect, live status, and a poll that extends the growing live
 * timeline and keeps the dashboard pinned to the live edge. The heavy lifting
 * (auth + socket) is in the main process; this just drives it and feeds the
 * F1LiveProvider via the session store.
 */

const NORMAL_POLL_MS = 250
const PERFORMANCE_POLL_MS = 1000
const EDGE_MARGIN = 2 // stay ~2s behind the very edge so data is complete

/** Reconnect backoff (IMPROVEMENT_OPPORTUNITIES.md item #21): base delay, hard
 * cap, and the tick cadence used to surface a live "retrying in Ns…" countdown. */
const RECONNECT_BASE_MS = 1000
const RECONNECT_MAX_MS = 30_000
const RECONNECT_TICK_MS = 1000
/** How long a connection must stay up before the backoff counter starts over.
 * 'connected' fires at handshake completion, before any data, so it proves nothing
 * on its own — a server that handshakes and then drops would otherwise be retried
 * at the base delay forever. */
const RECONNECT_STABLE_MS = 10_000

let poll: ReturnType<typeof setTimeout> | null = null
let unsub: (() => void) | null = null
/** Guard so we load the live session exactly once per connection (idempotent). */
let liveLoaded = false
let intentionalDisconnect = false
let liveLoadVersion = 0
let pollGeneration = 0

let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let reconnectTick: ReturnType<typeof setInterval> | null = null
let reconnectAttempt = 0
let stableTimer: ReturnType<typeof setTimeout> | null = null
/** Set by the retry timer just before it calls connect(), so connect() can tell
 * an automatic retry (keep backing off) from a manual click (start over). */
let autoRetryInFlight = false

export interface ReconnectState {
  /** 1-based — the attempt this countdown is waiting to make. */
  attempt: number
  remainingMs: number
}

/**
 * Exponential backoff with full jitter, capped at RECONNECT_MAX_MS: doubles per
 * attempt (1s, 2s, 4s, …) then randomizes within [50%, 100%] of that ceiling so
 * a mass disconnect doesn't have every client retry in lockstep.
 */
export function reconnectDelayMs(attempt: number): number {
  const ceiling = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** attempt)
  return Math.round(ceiling * (0.5 + Math.random() * 0.5))
}

/**
 * Clears any pending auto-retry. The backoff counter is reset too unless
 * `keepAttempt` is set — the retry timer itself calls connect(), and that call
 * must not wipe the count or every retry would wait the base delay again.
 */
function cancelReconnect({ keepAttempt = false }: { keepAttempt?: boolean } = {}): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  if (reconnectTick) {
    clearInterval(reconnectTick)
    reconnectTick = null
  }
  if (!keepAttempt) reconnectAttempt = 0
  if (useLiveStore.getState().reconnect) useLiveStore.setState({ reconnect: null })
}

function clearStableTimer(): void {
  if (stableTimer) {
    clearTimeout(stableTimer)
    stableTimer = null
  }
}

/**
 * Starts the stability window for a fresh connection. Idempotent while running:
 * the status listener sees 'connected' again on every periodic republish, and
 * restarting the window each time would keep a busy feed from ever proving stable.
 */
function armStableTimer(): void {
  if (stableTimer) return
  stableTimer = setTimeout(() => {
    stableTimer = null
    reconnectAttempt = 0
  }, RECONNECT_STABLE_MS)
}

/** Schedules the next auto-reconnect attempt; a no-op if one is already pending. */
function scheduleReconnect(): void {
  if (reconnectTimer) return
  const attempt = reconnectAttempt
  const delayMs = reconnectDelayMs(attempt)
  let remainingMs = delayMs
  useLiveStore.setState({ reconnect: { attempt: attempt + 1, remainingMs } })
  reconnectTick = setInterval(() => {
    remainingMs = Math.max(0, remainingMs - RECONNECT_TICK_MS)
    useLiveStore.setState({ reconnect: { attempt: attempt + 1, remainingMs } })
  }, RECONNECT_TICK_MS)
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    if (reconnectTick) {
      clearInterval(reconnectTick)
      reconnectTick = null
    }
    reconnectAttempt = attempt + 1
    autoRetryInFlight = true
    useLiveStore.setState({ reconnect: null })
    void useLiveStore.getState().connect()
  }, delayMs)
}

export function getLiveReloadCadenceMs(performanceMode: boolean): number {
  return performanceMode ? PERFORMANCE_POLL_MS : NORMAL_POLL_MS
}

export interface LiveNotice {
  tone: 'info' | 'warning' | 'danger'
  title: string
  detail: string
}

export function liveNoticeForTransition(
  previous: LiveStatus | null,
  next: LiveStatus,
  intentional = false
): LiveNotice | null {
  if (intentional) {
    return { tone: 'info', title: 'F1 Live disconnected', detail: 'Live timing was disconnected.' }
  }
  if (next.detail?.toLowerCase().includes('subscription rejected')) {
    // F1 rotates subscription tokens roughly weekly, so this is nearly always an
    // expired token — and signing in again genuinely fixes it.
    return {
      tone: 'warning',
      title: 'F1 TV session expired',
      detail:
        'Sign in again to restore car telemetry & positions. Public timing continues meanwhile.'
    }
  }
  if (next.state === 'error') {
    return {
      tone: 'danger',
      title: 'F1 Live connection error',
      detail:
        next.detail || 'The live timing connection failed. Retry when your connection is available.'
    }
  }
  if (
    next.state === 'closed' &&
    (previous?.state === 'connected' || previous?.state === 'connecting')
  ) {
    return {
      tone: 'danger',
      title: 'F1 Live connection lost',
      detail: next.detail || 'The live timing connection closed unexpectedly.'
    }
  }
  return null
}

interface LiveStoreState {
  status: LiveStatus | null
  loggedIn: boolean
  busy: boolean
  notice: LiveNotice | null
  reconnect: ReconnectState | null
  init: () => void
  openLogin: () => void
  refreshLogin: () => Promise<void>
  connect: () => Promise<void>
  disconnect: () => void
  dismissNotice: () => void
}

function stopPoll(): void {
  pollGeneration++
  if (poll) {
    clearTimeout(poll)
    poll = null
  }
}

function shouldPollLiveSession(): boolean {
  const live = useLiveStore.getState().status
  const session = useSessionStore.getState()
  return (
    live?.state === 'connected' &&
    live.live &&
    session.providerId === 'f1live' &&
    session.currentSession?.id === 'live'
  )
}

function scheduleNextPoll(generation: number): void {
  if (generation !== pollGeneration) return
  if (!shouldPollLiveSession()) {
    stopPoll()
    liveLoaded = false
    return
  }
  if (poll) clearTimeout(poll)
  const delayMs = getLiveReloadCadenceMs(useSettingsStore.getState().performanceMode)
  poll = setTimeout(() => {
    void runPoll(generation)
  }, delayMs)
}

async function runPoll(generation: number): Promise<void> {
  if (generation !== pollGeneration || !shouldPollLiveSession()) return
  const session = useSessionStore.getState()
  // The seek below publishes this poll's one snapshot; letting the reload publish
  // too would build, fan out and render the same frame twice.
  const updated = await session.reloadSession({ deferPublish: true })
  if (generation !== pollGeneration) return
  if (updated) {
    const currentSession = useSessionStore.getState()
    if (currentSession.duration > 0)
      followLiveEdge(currentSession, currentSession.duration)
  }
  scheduleNextPoll(generation)
}

/** Pin the playhead near the live edge — the app following the data, not the user seeking. */
function followLiveEdge(session: ReturnType<typeof useSessionStore.getState>, duration: number): void {
  asProgrammaticSeek(() => session.seek(Math.max(0, duration - EDGE_MARGIN)))
}

function startPoll(): void {
  stopPoll()
  scheduleNextPoll(pollGeneration)
}

/**
 * Point the dashboard at the live feed — but only for an ACTUALLY-live session.
 * F1's feed serves the last finished event's snapshot when nothing is racing, so
 * this is gated on `status.live`; a stale snapshot must never hijack the session.
 * Idempotent: safe to call repeatedly (e.g. from the status listener).
 */
async function loadLiveSession(): Promise<void> {
  if (liveLoaded) return
  const loadVersion = ++liveLoadVersion
  liveLoaded = true
  const session = useSessionStore.getState()
  await session.setProvider('f1live')
  if (loadVersion !== liveLoadVersion) return
  // Let the socket accumulate the initial state snapshot first.
  await new Promise((r) => setTimeout(r, 1500))
  const status = useLiveStore.getState().status
  if (loadVersion !== liveLoadVersion || status?.state !== 'connected' || !status.live) return
  await session.selectSession('live')
  if (loadVersion !== liveLoadVersion) return
  const dur = useSessionStore.getState().duration
  if (dur > 0) followLiveEdge(useSessionStore.getState(), dur)
  startPoll()
}

export const useLiveStore = create<LiveStoreState>((set, get) => ({
  status: null,
  loggedIn: false,
  busy: false,
  notice: null,
  reconnect: null,

  init: () => {
    if (!hasBridge() || unsub) return
    unsub = bridge().f1.onLiveStatus((status) => {
      const previous = get().status
      const wasIntentional = intentionalDisconnect
      const notice = liveNoticeForTransition(previous, status, wasIntentional)
      if (status.state === 'closed') intentionalDisconnect = false
      set({
        status,
        notice:
          notice ?? (status.state === 'connected' && status.subscription ? null : get().notice)
      })
      // Auto-load the moment a genuinely-live session appears — this also catches
      // a session that goes green AFTER we connected to an idle feed.
      if (status.state === 'connected' && status.live) void loadLiveSession()
      if (status.state === 'connected') {
        // Drop any countdown, but keep the attempt count: the counter resets only
        // once this connection has proven stable (see RECONNECT_STABLE_MS).
        cancelReconnect({ keepAttempt: true })
        armStableTimer()
      }
      if (status.state === 'error' || status.state === 'closed') {
        clearStableTimer()
        liveLoadVersion++
        stopPoll()
        liveLoaded = false
        useSessionStore.getState().pause()
        // Never auto-retry a disconnect the user asked for.
        if (wasIntentional) cancelReconnect()
        else scheduleReconnect()
      } else if (status.state === 'connected' && !status.live) {
        const session = useSessionStore.getState()
        if (session.providerId === 'f1live' && session.currentSession?.id === 'live') {
          stopPoll()
          liveLoaded = false
          session.pause()
        }
      }
    })
    void get().refreshLogin()
  },

  openLogin: () => {
    if (hasBridge()) bridge().f1.openLogin()
  },

  refreshLogin: async () => {
    if (!hasBridge()) return
    try {
      set({ loggedIn: await bridge().f1.loginStatus() })
    } catch {
      /* ignore */
    }
  },

  connect: async () => {
    const isAutoRetry = autoRetryInFlight
    autoRetryInFlight = false
    if (!hasBridge() || get().busy) return
    // A connect attempt always supersedes a pending auto-retry. A manual one also
    // restarts the backoff; the timer-driven retry keeps counting.
    cancelReconnect({ keepAttempt: isAutoRetry })
    clearStableTimer()
    intentionalDisconnect = false
    set({ busy: true, notice: null })
    liveLoaded = false
    try {
      const status = await bridge().f1.connectLive()
      set({ status })
      if (status.state === 'connected') armStableTimer()
      // Only take over the dashboard for a genuinely-live session. If the feed is
      // idle (replaying the last finished event) we stay connected and wait — the
      // status listener will auto-load when a session actually goes live.
      if (status.state === 'connected' && status.live) {
        await loadLiveSession()
      }
    } catch (e) {
      const status: LiveStatus = {
        state: 'error',
        detail: errorMessage(e),
        sessionName: null,
        messages: 0,
        subscription: false,
        live: false,
        updatedAt: new Date().toISOString()
      }
      set({ status, notice: liveNoticeForTransition(get().status, status) })
      // This failure was raised directly (e.g. IPC rejection), not via the push
      // status listener, so it needs its own backoff schedule.
      scheduleReconnect()
    } finally {
      set({ busy: false })
    }
  },

  disconnect: () => {
    liveLoadVersion++
    intentionalDisconnect = true
    cancelReconnect()
    clearStableTimer()
    stopPoll()
    liveLoaded = false
    useSessionStore.getState().pause()
    if (hasBridge()) bridge().f1.disconnectLive()
    const cur = get().status
    const status = cur ? { ...cur, state: 'closed' as const, detail: 'disconnected' } : null
    set({
      status,
      notice: status ? liveNoticeForTransition(cur, status, true) : null
    })
  },

  dismissNotice: () => set({ notice: null })
}))
