import { create } from 'zustand'
import type { RaceSnapshot } from '@renderer/core/providers/types'
import { AlertEngine, type AlertConfig, type AlertEvent } from '@renderer/core/engines/AlertEngine'

const engine = new AlertEngine()
const MAX_ALERTS = 60

interface AlertStoreState {
  alerts: AlertEvent[]
  muted: boolean
  unseen: number
  ingest: (snapshot: RaceSnapshot) => AlertEvent[]
  setConfig: (config: Partial<AlertConfig>) => void
  dismiss: (id: string) => void
  clear: () => void
  markAllSeen: () => void
  setMuted: (v: boolean) => void
  resetEngine: () => void
}

export const useAlertStore = create<AlertStoreState>((set, get) => ({
  alerts: [],
  muted: false,
  unseen: 0,

  ingest: (snapshot) => {
    const fresh = engine.ingest(snapshot)
    if (fresh.length === 0) return fresh
    if (get().muted) {
      // Still record them, just don't bump the unseen "attention" counter loudly.
      set((s) => ({ alerts: [...fresh.reverse(), ...s.alerts].slice(0, MAX_ALERTS) }))
      return fresh
    }
    set((s) => ({
      alerts: [...fresh.slice().reverse(), ...s.alerts].slice(0, MAX_ALERTS),
      unseen: s.unseen + fresh.length
    }))
    return fresh
  },

  setConfig: (config) => engine.setConfig(config),

  dismiss: (id) => set((s) => ({ alerts: s.alerts.filter((a) => a.id !== id) })),

  clear: () => set({ alerts: [], unseen: 0 }),

  markAllSeen: () => set({ unseen: 0 }),

  setMuted: (v) => set({ muted: v }),

  resetEngine: () => {
    engine.reset()
    set({ alerts: [], unseen: 0 })
  }
}))

export { engine as alertEngine }
