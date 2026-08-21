import type { VideoMode, VideoModeState } from './models'
import type { AiCompletionRequest, AiCompletionResult } from './ai'
import type {
  MarketWinnerRequest,
  MarketWinnerResult,
  MarketHistoryRequest,
  MarketHistoryResult,
  MarketSearchResult
} from './market'
import type { F1SessionSummary, F1SessionData, F1SessionEnrichmentRequest, F1SessionEnrichmentChunk, F1LiveDataDelta, LiveStatus } from './f1live'
import type { PracticeBriefRequest, PracticeBriefResult } from './practice'
import type { StandingsRequest, StandingsResult } from './standings'

/**
 * The single source of truth for the renderer <-> main IPC surface.
 *
 * `window.racedeck` (exposed by the preload via contextBridge) implements
 * `RaceDeckApi`. Keeping channel names + payload types here guarantees both
 * sides stay in lockstep and lets the renderer be fully typed.
 *
 * SECURITY: this is the ONLY bridge. The renderer has no Node access. The main
 * process validates every request. Nothing here can read TOD credentials,
 * tokens, or protected media — it only controls a browser *surface* and app
 * persistence.
 */

export const IPC = {
  // ── App / diagnostics ──────────────────────────────────────────────
  APP_INFO: 'app:info',
  APP_CAPTURE_PNG: 'app:capture-png',
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_MAXIMIZE_TOGGLE: 'window:maximize-toggle',
  WINDOW_CLOSE: 'window:close',
  WINDOW_IS_MAXIMIZED: 'window:is-maximized',
  WINDOW_MAXIMIZED_CHANGED: 'window:maximized-changed', // main -> renderer

  // ── Video surface (TOD) ────────────────────────────────────────────
  VIDEO_GET_STATE: 'video:get-state',
  VIDEO_SET_MODE: 'video:set-mode',
  VIDEO_SET_BOUNDS: 'video:set-bounds',
  VIDEO_SET_URL: 'video:set-url',
  VIDEO_RELOAD: 'video:reload',
  VIDEO_BACK: 'video:back',
  VIDEO_OPEN_EXTERNAL: 'video:open-external',
  VIDEO_SET_VISIBLE: 'video:set-visible',
  VIDEO_TOGGLE_DEVTOOLS: 'video:toggle-devtools',
  VIDEO_STATE_CHANGED: 'video:state-changed', // main -> renderer

  // ── AI Race Engineer ───────────────────────────────────────────────
  AI_COMPLETE: 'ai:complete',

  // ── Prediction market (Polymarket win odds) ────────────────────────
  MARKET_WINNER: 'market:winner',
  MARKET_HISTORY: 'market:history',
  MARKET_SEARCH: 'market:search',

  // ── Practice intelligence (public FIA/OpenF1/Jolpica data) ─────────
  PRACTICE_BRIEFING: 'practice:briefing',
  PRACTICE_OPEN_SOURCE: 'practice:open-source',

  // ── Championship standings (public Jolpica data) ───────────────────
  STANDINGS_SEASON: 'standings:season',

  // ── F1 official live-timing archive ────────────────────────────────
  F1_LIST_SESSIONS: 'f1:list-sessions',
  F1_LOAD_SESSION: 'f1:load-session',
  F1_LOAD_SESSION_ENRICHMENT: 'f1:load-session-enrichment',

  // ── F1 live timing (authenticated SignalR feed) ────────────────────
  F1_OPEN_LOGIN: 'f1:open-login',
  F1_LOGIN_STATUS: 'f1:login-status',
  F1_CONNECT_LIVE: 'f1:connect-live',
  F1_DISCONNECT_LIVE: 'f1:disconnect-live',
  F1_LIVE_STATUS: 'f1:live-status',
  F1_GET_LIVE: 'f1:get-live',
  F1_LIVE_STATUS_CHANGED: 'f1:live-status-changed', // main -> renderer

  // ── Persistence ────────────────────────────────────────────────────
  STORE_GET: 'store:get',
  STORE_SET: 'store:set',
  STORE_DELETE: 'store:delete',
  STORE_ALL: 'store:all',
  STORE_CLEAR_NAMESPACE: 'store:clear-namespace'
} as const

export interface AppInfo {
  name: string
  version: string
  platform: NodeJS.Platform
  electron: string
  chrome: string
  /** True when running on a Widevine-capable (castLabs) Electron build. */
  drmCapable: boolean
  /** True only after the Widevine component has provisioned successfully. */
  drmReady: boolean
  isDev: boolean
}

