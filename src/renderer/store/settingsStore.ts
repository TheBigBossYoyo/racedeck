import { create } from 'zustand'
import { STORE_NS } from '@shared/ipc-contract'
import { DEFAULT_TOD_URL } from '@shared/constants'
import { defaultAiConfig, type AiConfig } from '@shared/ai'
import { persist } from './persist'
import { ThemeEngine, DEFAULT_THEME, type ThemeConfig } from '@renderer/core/engines/ThemeEngine'
import { DEFAULT_ALERT_CONFIG, type AlertConfig } from '@renderer/core/engines/AlertEngine'
import { WIDGET_CATALOG, type WidgetKey } from '@renderer/core/engines/LayoutManager'
import { nanoid } from 'nanoid'

/** Per-module on/off flags. Absent key = enabled (the TOD video is always on). */
export type ModuleFlags = Partial<Record<WidgetKey, boolean>>

function defaultModules(): ModuleFlags {
  const m: ModuleFlags = {}
  for (const k of Object.keys(WIDGET_CATALOG) as WidgetKey[]) {
    if (k !== 'tod-video') m[k] = true
  }
  return m
}

/** A module renders unless explicitly disabled. */
export function isModuleEnabled(modules: ModuleFlags, key: WidgetKey): boolean {
  return modules[key] !== false
}

export interface SyncPreset {
  id: string
  name: string
  offset: number
  broadcaster: string
}

export interface TodPrefs {
  autoFallback: boolean
  url: string
}

export function normalizeTodPrefs(value?: Partial<TodPrefs> | null): TodPrefs {
  return {
    autoFallback: value?.autoFallback ?? true,
    url: value?.url ?? DEFAULT_TOD_URL
  }
}

/** Public prediction-market (Polymarket) overlay preferences. Opt-in. */
export interface MarketConfig {
  /** Master switch — off by default (external third-party data source). */
  enabled: boolean
  /** Exact event slug/URL to pin, when auto-match by GP name is wrong. */
  slugOverride: string
  /** Poll for fresh odds while a live session is playing. */
  autoRefresh: boolean
}

export function defaultMarketConfig(): MarketConfig {
  return { enabled: false, slugOverride: '', autoRefresh: true }
}

/** Voice read-out preferences for the proactive Engineer's Notes. Opt-in. */
export interface VoiceConfig {
  /** Master switch — off by default (speaks high-priority notes aloud). */
  enabled: boolean
  /** Speech rate multiplier (0.5–2). */
  rate: number
}

export function defaultVoiceConfig(): VoiceConfig {
  return { enabled: false, rate: 1 }
}

function normalizeVoiceConfig(value?: Partial<VoiceConfig> | null): VoiceConfig {
  const base = defaultVoiceConfig()
  const rate = typeof value?.rate === 'number' && Number.isFinite(value.rate)
    ? Math.min(2, Math.max(0.5, value.rate))
    : base.rate
  return { enabled: Boolean(value?.enabled), rate }
}

interface SettingsState {
  theme: ThemeConfig
  alerts: AlertConfig
  favorites: number[]
  tod: TodPrefs
  ai: AiConfig
  market: MarketConfig
  voice: VoiceConfig
  modules: ModuleFlags
  performanceMode: boolean
  syncPresets: SyncPreset[]
  hydrated: boolean

  hydrate: () => Promise<void>
  setTheme: (patch: Partial<ThemeConfig>) => void
  setAlerts: (patch: Partial<AlertConfig>) => void
  toggleFavorite: (n: number) => void
  setFavorites: (list: number[]) => void
  setTod: (patch: Partial<TodPrefs>) => void
  setAi: (patch: Partial<AiConfig>) => void
  saveAi: () => Promise<void>
  setMarket: (patch: Partial<MarketConfig>) => void
  setVoice: (patch: Partial<VoiceConfig>) => void
  setModule: (key: WidgetKey, on: boolean) => void
  setAllModules: (on: boolean) => void
  setPerformanceMode: (v: boolean) => void
  addSyncPreset: (name: string, offset: number, broadcaster: string) => void
  removeSyncPreset: (id: string) => void
  exportAll: (opts?: { includeSecrets?: boolean }) => Record<string, unknown>
  importAll: (data: Record<string, unknown>) => Promise<void>
}

const K = {
  theme: 'theme',
  alerts: 'alerts',
  favorites: 'favorites',
  tod: 'tod',
  ai: 'ai',
  market: 'market',
  voice: 'voice',
  modules: 'modules',
  performance: 'performanceMode',
  syncPresets: 'syncPresets'
}

