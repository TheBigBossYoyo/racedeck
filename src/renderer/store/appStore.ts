import { create } from 'zustand'
import type { AppInfo } from '@shared/ipc-contract'
import { hasBridge, bridge } from '@renderer/lib/ipc'

export type Route = 'dashboard' | 'replay' | 'strategy' | 'settings' | 'about'

interface AppStoreState {
  info: AppInfo | null
  maximized: boolean
  route: Route
  ready: boolean
  init: () => Promise<void>
  setRoute: (route: Route) => void
  minimize: () => void
  toggleMaximize: () => void
  close: () => void
  setReady: (v: boolean) => void
}

let unsub: (() => void) | null = null

export const useAppStore = create<AppStoreState>((set) => ({
  info: null,
  maximized: false,
  route: 'dashboard',
  ready: false,

  init: async () => {
    if (!hasBridge()) {
      set({
        info: {
          name: 'RaceDeck',
          version: '0.1.0',
          platform: 'win32',
          electron: 'n/a',
          chrome: 'n/a',
          drmCapable: false,
          drmReady: false,
          isDev: true
        }
      })
      return
    }
    const [info, maximized] = await Promise.all([
      bridge().app.info(),
      bridge().window.isMaximized()
    ])
    unsub?.()
    unsub = bridge().window.onMaximizedChanged((m) => set({ maximized: m }))
    set({ info, maximized })
  },

  setRoute: (route) => set({ route }),
  minimize: () => hasBridge() && bridge().window.minimize(),
  toggleMaximize: () => hasBridge() && bridge().window.toggleMaximize(),
  close: () => hasBridge() && bridge().window.close(),
  setReady: (v) => set({ ready: v })
}))
