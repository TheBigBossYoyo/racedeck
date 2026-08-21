import { create } from 'zustand'
import { STORE_NS } from '@shared/ipc-contract'
import type { RaceControlMessage, SyncState } from '@shared/models'
import { persist } from './persist'
import {
  SessionSyncEngine,
  type SyncCandidate,
  type SyncEventType
} from '@renderer/core/engines/SessionSyncEngine'

const engine = new SessionSyncEngine()
let syncReadVersion = 0

interface SyncStoreState {
  sync: SyncState
  candidates: SyncCandidate[]
  wizardEvent: SyncEventType
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
  wizardEvent: 'safety-car',

  hydrate: async () => {
    const readVersion = ++syncReadVersion
    const b = engine.getState().broadcaster
    const saved = await persist.get<number>(STORE_NS.SYNC, syncOffsetKey(b, null))
    if (readVersion !== syncReadVersion || engine.getState().broadcaster !== b) return
    if (typeof saved === 'number') engine.setOffset(saved)
    set({ sync: engine.getState() })
  },

  setOffset: (seconds) => {
    syncReadVersion++
    const sync = engine.setOffset(seconds)
    set({ sync })
    void persist.set(STORE_NS.SYNC, syncOffsetKey(sync.broadcaster, sync.scopeKey), sync.offsetSeconds)
  },

  nudge: (delta) => {
    syncReadVersion++
    const sync = engine.nudge(delta)
    set({ sync })
    void persist.set(STORE_NS.SYNC, syncOffsetKey(sync.broadcaster, sync.scopeKey), sync.offsetSeconds)
  },

  setBroadcaster: async (b) => {
    const readVersion = ++syncReadVersion
    engine.setBroadcaster(b)
    const scopeKey = engine.getState().scopeKey
    const saved = await persist.get<number>(STORE_NS.SYNC, syncOffsetKey(b, scopeKey))
    const current = engine.getState()
    if (
      readVersion !== syncReadVersion ||
      current.broadcaster !== b ||
      current.scopeKey !== scopeKey
    ) return
    if (typeof saved === 'number') engine.setOffset(saved)
    else engine.setOffset(0)
    set({ sync: engine.getState() })
  },

  setScope: async (scopeKey) => {
    const readVersion = ++syncReadVersion
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
    ) return
    if (typeof scoped === 'number') engine.setOffset(scoped)
    else engine.setOffset(0)
    set({ sync: engine.getState(), candidates: [] })
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

  clearCandidates: () => set({ candidates: [] })
}))

export function currentSyncOffset(): number {
  return engine.getState().offsetSeconds
}
