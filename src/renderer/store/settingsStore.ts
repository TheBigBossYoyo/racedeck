import { create } from 'zustand'
import { STORE_NS } from '@shared/ipc-contract'
import {
  ACCENT_PRESETS,
  DEFAULT_TOD_URL,
  SYNC_MAX_OFFSET,
  SYNC_MIN_OFFSET
} from '@shared/constants'
import { defaultAiConfig, mergeImportedAi, migrateAiConfig, normalizeAiConfig, type AiConfig } from '@shared/ai'
import { persist } from './persist'
import { describeError, isRecord, writeLogged } from './persistWrite'
import {
  ThemeEngine,
  DEFAULT_THEME,
  type ColorVision,
  type Density,
  type ThemeConfig,
  type ThemeMode
} from '@renderer/core/engines/ThemeEngine'
import { DEFAULT_ALERT_CONFIG, type AlertConfig } from '@renderer/core/engines/AlertEngine'
import { WIDGET_CATALOG, type WidgetKey } from '@renderer/core/engines/LayoutManager'
import { defaultUnitsConfig, normalizeUnitsConfig, type UnitsConfig } from '@renderer/lib/units'
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

function boolOr(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.find((candidate) => candidate === value) ?? fallback
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function normalizeTodPrefs(value?: unknown): TodPrefs {
  const v = isRecord(value) ? value : {}
  return {
    autoFallback: boolOr(v.autoFallback, true),
    url: typeof v.url === 'string' && v.url.trim() !== '' ? v.url : DEFAULT_TOD_URL
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

function normalizeMarketConfig(value: unknown): MarketConfig {
  const v = isRecord(value) ? value : {}
  const base = defaultMarketConfig()
  return {
    enabled: boolOr(v.enabled, base.enabled),
    slugOverride: typeof v.slugOverride === 'string' ? v.slugOverride : base.slugOverride,
    autoRefresh: boolOr(v.autoRefresh, base.autoRefresh)
  }
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

function normalizeVoiceConfig(value?: unknown): VoiceConfig {
  const v = isRecord(value) ? value : {}
  const base = defaultVoiceConfig()
  const rate = finiteNumber(v.rate) ? Math.min(2, Math.max(0.5, v.rate)) : base.rate
  return { enabled: v.enabled === true, rate }
}

const THEME_MODES: readonly ThemeMode[] = ['dark', 'light', 'system']
const DENSITIES: readonly Density[] = ['comfortable', 'compact']
const COLOR_VISIONS: readonly ColorVision[] = ['default', 'deuteranopia', 'protanopia', 'tritanopia']
/** The Settings slider spans 0.85–1.3; this only stops a corrupt value making the UI unusable. */
const FONT_SCALE_MIN = 0.5
const FONT_SCALE_MAX = 2

export function normalizeTheme(value: unknown): ThemeConfig {
  const v = isRecord(value) ? value : {}
  const knownAccent =
    typeof v.accent === 'string' && Object.prototype.hasOwnProperty.call(ACCENT_PRESETS, v.accent)
  return {
    mode: oneOf(v.mode, THEME_MODES, DEFAULT_THEME.mode),
    accent: knownAccent ? (v.accent as string) : DEFAULT_THEME.accent,
    density: oneOf(v.density, DENSITIES, DEFAULT_THEME.density),
    teamColorMode: boolOr(v.teamColorMode, DEFAULT_THEME.teamColorMode),
    reducedMotion: boolOr(v.reducedMotion, DEFAULT_THEME.reducedMotion),
    fontScale: finiteNumber(v.fontScale)
      ? Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, v.fontScale))
      : DEFAULT_THEME.fontScale,
    colorVision: oneOf(v.colorVision, COLOR_VISIONS, DEFAULT_THEME.colorVision)
  }
}

type BooleanAlertKey = Exclude<keyof AlertConfig, 'favorites' | 'intervalThresholdSec'>
const ALERT_FLAG_KEYS = (Object.keys(DEFAULT_ALERT_CONFIG) as (keyof AlertConfig)[]).filter(
  (key): key is BooleanAlertKey => typeof DEFAULT_ALERT_CONFIG[key] === 'boolean'
)

/** The valid alert fields present in `value`, never `favorites` (owned by the favorites list). */
export function normalizeAlertOverrides(value: unknown): Partial<AlertConfig> {
  if (!isRecord(value)) return {}
  const out: Partial<AlertConfig> = {}
  for (const key of ALERT_FLAG_KEYS) {
    const flag = value[key]
    if (typeof flag === 'boolean') out[key] = flag
  }
  const threshold = value.intervalThresholdSec
  if (finiteNumber(threshold) && threshold > 0) out.intervalThresholdSec = threshold
  return out
}

export function normalizeAlerts(value: unknown, favorites: number[]): AlertConfig {
  return { ...DEFAULT_ALERT_CONFIG, ...normalizeAlertOverrides(value), favorites }
}

/** Driver numbers: unique positive integers, anything else dropped. */
export function normalizeFavorites(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  const out: number[] = []
  for (const n of value) {
    if (typeof n === 'number' && Number.isInteger(n) && n > 0 && !out.includes(n)) out.push(n)
  }
  return out
}

export function normalizeModules(value: unknown): ModuleFlags {
  const modules = defaultModules()
  if (!isRecord(value)) return modules
  for (const key of Object.keys(WIDGET_CATALOG) as WidgetKey[]) {
    const flag = value[key]
    if (typeof flag === 'boolean') modules[key] = flag
  }
  return modules
}

export function normalizeSyncPresets(value: unknown): SyncPreset[] {
  if (!Array.isArray(value)) return []
  const out: SyncPreset[] = []
  for (const item of value) {
    if (!isRecord(item)) continue
    const { id, name, offset, broadcaster } = item
    if (typeof id !== 'string' || typeof name !== 'string' || typeof broadcaster !== 'string') continue
    if (!finiteNumber(offset)) continue
    out.push({
      id,
      name,
      offset: Math.min(SYNC_MAX_OFFSET, Math.max(SYNC_MIN_OFFSET, offset)),
      broadcaster
    })
  }
  return out
}

type NormalizedSettings = Pick<
  SettingsState,
  | 'theme'
  | 'alerts'
  | 'favorites'
  | 'tod'
  | 'market'
  | 'voice'
  | 'modules'
  | 'performanceMode'
  | 'syncPresets'
  | 'units'
>

/** The one place persisted or imported JSON becomes trusted settings (AI is handled separately). */
function normalizeSettingsData(raw: Record<string, unknown>): NormalizedSettings {
  const favorites = normalizeFavorites(raw.favorites)
  return {
    theme: normalizeTheme(raw.theme),
    alerts: normalizeAlerts(raw.alerts, favorites),
    favorites,
    tod: normalizeTodPrefs(raw.tod),
    market: normalizeMarketConfig(raw.market),
    voice: normalizeVoiceConfig(raw.voice),
    modules: normalizeModules(raw.modules),
    performanceMode: raw.performanceMode === true,
    syncPresets: normalizeSyncPresets(raw.syncPresets),
    units: normalizeUnitsConfig(isRecord(raw.units) ? (raw.units as Partial<UnitsConfig>) : null)
  }
}

/** Thrown by `importAll` when the settings were applied in memory but could not be saved. */
export class SettingsPersistError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SettingsPersistError'
  }
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
  units: UnitsConfig
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
  setUnits: (patch: Partial<UnitsConfig>) => void
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
  syncPresets: 'syncPresets',
  units: 'units'
}

