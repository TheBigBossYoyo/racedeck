import { ipcMain, shell, app, BrowserWindow, dialog } from 'electron'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { IPC, type AppInfo, type CaptureResult, type SetVideoModeRequest, type SurfaceBounds } from '@shared/ipc-contract'
import type { AiCompletionRequest } from '@shared/ai'
import type { MarketWinnerRequest, MarketHistoryRequest } from '@shared/market'
import { APP_NAME } from '@shared/constants'
import type { WindowManager } from '../window-manager'
import type { VideoSurfaceManager } from '../video-surface-manager'
import type { PersistenceLayer } from '../persistence'
import type { AiService } from '../ai-service'
import type { MarketService } from '../market-service'
import type { F1LiveService } from '../f1-live-service'
import type { F1AuthManager } from '../f1-auth'
import type { F1LiveSocket } from '../f1-live-socket'
import type { PracticeService } from '../practice-service'
import type { StandingsService } from '../standings-service'
import { validatePracticeBriefRequest } from '@shared/practice'

export interface IpcDeps {
  windows: WindowManager
  video: VideoSurfaceManager
  store: PersistenceLayer
  ai: AiService
  market: MarketService
  practice: PracticeService
  standings: StandingsService
  f1: F1LiveService
  f1auth: F1AuthManager
  f1socket: F1LiveSocket
  drmCapable: boolean
  drmReady: () => boolean
  isDev: boolean
}