/** CSS-pixel rectangle (relative to the main window content area). */
export interface SurfaceBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface SetVideoModeRequest {
  mode: VideoMode
  url?: string
  bounds?: SurfaceBounds
  /**
   * When true, RaceDeck may auto-fall back to a lower mode if this one fails.
   * (Mirrors the "Auto-fallback to companion window" setting.)
   */
  autoFallback?: boolean
}

export interface CaptureResult {
  saved: boolean
  path?: string
}

/** The typed API exposed on `window.racedeck`. */
export interface RaceDeckApi {
  app: {
    info(): Promise<AppInfo>
    /** Capture the current dashboard to a PNG the user chooses to save. */
    capturePng(defaultName?: string): Promise<CaptureResult>
  }
  window: {
    minimize(): void
    toggleMaximize(): void
    close(): void
    isMaximized(): Promise<boolean>
    onMaximizedChanged(cb: (maximized: boolean) => void): () => void
  }
  video: {
    getState(): Promise<VideoModeState>
    setMode(req: SetVideoModeRequest): Promise<VideoModeState>
    setBounds(bounds: SurfaceBounds): void
    setVisible(visible: boolean): void
    setUrl(url: string): Promise<VideoModeState>
    reload(): void
    back(): void
    openExternal(url?: string): Promise<void>
    toggleDevTools(): void
    /** Subscribe to live VideoModeState pushes. Returns an unsubscribe fn. */
    onStateChanged(cb: (state: VideoModeState) => void): () => void
  }
  ai: {
    /** Send grounded strategy context to the user's chosen AI endpoint. */
    complete(req: AiCompletionRequest): Promise<AiCompletionResult>
  }
  market: {
    /** Public F1 win odds from Polymarket for a query or explicit event slug. */
    winner(req: MarketWinnerRequest): Promise<MarketWinnerResult>
    /** Yes-share price history for one outcome token (replay-synced odds). */
    history(req: MarketHistoryRequest): Promise<MarketHistoryResult>
    /** Search candidate F1 winner events (Settings picker). */
    search(query: string): Promise<MarketSearchResult>
  }
  practice: {
    /** Driver swaps, rookie background and FIA weekend upgrade submissions. */
    briefing(req: PracticeBriefRequest): Promise<PracticeBriefResult>
    /** Open an allow-listed public source in the user's browser. */
    openSource(url: string): Promise<void>
  }
  standings: {
    /** Championship baseline (pre-round) from public Jolpica data. */
    season(req: StandingsRequest): Promise<StandingsResult>
  }
  f1: {
    /** List sessions for a season from F1's open official timing archive. */
    listSessions(year: number): Promise<F1SessionSummary[]>
    /** Fetch + decode a full session (timing/tyres/telemetry/positions). */
    loadSession(path: string): Promise<F1SessionData>
    /** Load high-rate positions/telemetry after core timing is interactive. */
    loadSessionEnrichment(req: F1SessionEnrichmentRequest): Promise<F1SessionEnrichmentChunk>
    // ── Live (authenticated) ──
    /** Open the in-app F1 sign-in window (for live timing). */
    openLogin(): void
    /** Whether F1 auth is present in the login partition. */
    loginStatus(): Promise<boolean>
    /** Negotiate + connect the live SignalR feed with the signed-in session. */
    connectLive(): Promise<LiveStatus>
    /** Disconnect the live feed. */
    disconnectLive(): void
    /** Current live connection status. */
    liveStatus(): Promise<LiveStatus>
    /** Snapshot the accumulated live feed (null until connected). */
    getLive(cursors?: Record<string, number>, generation?: number): Promise<F1LiveDataDelta | null>
    /** Subscribe to live status pushes. Returns an unsubscribe fn. */
    onLiveStatus(cb: (status: LiveStatus) => void): () => void
  }
  store: {
    get<T = unknown>(namespace: string, key: string): Promise<T | null>
    set(namespace: string, key: string, value: unknown): Promise<void>
    delete(namespace: string, key: string): Promise<void>
    all<T = Record<string, unknown>>(namespace: string): Promise<T>
    clearNamespace(namespace: string): Promise<void>
  }
}

/** Store namespaces used across the app (keeps keys organized in electron-store). */
export const STORE_NS = {
  SETTINGS: 'settings',
  LAYOUTS: 'layouts',
  SYNC: 'sync',
  FAVORITES: 'favorites',
  ALERTS: 'alerts',
  /** Per-meeting circuit outlines (one race weekend = one guaranteed layout). */
  TRACK_PATHS: 'trackpaths'
} as const
