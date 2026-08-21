import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  IPC,
  type RaceDeckApi,
  type SetVideoModeRequest,
  type SurfaceBounds
} from '@shared/ipc-contract'
import type { VideoModeState } from '@shared/models'
import type { AiCompletionRequest } from '@shared/ai'
import type { MarketWinnerRequest, MarketHistoryRequest } from '@shared/market'
import type { F1SessionSummary, F1SessionData, F1SessionEnrichmentRequest, F1SessionEnrichmentChunk, F1LiveDataDelta, LiveStatus } from '@shared/f1live'
import type { PracticeBriefRequest } from '@shared/practice'
import type { StandingsRequest } from '@shared/standings'

/**
 * The ONLY bridge between the renderer and Node/Electron. Everything is funneled
 * through explicit, typed IPC channels. No Node globals, no fs, no direct
 * Electron access is exposed to the React app.
 */
const api: RaceDeckApi = {
  app: {
    info: () => ipcRenderer.invoke(IPC.APP_INFO),
    capturePng: (defaultName?: string) => ipcRenderer.invoke(IPC.APP_CAPTURE_PNG, defaultName)
  },
  window: {
    minimize: () => ipcRenderer.send(IPC.WINDOW_MINIMIZE),
    toggleMaximize: () => ipcRenderer.send(IPC.WINDOW_MAXIMIZE_TOGGLE),
    close: () => ipcRenderer.send(IPC.WINDOW_CLOSE),
    isMaximized: () => ipcRenderer.invoke(IPC.WINDOW_IS_MAXIMIZED),
    onMaximizedChanged: (cb: (maximized: boolean) => void) => {
      const listener = (_e: IpcRendererEvent, maximized: boolean) => cb(maximized)
      ipcRenderer.on(IPC.WINDOW_MAXIMIZED_CHANGED, listener)
      return () => ipcRenderer.removeListener(IPC.WINDOW_MAXIMIZED_CHANGED, listener)
    }
  },
  video: {
    getState: () => ipcRenderer.invoke(IPC.VIDEO_GET_STATE),
    setMode: (req: SetVideoModeRequest) => ipcRenderer.invoke(IPC.VIDEO_SET_MODE, req),
    setBounds: (bounds: SurfaceBounds) => ipcRenderer.send(IPC.VIDEO_SET_BOUNDS, bounds),
    setVisible: (visible: boolean) => ipcRenderer.send(IPC.VIDEO_SET_VISIBLE, visible),
    setUrl: (url: string) => ipcRenderer.invoke(IPC.VIDEO_SET_URL, url),
    reload: () => ipcRenderer.send(IPC.VIDEO_RELOAD),
    back: () => ipcRenderer.send(IPC.VIDEO_BACK),
    openExternal: (url?: string) => ipcRenderer.invoke(IPC.VIDEO_OPEN_EXTERNAL, url),
    toggleDevTools: () => ipcRenderer.send(IPC.VIDEO_TOGGLE_DEVTOOLS),
    onStateChanged: (cb: (state: VideoModeState) => void) => {
      const listener = (_e: IpcRendererEvent, state: VideoModeState) => cb(state)
      ipcRenderer.on(IPC.VIDEO_STATE_CHANGED, listener)
      return () => ipcRenderer.removeListener(IPC.VIDEO_STATE_CHANGED, listener)
    }
  },
  ai: {
    complete: (req: AiCompletionRequest) => ipcRenderer.invoke(IPC.AI_COMPLETE, req)
  },
  market: {
    winner: (req: MarketWinnerRequest) => ipcRenderer.invoke(IPC.MARKET_WINNER, req),
    history: (req: MarketHistoryRequest) => ipcRenderer.invoke(IPC.MARKET_HISTORY, req),
    search: (query: string) => ipcRenderer.invoke(IPC.MARKET_SEARCH, query)
  },
  standings: {
    season: (req: StandingsRequest) => ipcRenderer.invoke(IPC.STANDINGS_SEASON, req)
  },
  practice: {
    briefing: (req: PracticeBriefRequest) => ipcRenderer.invoke(IPC.PRACTICE_BRIEFING, req),
    openSource: (url: string) => ipcRenderer.invoke(IPC.PRACTICE_OPEN_SOURCE, url)
  },
  f1: {
    listSessions: (year: number): Promise<F1SessionSummary[]> =>
      ipcRenderer.invoke(IPC.F1_LIST_SESSIONS, year),
    loadSession: (path: string): Promise<F1SessionData> =>
      ipcRenderer.invoke(IPC.F1_LOAD_SESSION, path),
    loadSessionEnrichment: (req: F1SessionEnrichmentRequest): Promise<F1SessionEnrichmentChunk> =>
      ipcRenderer.invoke(IPC.F1_LOAD_SESSION_ENRICHMENT, req),
    openLogin: () => ipcRenderer.send(IPC.F1_OPEN_LOGIN),
    loginStatus: (): Promise<boolean> => ipcRenderer.invoke(IPC.F1_LOGIN_STATUS),
    connectLive: (): Promise<LiveStatus> => ipcRenderer.invoke(IPC.F1_CONNECT_LIVE),
    disconnectLive: () => ipcRenderer.send(IPC.F1_DISCONNECT_LIVE),
    liveStatus: (): Promise<LiveStatus> => ipcRenderer.invoke(IPC.F1_LIVE_STATUS),
    getLive: (cursors?: Record<string, number>, generation?: number): Promise<F1LiveDataDelta | null> =>
      ipcRenderer.invoke(IPC.F1_GET_LIVE, cursors, generation),
    onLiveStatus: (cb: (status: LiveStatus) => void) => {
      const listener = (_e: IpcRendererEvent, status: LiveStatus) => cb(status)
      ipcRenderer.on(IPC.F1_LIVE_STATUS_CHANGED, listener)
      return () => ipcRenderer.removeListener(IPC.F1_LIVE_STATUS_CHANGED, listener)
    }
  },
  store: {
    get: (ns: string, key: string) => ipcRenderer.invoke(IPC.STORE_GET, ns, key),
    set: (ns: string, key: string, value: unknown) =>
      ipcRenderer.invoke(IPC.STORE_SET, ns, key, value),
    delete: (ns: string, key: string) => ipcRenderer.invoke(IPC.STORE_DELETE, ns, key),
    all: (ns: string) => ipcRenderer.invoke(IPC.STORE_ALL, ns),
    clearNamespace: (ns: string) => ipcRenderer.invoke(IPC.STORE_CLEAR_NAMESPACE, ns)
  }
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('racedeck', api)
} else {
  // Fallback for the (discouraged) non-isolated case.
  ;(globalThis as unknown as { racedeck: RaceDeckApi }).racedeck = api
}
