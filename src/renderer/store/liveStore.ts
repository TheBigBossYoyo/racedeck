import { create } from 'zustand'
import type { LiveStatus } from '@shared/f1live'
import { hasBridge, bridge } from '@renderer/lib/ipc'
import { useSessionStore } from './sessionStore'

/**
 * liveStore — orchestrates the LIVE F1 timing connection: the in-app F1 sign-in,
 * the SignalR connect, live status, and a poll that extends the growing live
 * timeline and keeps the dashboard pinned to the live edge. The heavy lifting
 * (auth + socket) is in the main process; this just drives it and feeds the
 * F1LiveProvider via the session store.
 */

const POLL_MS = 4000
const EDGE_MARGIN = 2 // stay ~2s behind the very edge so data is complete

let poll: ReturnType<typeof setInterval> | null = null
let unsub: (() => void) | null = null
/** Guard so we load the live session exactly once per connection (idempotent). */
let liveLoaded = false
let intentionalDisconnect = false
let liveLoadVersion = 0

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
      detail: 'Sign in again to restore car telemetry & positions. Public timing continues meanwhile.'
    }
  }
  if (next.state === 'error') {
    return {
      tone: 'danger',
      title: 'F1 Live connection error',
      detail: next.detail || 'The live timing connection failed. Retry when your connection is available.'
    }
  }
  if (next.state === 'closed' && (previous?.state === 'connected' || previous?.state === 'connecting')) {
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
  init: () => void
  openLogin: () => void
  refreshLogin: () => Promise<void>
  connect: () => Promise<void>
  disconnect: () => void
  dismissNotice: () => void
}

function stopPoll(): void {
  if (poll) {
    clearInterval(poll)
    poll = null
  }
}

function startPoll(): void {
  stopPoll()
  poll = setInterval(() => {
    const live = useLiveStore.getState().status
    const s = useSessionStore.getState()
    if (
      live?.state !== 'connected' ||
      !live.live ||
      s.providerId !== 'f1live' ||
      s.currentSession?.id !== 'live'
    ) {
      stopPoll()
      liveLoaded = false
      return
    }
    void s.reloadSession().then((updated) => {
      if (!updated) return
      const dur = useSessionStore.getState().duration
      if (dur > 0) useSessionStore.getState().seek(Math.max(0, dur - EDGE_MARGIN))
    })
  }, POLL_MS)
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
  if (dur > 0) useSessionStore.getState().seek(Math.max(0, dur - EDGE_MARGIN))
  startPoll()
}

export const useLiveStore = create<LiveStoreState>((set, get) => ({
  status: null,
  loggedIn: false,
  busy: false,
  notice: null,

  init: () => {
    if (!hasBridge() || unsub) return
    unsub = bridge().f1.onLiveStatus((status) => {
      const previous = get().status
      const notice = liveNoticeForTransition(previous, status, intentionalDisconnect)
      if (status.state === 'closed') intentionalDisconnect = false
      set({
        status,
        notice:
          notice ??
          (status.state === 'connected' && status.subscription ? null : get().notice)
      })
      // Auto-load the moment a genuinely-live session appears — this also catches
      // a session that goes green AFTER we connected to an idle feed.
      if (status.state === 'connected' && status.live) void loadLiveSession()
      if (status.state === 'error' || status.state === 'closed') {
        liveLoadVersion++
        stopPoll()
        liveLoaded = false
        useSessionStore.getState().pause()
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
    if (!hasBridge() || get().busy) return
    intentionalDisconnect = false
    set({ busy: true, notice: null })
    liveLoaded = false
    try {
      const status = await bridge().f1.connectLive()
      set({ status })
      // Only take over the dashboard for a genuinely-live session. If the feed is
      // idle (replaying the last finished event) we stay connected and wait — the
      // status listener will auto-load when a session actually goes live.
      if (status.state === 'connected' && status.live) {
        await loadLiveSession()
      }
    } catch (e) {
      const status: LiveStatus = {
          state: 'error',
          detail: (e as Error).message,
          sessionName: null,
          messages: 0,
          subscription: false,
          live: false,
          updatedAt: new Date().toISOString()
        }
      set({ status, notice: liveNoticeForTransition(get().status, status) })
    } finally {
      set({ busy: false })
    }
  },

  disconnect: () => {
    liveLoadVersion++
    intentionalDisconnect = true
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
