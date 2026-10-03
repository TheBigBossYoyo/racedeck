import { create } from 'zustand'
import type { SessionType } from '@shared/models'
import { STORE_NS } from '@shared/ipc-contract'
import { persist } from './persist'
import { isRecord, writeLogged } from './persistWrite'
import { useSettingsStore, normalizeAlertOverrides, normalizeFavorites } from './settingsStore'
import { useLayoutStore } from './layoutStore'
import {
  createRaceWatchProfile,
  sanitizeAlertOverrides,
  type RaceWatchProfile
} from '@renderer/core/engines/RaceWatchProfile'
import { LAYOUT_PRESETS, type LayoutId } from '@renderer/core/engines/LayoutManager'

/**
 * Personalized race-watch profiles (APP_IMPROVEMENT_ROADMAP.md P3 item 33).
 * `applyProfile` only ever calls the *existing* settings/layout actions
 * (`setFavorites`, `setLayout`/`loadSaved`, `setAlerts`) — it never mutates
 * state directly, so a profile can't do anything a manual settings change
 * couldn't already do. `alertOverrides` on a stored profile is always
 * pre-sanitized by `RaceWatchProfile.ts`, so critical alert categories are
 * never part of the patch `setAlerts` receives here.
 */

interface ProfileState {
  profiles: Partial<Record<SessionType, RaceWatchProfile>>
  autoApply: boolean
  hydrated: boolean

  hydrate: () => Promise<void>
  saveCurrentAsProfile: (sessionType: SessionType) => void
  applyProfile: (sessionType: SessionType) => void
  hasProfile: (sessionType: SessionType) => boolean
  removeProfile: (sessionType: SessionType) => void
  setAutoApply: (v: boolean) => void
}

const K = { all: 'all', autoApply: 'autoApply' }

const SESSION_TYPES: readonly SessionType[] = [
  'practice',
  'qualifying',
  'sprint-qualifying',
  'sprint',
  'race',
  'testing',
  'unknown'
]

function isPresetId(value: unknown): value is LayoutId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(LAYOUT_PRESETS, value)
}

/**
 * A profile missing its favourites or alert overrides is dropped rather than
 * repaired: applying a half-empty one would wipe the user's real favourites.
 * Critical alert keys are stripped again here, so a hand-edited file can't
 * smuggle a "hide red flags" override past `sanitizeAlertOverrides`.
 */
function sanitizeProfile(sessionType: SessionType, value: unknown): RaceWatchProfile | null {
  if (!isRecord(value)) return null
  if (!Array.isArray(value.favoriteDrivers) || !isRecord(value.alertOverrides)) return null
  return {
    sessionType,
    favoriteDrivers: normalizeFavorites(value.favoriteDrivers),
    layoutId: isPresetId(value.layoutId) ? value.layoutId : null,
    savedLayoutId: typeof value.savedLayoutId === 'string' ? value.savedLayoutId : null,
    alertOverrides: sanitizeAlertOverrides(normalizeAlertOverrides(value.alertOverrides))
  }
}

function sanitizeProfiles(raw: unknown): Partial<Record<SessionType, RaceWatchProfile>> {
  if (!isRecord(raw)) return {}
  const out: Partial<Record<SessionType, RaceWatchProfile>> = {}
  for (const type of SESSION_TYPES) {
    const profile = sanitizeProfile(type, raw[type])
    if (profile) out[type] = profile
  }
  return out
}

export const useProfileStore = create<ProfileState>((set, get) => ({
  profiles: {},
  autoApply: true,
  hydrated: false,

  hydrate: async () => {
    const [profiles, autoApply] = await Promise.all([
      persist.get<unknown>(STORE_NS.PROFILES, K.all),
      persist.get<unknown>(STORE_NS.PROFILES, K.autoApply)
    ])
    set({
      profiles: sanitizeProfiles(profiles),
      autoApply: typeof autoApply === 'boolean' ? autoApply : true,
      hydrated: true
    })
  },

  saveCurrentAsProfile: (sessionType) => {
    const settings = useSettingsStore.getState()
    const layout = useLayoutStore.getState()
    const profile = createRaceWatchProfile(
      sessionType,
      settings.favorites,
      layout.activeSavedId ? null : layout.currentLayoutId,
      layout.activeSavedId,
      settings.alerts
    )
    const profiles = { ...get().profiles, [sessionType]: profile }
    set({ profiles })
    writeLogged(STORE_NS.PROFILES, K.all, profiles)
  },

  applyProfile: (sessionType) => {
    const profile = get().profiles[sessionType]
    if (!profile) return
    useSettingsStore.getState().setFavorites(profile.favoriteDrivers)
    if (profile.savedLayoutId) useLayoutStore.getState().loadSaved(profile.savedLayoutId)
    else if (profile.layoutId) useLayoutStore.getState().setLayout(profile.layoutId)
    useSettingsStore.getState().setAlerts(profile.alertOverrides)
  },

  hasProfile: (sessionType) => sessionType in get().profiles,

  removeProfile: (sessionType) => {
    const profiles = { ...get().profiles }
    delete profiles[sessionType]
    set({ profiles })
    writeLogged(STORE_NS.PROFILES, K.all, profiles)
  },

  setAutoApply: (v) => {
    set({ autoApply: v })
    writeLogged(STORE_NS.PROFILES, K.autoApply, v)
  }
}))