let aiPersistQueue: Promise<void> = Promise.resolve()

function persistAiConfig(ai: AiConfig): Promise<void> {
  aiPersistQueue = aiPersistQueue
    .catch(() => undefined)
    .then(() => persist.set(STORE_NS.SETTINGS, K.ai, ai))
  return aiPersistQueue
}

function persistImportedSettings(data: NormalizedSettings, ai: AiConfig): Promise<unknown> {
  return Promise.all([
    persist.set(STORE_NS.SETTINGS, K.theme, data.theme),
    persist.set(STORE_NS.ALERTS, K.alerts, data.alerts),
    persist.set(STORE_NS.FAVORITES, K.favorites, data.favorites),
    persist.set(STORE_NS.SETTINGS, K.tod, data.tod),
    persistAiConfig(ai),
    persist.set(STORE_NS.SETTINGS, K.market, data.market),
    persist.set(STORE_NS.SETTINGS, K.voice, data.voice),
    persist.set(STORE_NS.SETTINGS, K.modules, data.modules),
    persist.set(STORE_NS.SETTINGS, K.performance, data.performanceMode),
    persist.set(STORE_NS.SYNC, K.syncPresets, data.syncPresets),
    persist.set(STORE_NS.SETTINGS, K.units, data.units)
  ])
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
  units: defaultUnitsConfig(),
  hydrated: false,

  hydrate: async () => {
    const [
      theme,
      alerts,
      favorites,
      tod,
      ai,
      market,
      voice,
      modules,
      performanceMode,
      syncPresets,
      units
    ] = await Promise.all([
      persist.get<unknown>(STORE_NS.SETTINGS, K.theme),
      persist.get<unknown>(STORE_NS.ALERTS, K.alerts),
      persist.get<unknown>(STORE_NS.FAVORITES, K.favorites),
      persist.get<unknown>(STORE_NS.SETTINGS, K.tod),
      persist.get<unknown>(STORE_NS.SETTINGS, K.ai),
      persist.get<unknown>(STORE_NS.SETTINGS, K.market),
      persist.get<unknown>(STORE_NS.SETTINGS, K.voice),
      persist.get<unknown>(STORE_NS.SETTINGS, K.modules),
      persist.get<unknown>(STORE_NS.SETTINGS, K.performance),
      persist.get<unknown>(STORE_NS.SYNC, K.syncPresets),
      persist.get<unknown>(STORE_NS.SETTINGS, K.units)
    ])
    const data = normalizeSettingsData({
      theme,
      alerts,
      favorites,
      tod,
      market,
      voice,
      modules,
      performanceMode,
      syncPresets,
      units
    })
    set({
      ...data,
      // Retired provider models are rewritten on load — a stored ID the provider
      // no longer serves would otherwise fail every request until noticed by hand.
      ai: migrateAiConfig(normalizeAiConfig(ai)),
      hydrated: true
    })
    ThemeEngine.apply({
      ...data.theme,
      reducedMotion: data.performanceMode || data.theme.reducedMotion
    })
  },

  setTheme: (patch) => {
    const theme = { ...get().theme, ...patch }
    set({ theme })
    ThemeEngine.apply({ ...theme, reducedMotion: get().performanceMode || theme.reducedMotion })
    writeLogged(STORE_NS.SETTINGS, K.theme, theme)
  },

  setAlerts: (patch) => {
    const alerts = { ...get().alerts, ...patch }
    set({ alerts })
    writeLogged(STORE_NS.ALERTS, K.alerts, alerts)
  },

  toggleFavorite: (n) => {
    const cur = get().favorites
    const favorites = cur.includes(n) ? cur.filter((x) => x !== n) : [...cur, n]
    const alerts = { ...get().alerts, favorites }
    set({ favorites, alerts })
    writeLogged(STORE_NS.FAVORITES, K.favorites, favorites)
    writeLogged(STORE_NS.ALERTS, K.alerts, alerts)
  },

  setFavorites: (list) => {
    const alerts = { ...get().alerts, favorites: list }
    set({ favorites: list, alerts })
    writeLogged(STORE_NS.FAVORITES, K.favorites, list)
    writeLogged(STORE_NS.ALERTS, K.alerts, alerts)
  },

  setTod: (patch) => {
    const tod = { ...get().tod, ...patch }
    set({ tod })
    writeLogged(STORE_NS.SETTINGS, K.tod, tod)
  },

  setAi: (patch) => {
    const ai = { ...get().ai, ...patch }
    set({ ai })
    persistAiConfig(ai).catch((error: unknown) => {
      console.error(`[persist] Could not save ${STORE_NS.SETTINGS}:${K.ai} — ${describeError(error)}`)
    })
  },

  saveAi: async () => {
    await persistAiConfig(get().ai)
  },

  setMarket: (patch) => {
    const market = { ...get().market, ...patch }
    set({ market })
    writeLogged(STORE_NS.SETTINGS, K.market, market)
  },

  setVoice: (patch) => {
    const voice = normalizeVoiceConfig({ ...get().voice, ...patch })
    set({ voice })
    writeLogged(STORE_NS.SETTINGS, K.voice, voice)
  },

  setUnits: (patch) => {
    const units = normalizeUnitsConfig({ ...get().units, ...patch })
    set({ units })
    writeLogged(STORE_NS.SETTINGS, K.units, units)
  },

  setModule: (key, on) => {
    const modules = { ...get().modules, [key]: on }
    set({ modules })
    writeLogged(STORE_NS.SETTINGS, K.modules, modules)
  },

  setAllModules: (on) => {
    const modules = { ...get().modules }
    for (const k of Object.keys(modules) as WidgetKey[]) modules[k] = on
    set({ modules })
    writeLogged(STORE_NS.SETTINGS, K.modules, modules)
  },

  setPerformanceMode: (v) => {
    set({ performanceMode: v })
    writeLogged(STORE_NS.SETTINGS, K.performance, v)
    ThemeEngine.apply({ ...get().theme, reducedMotion: v ? true : get().theme.reducedMotion })
  },

  addSyncPreset: (name, offset, broadcaster) => {
    const syncPresets = [...get().syncPresets, { id: nanoid(6), name, offset, broadcaster }]
    set({ syncPresets })
    writeLogged(STORE_NS.SYNC, K.syncPresets, syncPresets)
  },

  removeSyncPreset: (id) => {
    const syncPresets = get().syncPresets.filter((p) => p.id !== id)
    set({ syncPresets })
    writeLogged(STORE_NS.SYNC, K.syncPresets, syncPresets)
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
      syncPresets: s.syncPresets,
      units: s.units
    }
  },

  importAll: async (data) => {
    if (!isRecord(data)) throw new Error('A settings backup must be a JSON object.')
    const normalized = normalizeSettingsData(data)
    // Preserve an existing key if the imported payload omits one (redacted export).
    const importedAi = isRecord(data.ai) ? (data.ai as Partial<AiConfig>) : {}
    await aiPersistQueue.catch(() => undefined)
    const persistedAi = await persist.get<AiConfig>(STORE_NS.SETTINGS, K.ai)
    const ai = mergeImportedAi(importedAi, [get().ai, persistedAi])
    set({ ...normalized, ai })
    ThemeEngine.apply({
      ...normalized.theme,
      reducedMotion: normalized.performanceMode || normalized.theme.reducedMotion
    })
    try {
      await persistImportedSettings(normalized, ai)
    } catch (error) {
      throw new SettingsPersistError(describeError(error))
    }
  }
}))
