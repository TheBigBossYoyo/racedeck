import { create } from 'zustand'
import type { VideoMode, VideoModeState } from '@shared/models'
import type { SurfaceBounds } from '@shared/ipc-contract'
import { DEFAULT_TOD_URL } from '@shared/constants'
import { decideInitialMode } from '@shared/video-fallback'
import { hasBridge, bridge } from '@renderer/lib/ipc'
import { useSettingsStore } from './settingsStore'

const initialState: VideoModeState = {
  mode: 'none',
  url: DEFAULT_TOD_URL,
  playbackActive: 'unknown',
  embeddedSupported: 'unknown',
  fallbackReason: null,
  drmReady: false,
  lastEvent: null,
  updatedAt: new Date().toISOString()
}

interface VideoStoreState {
  state: VideoModeState
  connected: boolean
  /** Whether the mounted embedded panel wants the surface shown. */
  surfaceVisibleWanted: boolean
  /** True while a renderer overlay (dialog/menu) is covering the surface. */
  surfaceSuppressed: boolean
  connect: () => void
  refresh: () => Promise<void>
  activate: (mode?: VideoMode) => Promise<void>
  setMode: (mode: VideoMode, bounds?: SurfaceBounds) => Promise<void>
  applyBounds: (bounds: SurfaceBounds) => void
  setVisible: (visible: boolean) => void
  /** Hide the native TOD view while an overlay is open (it paints above the DOM). */
  setSurfaceSuppressed: (suppressed: boolean) => void
  setUrl: (url: string) => Promise<void>
  reload: () => void
  back: () => void
  openExternal: (url?: string) => void
  toggleDevTools: () => void
}

let unsubscribe: (() => void) | null = null

/**
 * The native WebContentsView is only shown when the panel wants it AND no
 * overlay is covering it. Because the view always paints above the web contents,
 * any open dialog/dropdown would otherwise be hidden behind the video.
 */
function reconcileSurface(get: () => VideoStoreState): void {
  if (!hasBridge()) return
  const { surfaceVisibleWanted, surfaceSuppressed } = get()
  bridge().video.setVisible(surfaceVisibleWanted && !surfaceSuppressed)
}

export const useVideoStore = create<VideoStoreState>((set, get) => ({
  state: initialState,
  connected: false,
  surfaceVisibleWanted: false,
  surfaceSuppressed: false,

  connect: () => {
    if (!hasBridge() || get().connected) return
    unsubscribe?.()
    unsubscribe = bridge().video.onStateChanged((state) => set({ state }))
    set({ connected: true })
    void get().refresh()
  },

  refresh: async () => {
    if (!hasBridge()) return
    const state = await bridge().video.getState()
    set({ state })
  },

  activate: async (mode) => {
    let videoState = get().state
    if (hasBridge()) {
      videoState = await bridge().video.getState()
      set({ state: videoState })
    }
    const target = mode ?? decideInitialMode(videoState.drmReady)
    await get().setMode(target)
  },

  setMode: async (mode, bounds) => {
    if (!hasBridge()) {
      // Browser/test fallback: reflect the request locally.
      set({ state: { ...get().state, mode, updatedAt: new Date().toISOString() } })
      return
    }
    const prefs = useSettingsStore.getState().tod
    const state = await bridge().video.setMode({
      mode,
      url: prefs.url,
      bounds,
      autoFallback: prefs.autoFallback
    })
    set({ state })
  },

  applyBounds: (bounds) => {
    if (hasBridge()) bridge().video.setBounds(bounds)
  },

  setVisible: (visible) => {
    set({ surfaceVisibleWanted: visible })
    reconcileSurface(get)
  },

  setSurfaceSuppressed: (suppressed) => {
    if (get().surfaceSuppressed === suppressed) return
    set({ surfaceSuppressed: suppressed })
    reconcileSurface(get)
  },

  setUrl: async (url) => {
    if (!hasBridge()) return
    const state = await bridge().video.setUrl(url)
    set({ state })
  },

  reload: () => hasBridge() && bridge().video.reload(),
  back: () => hasBridge() && bridge().video.back(),
  openExternal: (url) => hasBridge() && void bridge().video.openExternal(url),
  toggleDevTools: () => hasBridge() && bridge().video.toggleDevTools()
}))
