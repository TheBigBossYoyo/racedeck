import { create } from 'zustand'
import type { SessionType } from '@shared/models'
import { STORE_NS } from '@shared/ipc-contract'
import { persist } from './persist'
import { useSettingsStore } from './settingsStore'
import { useLayoutStore } from './layoutStore'
import {
  createRaceWatchProfile,
  type RaceWatchProfile
} from '@renderer/core/engines/RaceWatchProfile'

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

export const useProfileStore = create<ProfileState>((set, get) => ({
  profiles: {},
  autoApply: true,
  hydrated: false,

  hydrate: async () => {
    const [profiles, autoApply] = await Promise.all([
      persist.get<Partial<Record<SessionType, RaceWatchProfile>>>(STORE_NS.PROFILES, K.all),
      persist.get<boolean>(STORE_NS.PROFILES, K.autoApply)
    ])
    set({ profiles: profiles ?? {}, autoApply: autoApply ?? true, hydrated: true })
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
    void persist.set(STORE_NS.PROFILES, K.all, profiles)
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
    void persist.set(STORE_NS.PROFILES, K.all, profiles)
  },

  setAutoApply: (v) => {
    set({ autoApply: v })
    void persist.set(STORE_NS.PROFILES, K.autoApply, v)
  }
}))