/** Wire every renderer→main channel. All handlers are defensive & side-effect scoped. */
export function registerIpc(deps: IpcDeps): void {
  const { windows, video, store, ai, market, practice, standings, f1, f1auth, f1socket } = deps

  // ── App / diagnostics ──────────────────────────────────────────────
  ipcMain.handle(IPC.APP_INFO, (): AppInfo => {
    return {
      name: APP_NAME,
      version: app.getVersion(),
      platform: process.platform,
      electron: process.versions.electron ?? 'unknown',
      chrome: process.versions.chrome ?? 'unknown',
      drmCapable: deps.drmCapable,
      drmReady: deps.drmReady(),
      isDev: deps.isDev
    }
  })

  ipcMain.handle(IPC.APP_CAPTURE_PNG, async (e, defaultName?: string): Promise<CaptureResult> => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) return { saved: false }
    const image = await win.webContents.capturePage()
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: 'Export dashboard image',
      defaultPath: join(app.getPath('pictures'), defaultName ?? `racedeck-${Date.now()}.png`),
      filters: [{ name: 'PNG Image', extensions: ['png'] }]
    })
    if (canceled || !filePath) return { saved: false }
    await writeFile(filePath, image.toPNG())
    return { saved: true, path: filePath }
  })

  // ── Window controls (frameless custom title bar) ───────────────────
  ipcMain.on(IPC.WINDOW_MINIMIZE, (e) => BrowserWindow.fromWebContents(e.sender)?.minimize())
  ipcMain.on(IPC.WINDOW_MAXIMIZE_TOGGLE, (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
  ipcMain.on(IPC.WINDOW_CLOSE, (e) => BrowserWindow.fromWebContents(e.sender)?.close())
  ipcMain.handle(IPC.WINDOW_IS_MAXIMIZED, (e) => {
    return BrowserWindow.fromWebContents(e.sender)?.isMaximized() ?? false
  })

  // ── Video surface (TOD) ────────────────────────────────────────────
  ipcMain.handle(IPC.VIDEO_GET_STATE, () => video.getState())
  ipcMain.handle(IPC.VIDEO_SET_MODE, (_e, req: SetVideoModeRequest) => video.setMode(req))
  ipcMain.handle(IPC.VIDEO_SET_URL, (_e, url: string) => video.setUrl(url))
  ipcMain.handle(IPC.VIDEO_OPEN_EXTERNAL, (_e, url?: string) => video.openExternal(url))
  ipcMain.on(IPC.VIDEO_SET_BOUNDS, (_e, bounds: SurfaceBounds) => video.setBounds(bounds))
  ipcMain.on(IPC.VIDEO_SET_VISIBLE, (_e, visible: boolean) => video.setVisible(visible))
  ipcMain.on(IPC.VIDEO_RELOAD, () => video.reload())
  ipcMain.on(IPC.VIDEO_BACK, () => video.back())
  ipcMain.on(IPC.VIDEO_TOGGLE_DEVTOOLS, () => video.toggleDevTools())

  // ── AI Race Engineer ───────────────────────────────────────────────
  ipcMain.handle(IPC.AI_COMPLETE, (_e, req: AiCompletionRequest) => ai.complete(req))

  // ── Prediction market (Polymarket win odds) ────────────────────────
  ipcMain.handle(IPC.MARKET_WINNER, (_e, req: MarketWinnerRequest) => market.winner(req))
  ipcMain.handle(IPC.MARKET_HISTORY, (_e, req: MarketHistoryRequest) => market.history(req))
  ipcMain.handle(IPC.MARKET_SEARCH, (_e, query: string) => market.search(query))

  // ── Championship standings (public Jolpica data) ───────────────────
  ipcMain.handle(IPC.STANDINGS_SEASON, (_e, req: unknown) => standings.getChampionship(req))

  // ── Practice intelligence ──────────────────────────────────────────
  ipcMain.handle(IPC.PRACTICE_BRIEFING, (_e, req: unknown) => practice.briefing(validatePracticeBriefRequest(req)))
  ipcMain.handle(IPC.PRACTICE_OPEN_SOURCE, async (_e, rawUrl: string) => {
    let url: URL
    try {
      url = new URL(rawUrl)
    } catch {
      throw new Error('Invalid practice source URL.')
    }
    const allowedHosts = new Set([
      'api.fia.com',
      'www.fia.com',
      'www.fiaformula2.com',
      'www.fiaformula3.com',
      'www.astonmartinf1.com',
      'www.formula1.com',
      'superformula.net',
      'openf1.org',
      'api.jolpi.ca',
      'en.wikipedia.org'
    ])
    if (url.protocol !== 'https:' || !allowedHosts.has(url.hostname)) {
      throw new Error('Practice source is not allow-listed.')
    }
    await shell.openExternal(url.toString())
  })

  // ── F1 official live-timing archive ────────────────────────────────
  ipcMain.handle(IPC.F1_LIST_SESSIONS, (_e, year: number) => f1.listSessions(year))
  ipcMain.handle(IPC.F1_LOAD_SESSION, (_e, path: string) => f1.loadSession(path))
  ipcMain.handle(IPC.F1_LOAD_SESSION_ENRICHMENT, (_e, req: unknown) => f1.loadSessionEnrichmentChunk(req))

  // ── F1 live timing (SignalR Core) ──────────────────────────────────
  // Timing is a public stream; car telemetry (CarData.z) and positions
  // (Position.z) are gated behind an F1 TV subscription, so we attach the user's
  // subscription token when they've signed in. Reading it is a cookie lookup, so
  // this no longer costs a wait.
  ipcMain.on(IPC.F1_OPEN_LOGIN, (e) => f1auth.openLogin(BrowserWindow.fromWebContents(e.sender)))
  ipcMain.handle(IPC.F1_LOGIN_STATUS, () => f1auth.isLoggedIn())
  ipcMain.handle(IPC.F1_CONNECT_LIVE, async () => {
    const ctx = await f1auth.getAuthContext()
    // The token comes straight from the cookie jar, so there is nothing to wait
    // for. (This previously blocked up to 9s opening a hidden F1 TV window to
    // sniff a token that the live feed did not even accept.)
    return f1socket.connect(ctx.hasAuth ? ctx : undefined)
  })
  ipcMain.on(IPC.F1_DISCONNECT_LIVE, () => f1socket.disconnect())
  ipcMain.handle(IPC.F1_LIVE_STATUS, () => f1socket.getStatus())
  ipcMain.handle(IPC.F1_GET_LIVE, (_e, cursors?: Record<string, number>, generation?: number) => f1socket.getData(cursors, generation))

  // ── Persistence ────────────────────────────────────────────────────
  ipcMain.handle(IPC.STORE_GET, (_e, ns: string, key: string) => store.get(ns, key))
  ipcMain.handle(IPC.STORE_SET, (_e, ns: string, key: string, value: unknown) => {
    store.set(ns, key, value)
  })
  ipcMain.handle(IPC.STORE_DELETE, (_e, ns: string, key: string) => store.delete(ns, key))
  ipcMain.handle(IPC.STORE_ALL, (_e, ns: string) => store.all(ns))
  ipcMain.handle(IPC.STORE_CLEAR_NAMESPACE, (_e, ns: string) => store.clearNamespace(ns))

  void windows
}