let aiPersistQueue: Promise<void> = Promise.resolve()

function persistAiConfig(ai: AiConfig): Promise<void> {
  aiPersistQueue = aiPersistQueue
    .catch(() => undefined)
    .then(() => persist.set(STORE_NS.SETTINGS, K.ai, ai))
  return aiPersistQueue
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  theme: DEFAULT_THEME,
  alerts: DEFAULT_ALERT_CONFIG,
  favorites: [],
  tod: normalizeTodPrefs(),
  ai: defaultAiConfig(),
  market: defaultMarketConfig(),
  voice: defaultVoiceConfig(),
  modules: defaultModules(),
  performanceMode: false,
  syncPresets: [],
  hydrated: false,

  hydrate: async () => {
    const [theme, alerts, favorites, tod, ai, market, voice, modules, performanceMode, syncPresets] =
      await Promise.all([
        persist.get<ThemeConfig>(STORE_NS.SETTINGS, K.theme),
        persist.get<AlertConfig>(STORE_NS.ALERTS, K.alerts),
        persist.get<number[]>(STORE_NS.FAVORITES, K.favorites),
        persist.get<TodPrefs>(STORE_NS.SETTINGS, K.tod),
        persist.get<AiConfig>(STORE_NS.SETTINGS, K.ai),
        persist.get<MarketConfig>(STORE_NS.SETTINGS, K.market),
        persist.get<VoiceConfig>(STORE_NS.SETTINGS, K.voice),
        persist.get<ModuleFlags>(STORE_NS.SETTINGS, K.modules),
        persist.get<boolean>(STORE_NS.SETTINGS, K.performance),
        persist.get<SyncPreset[]>(STORE_NS.SYNC, K.syncPresets)
      ])
    const mergedTheme = { ...DEFAULT_THEME, ...(theme ?? {}) }
    const mergedFavorites = favorites ?? []
    set({
      theme: mergedTheme,
      alerts: { ...DEFAULT_ALERT_CONFIG, ...(alerts ?? {}), favorites: mergedFavorites },
      favorites: mergedFavorites,
      tod: normalizeTodPrefs(tod),
      ai: { ...defaultAiConfig(), ...(ai ?? {}) },
      market: { ...defaultMarketConfig(), ...(market ?? {}) },
      voice: normalizeVoiceConfig(voice),
      modules: { ...defaultModules(), ...(modules ?? {}) },
      performanceMode: performanceMode ?? false,
      syncPresets: syncPresets ?? [],
      hydrated: true
    })
    ThemeEngine.apply({ ...mergedTheme, reducedMotion: (performanceMode ?? false) || mergedTheme.reducedMotion })
  },

  setTheme: (patch) => {
    const theme = { ...get().theme, ...patch }
    set({ theme })
    ThemeEngine.apply({ ...theme, reducedMotion: get().performanceMode || theme.reducedMotion })
    void persist.set(STORE_NS.SETTINGS, K.theme, theme)
  },

  setAlerts: (patch) => {
    const alerts = { ...get().alerts, ...patch }
    set({ alerts })
    void persist.set(STORE_NS.ALERTS, K.alerts, alerts)
  },

  toggleFavorite: (n) => {
    const cur = get().favorites
    const favorites = cur.includes(n) ? cur.filter((x) => x !== n) : [...cur, n]
    const alerts = { ...get().alerts, favorites }
    set({ favorites, alerts })
    void persist.set(STORE_NS.FAVORITES, K.favorites, favorites)
    void persist.set(STORE_NS.ALERTS, K.alerts, alerts)
  },

  setFavorites: (list) => {
    const alerts = { ...get().alerts, favorites: list }
    set({ favorites: list, alerts })
    void persist.set(STORE_NS.FAVORITES, K.favorites, list)
    void persist.set(STORE_NS.ALERTS, K.alerts, alerts)
  },

  setTod: (patch) => {
    const tod = { ...get().tod, ...patch }
    set({ tod })
    void persist.set(STORE_NS.SETTINGS, K.tod, tod)
  },

  setAi: (patch) => {
    const ai = { ...get().ai, ...patch }
    set({ ai })
    void persistAiConfig(ai)
  },

  saveAi: async () => {
    await persistAiConfig(get().ai)
  },

  setMarket: (patch) => {
    const market = { ...get().market, ...patch }
    set({ market })
    void persist.set(STORE_NS.SETTINGS, K.market, market)
  },

  setVoice: (patch) => {
    const voice = normalizeVoiceConfig({ ...get().voice, ...patch })
    set({ voice })
    void persist.set(STORE_NS.SETTINGS, K.voice, voice)
  },

  setModule: (key, on) => {
    const modules = { ...get().modules, [key]: on }
    set({ modules })
    void persist.set(STORE_NS.SETTINGS, K.modules, modules)
  },

  setAllModules: (on) => {
    const modules = { ...get().modules }
    for (const k of Object.keys(modules) as WidgetKey[]) modules[k] = on
    set({ modules })
    void persist.set(STORE_NS.SETTINGS, K.modules, modules)
  },

  setPerformanceMode: (v) => {
    set({ performanceMode: v })
    void persist.set(STORE_NS.SETTINGS, K.performance, v)
    ThemeEngine.apply({ ...get().theme, reducedMotion: v ? true : get().theme.reducedMotion })
  },

  addSyncPreset: (name, offset, broadcaster) => {
    const syncPresets = [...get().syncPresets, { id: nanoid(6), name, offset, broadcaster }]
    set({ syncPresets })
    void persist.set(STORE_NS.SYNC, K.syncPresets, syncPresets)
  },

  removeSyncPreset: (id) => {
    const syncPresets = get().syncPresets.filter((p) => p.id !== id)
    set({ syncPresets })
    void persist.set(STORE_NS.SYNC, K.syncPresets, syncPresets)
  },

  exportAll: (opts) => {
    const s = get()
    // Redact the API key from exports by default (it's a secret). The rest of
    // the AI config (provider/model/base URL) is safe and useful to carry over.
    const ai = opts?.includeSecrets ? s.ai : { ...s.ai, apiKey: '' }
    return {
      theme: s.theme,
      alerts: s.alerts,
      favorites: s.favorites,
      tod: s.tod,
      ai,
      market: s.market,
      voice: s.voice,
      modules: s.modules,
      performanceMode: s.performanceMode,
      syncPresets: s.syncPresets
    }
  },

  importAll: async (data) => {
    const theme = { ...DEFAULT_THEME, ...((data.theme as ThemeConfig) ?? {}) }
    const favorites = (data.favorites as number[]) ?? []
    const alerts = { ...DEFAULT_ALERT_CONFIG, ...((data.alerts as AlertConfig) ?? {}), favorites }
    const tod = normalizeTodPrefs(data.tod as Partial<TodPrefs>)
    // Preserve an existing key if the imported payload omits one (redacted export).
    const importedAi = (data.ai as Partial<AiConfig>) ?? {}
    await aiPersistQueue.catch(() => undefined)
    const persistedAi = await persist.get<AiConfig>(STORE_NS.SETTINGS, K.ai)
    const ai = {
      ...defaultAiConfig(),
      ...importedAi,
      apiKey: importedAi.apiKey || get().ai.apiKey || persistedAi?.apiKey || ''
    }
    const market = { ...defaultMarketConfig(), ...((data.market as Partial<MarketConfig>) ?? {}) }
    const voice = normalizeVoiceConfig(data.voice as Partial<VoiceConfig>)
    const modules = { ...defaultModules(), ...((data.modules as ModuleFlags) ?? {}) }
    const performanceMode = Boolean(data.performanceMode)
    const syncPresets = (data.syncPresets as SyncPreset[]) ?? []
    set({ theme, alerts, favorites, tod, ai, market, voice, modules, performanceMode, syncPresets })
    ThemeEngine.apply({ ...theme, reducedMotion: performanceMode || theme.reducedMotion })
    await Promise.all([
      persist.set(STORE_NS.SETTINGS, K.theme, theme),
      persist.set(STORE_NS.ALERTS, K.alerts, alerts),
      persist.set(STORE_NS.FAVORITES, K.favorites, favorites),
      persist.set(STORE_NS.SETTINGS, K.tod, tod),
      persistAiConfig(ai),
      persist.set(STORE_NS.SETTINGS, K.market, market),
      persist.set(STORE_NS.SETTINGS, K.voice, voice),
      persist.set(STORE_NS.SETTINGS, K.modules, modules),
      persist.set(STORE_NS.SETTINGS, K.performance, performanceMode),
      persist.set(STORE_NS.SYNC, K.syncPresets, syncPresets)
    ])
  }
}))
