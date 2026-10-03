import { create } from 'zustand'
import { nanoid } from 'nanoid'
import { STORE_NS } from '@shared/ipc-contract'
import { persist } from './persist'
import { isRecord, writeLogged } from './persistWrite'
import { PLUGIN_FEEDS, type PluginFeed } from '@renderer/core/engines/PluginSnapshotApi'

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

function isPluginFeed(value: unknown): value is PluginFeed {
  return PLUGIN_FEEDS.some((feed) => feed === value)
}

function sanitizePlugin(value: unknown): SavedPlugin | null {
  if (!isRecord(value)) return null
  const { id, name, source, requiredFeeds } = value
  if (typeof id !== 'string' || typeof name !== 'string' || typeof source !== 'string') return null
  if (!Array.isArray(requiredFeeds)) return null
  return { id, name, source, requiredFeeds: requiredFeeds.filter(isPluginFeed) }
}

/** One damaged entry must not cost the user every other saved plugin. */
function sanitizePlugins(raw: unknown): SavedPlugin[] {
  if (!Array.isArray(raw)) return []
  return raw.map(sanitizePlugin).filter((p): p is SavedPlugin => p !== null)
}

export const usePluginStore = create<PluginState>((set, get) => ({
  plugins: [],
  hydrated: false,

  hydrate: async () => {
    const raw = await persist.get<unknown>(STORE_NS.PLUGINS, K.entries)
    set({ plugins: sanitizePlugins(raw), hydrated: true })
  },

  add: (name, source, requiredFeeds) => {
    const plugins = [...get().plugins, { id: nanoid(8), name, source, requiredFeeds }]
    set({ plugins })
    writeLogged(STORE_NS.PLUGINS, K.entries, plugins)
  },

  remove: (id) => {
    const plugins = get().plugins.filter((p) => p.id !== id)
    set({ plugins })
    writeLogged(STORE_NS.PLUGINS, K.entries, plugins)
  }
}))
