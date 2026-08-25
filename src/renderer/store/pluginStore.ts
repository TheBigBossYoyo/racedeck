import { create } from 'zustand'
import { nanoid } from 'nanoid'
import { STORE_NS } from '@shared/ipc-contract'
import { persist } from './persist'
import type { PluginFeed } from '@renderer/core/engines/PluginSnapshotApi'

/**
 * Saved local plugin scripts (APP_IMPROVEMENT_ROADMAP.md P3 item 36). Only
 * plain strings/arrays are persisted — source code and its declared feeds —
 * mirroring `settingsStore.syncPresets`'s single-array persistence.
 */
export interface SavedPlugin {
  id: string
  name: string
  source: string
  requiredFeeds: PluginFeed[]
}

interface PluginState {
  plugins: SavedPlugin[]
  hydrated: boolean

  hydrate: () => Promise<void>
  add: (name: string, source: string, requiredFeeds: PluginFeed[]) => void
  remove: (id: string) => void
}

const K = { entries: 'entries' }

function isSavedPluginArray(v: unknown): v is SavedPlugin[] {
  return (
    Array.isArray(v) &&
    v.every(
      (p) =>
        p &&
        typeof p === 'object' &&
        typeof p.id === 'string' &&
        typeof p.name === 'string' &&
        typeof p.source === 'string' &&
        Array.isArray(p.requiredFeeds)
    )
  )
}

export const usePluginStore = create<PluginState>((set, get) => ({
  plugins: [],
  hydrated: false,

  hydrate: async () => {
    const raw = await persist.get<unknown>(STORE_NS.PLUGINS, K.entries)
    set({ plugins: isSavedPluginArray(raw) ? raw : [], hydrated: true })
  },

  add: (name, source, requiredFeeds) => {
    const plugins = [...get().plugins, { id: nanoid(8), name, source, requiredFeeds }]
    set({ plugins })
    void persist.set(STORE_NS.PLUGINS, K.entries, plugins)
  },

  remove: (id) => {
    const plugins = get().plugins.filter((p) => p.id !== id)
    set({ plugins })
    void persist.set(STORE_NS.PLUGINS, K.entries, plugins)
  }
}))
