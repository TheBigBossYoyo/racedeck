import {
  ipcMain,
  shell,
  app,
  BrowserWindow,
  dialog,
  type IpcMainEvent,
  type IpcMainInvokeEvent
} from 'electron'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { IPC, type AppInfo, type CaptureResult } from '@shared/ipc-contract'
import { APP_NAME } from '@shared/constants'
import { isAllowedExternalUrl } from '@shared/external-links'
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
import { isTrustedSender } from './trusted-sender'
import {
  toStorageKey,
  validateAiCompletionRequest,
  validateAiTranscriptionRequest,
  validateDebriefExport,
  validateF1LiveCursors,
  validateF1Year,
  validateMarketHistoryRequest,
  validateMarketSearchQuery,
  validateMarketWinnerRequest,
  validateOptionalUrl,
  validateSafeFileName,
  validateStoreNamespace,
  validateStoreValue,
  validateSurfaceBounds,
  validateUrl,
  validateVideoSetMode,
  validateVisible
} from './validate'

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

type InvokeListener = (e: IpcMainInvokeEvent, ...args: unknown[]) => unknown
type SendListener = (e: IpcMainEvent, ...args: unknown[]) => void

/**
 * Channel registration that checks WHO is calling before running any handler.
 * Only the app's own document may use the bridge; anything else (a navigated
 * or embedded foreign page) is refused.
 */
interface Binder {
  handle(channel: string, listener: InvokeListener): void
  on(channel: string, listener: SendListener): void
}

function senderUrl(e: IpcMainEvent | IpcMainInvokeEvent): string | null {
  try {
    return e.senderFrame?.url ?? null
  } catch {
    // The frame can be disposed between the message being sent and handled.
    return null
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function createBinder(devServerUrl: string | null): Binder {
  const trusted = (e: IpcMainEvent | IpcMainInvokeEvent): boolean =>
    isTrustedSender(senderUrl(e), devServerUrl)

  return {
    handle(channel, listener) {
      // async, so a validation failure is always a rejection the renderer can
      // catch, never a synchronous throw.
      ipcMain.handle(channel, async (e, ...args) => {
        if (!trusted(e)) {
          console.warn(`[ipc] ${channel} refused: untrusted sender.`)
          throw new Error('IPC request refused: untrusted sender.')
        }
        return listener(e, ...args)
      })
    },
    on(channel, listener) {
      // A throw from a fire-and-forget handler is an uncaught main-process
      // exception, so bad input is contained and logged here instead.
      ipcMain.on(channel, (e, ...args) => {
        if (!trusted(e)) {
          console.warn(`[ipc] ${channel} refused: untrusted sender.`)
          return
        }
        try {
          listener(e, ...args)
        } catch (err) {
          console.warn(`[ipc] ${channel} ignored: ${errorMessage(err)}`)
        }
      })
    }
  }
}

/** Wire every renderer→main channel. All handlers are defensive & side-effect scoped. */
export function registerIpc(deps: IpcDeps): void {
  // The dev server origin is only ever trusted in dev builds.
  const devServerUrl = deps.isDev ? (process.env['ELECTRON_RENDERER_URL'] ?? null) : null
  const bind = createBinder(devServerUrl)

  registerAppIpc(bind, deps)
  registerWindowIpc(bind)
  registerVideoIpc(bind, deps.video)
  registerAiIpc(bind, deps.ai)
  registerMarketIpc(bind, deps.market)
  registerInsightIpc(bind, deps.standings, deps.practice)
  registerF1Ipc(bind, deps)
  registerStoreIpc(bind, deps.store)
}

// ── App / diagnostics ────────────────────────────────────────────────

function registerAppIpc(bind: Binder, deps: IpcDeps): void {
  bind.handle(IPC.APP_INFO, (): AppInfo => {
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

  bind.handle(IPC.APP_CAPTURE_PNG, async (e, rawName): Promise<CaptureResult> => {
    const defaultName = validateSafeFileName(rawName)
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

  bind.handle(IPC.APP_EXPORT_DEBRIEF, async (e, rawContent, rawFormat, rawName) => {
    const { content, format, defaultName } = validateDebriefExport(rawContent, rawFormat, rawName)
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) return { saved: false }
    const extension = format === 'json' ? 'json' : 'md'
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: 'Export race debrief',
      defaultPath: join(
        app.getPath('documents'),
        defaultName ?? `racedeck-debrief-${Date.now()}.${extension}`
      ),
      filters: [
        format === 'json'
          ? { name: 'JSON', extensions: ['json'] }
          : { name: 'Markdown', extensions: ['md'] }
      ]
    })
    if (canceled || !filePath) return { saved: false }
    await writeFile(filePath, content, 'utf-8')
    return { saved: true, path: filePath }
  })

  // The app's own outbound links (Settings "Get a key", pinned Polymarket event).
  // Distinct from VIDEO_OPEN_EXTERNAL, which is TOD-only and rewrites anything
  // else to the default TOD page.
  bind.handle(IPC.APP_OPEN_EXTERNAL, async (_e, url) => {
    if (!isAllowedExternalUrl(url)) throw new Error('External link is not allow-listed.')
    await shell.openExternal(new URL(url).toString())
  })
}

// ── Window controls (frameless custom title bar) ─────────────────────

function registerWindowIpc(bind: Binder): void {
  bind.on(IPC.WINDOW_MINIMIZE, (e) => BrowserWindow.fromWebContents(e.sender)?.minimize())
  bind.on(IPC.WINDOW_MAXIMIZE_TOGGLE, (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
  bind.on(IPC.WINDOW_CLOSE, (e) => BrowserWindow.fromWebContents(e.sender)?.close())
  bind.handle(IPC.WINDOW_IS_MAXIMIZED, (e) => {
    return BrowserWindow.fromWebContents(e.sender)?.isMaximized() ?? false
  })
}

// ── Video surface (TOD) ──────────────────────────────────────────────

function registerVideoIpc(bind: Binder, video: VideoSurfaceManager): void {
  bind.handle(IPC.VIDEO_GET_STATE, () => video.getState())
  bind.handle(IPC.VIDEO_SET_MODE, (_e, req) => video.setMode(validateVideoSetMode(req)))
  bind.handle(IPC.VIDEO_SET_URL, (_e, url) => video.setUrl(validateUrl(url)))
  bind.handle(IPC.VIDEO_OPEN_EXTERNAL, (_e, url) => video.openExternal(validateOptionalUrl(url)))
  bind.on(IPC.VIDEO_SET_BOUNDS, (_e, bounds) => video.setBounds(validateSurfaceBounds(bounds)))
  bind.on(IPC.VIDEO_SET_VISIBLE, (_e, visible) => video.setVisible(validateVisible(visible)))
  bind.on(IPC.VIDEO_RELOAD, () => video.reload())
  bind.on(IPC.VIDEO_BACK, () => video.back())
  bind.on(IPC.VIDEO_TOGGLE_DEVTOOLS, () => video.toggleDevTools())
  bind.handle(IPC.VIDEO_PROBE_PLAYBACK, () => video.probePlayback())
}

// ── AI Race Engineer ─────────────────────────────────────────────────

function registerAiIpc(bind: Binder, ai: AiService): void {
  bind.handle(IPC.AI_COMPLETE, (_e, req) => ai.complete(validateAiCompletionRequest(req)))
  bind.handle(IPC.AI_TRANSCRIBE, (_e, req) => ai.transcribe(validateAiTranscriptionRequest(req)))
}

// ── Prediction market (Polymarket win odds) ──────────────────────────

function registerMarketIpc(bind: Binder, market: MarketService): void {
  bind.handle(IPC.MARKET_WINNER, (_e, req) => market.winner(validateMarketWinnerRequest(req)))
  bind.handle(IPC.MARKET_HISTORY, (_e, req) => market.history(validateMarketHistoryRequest(req)))
  bind.handle(IPC.MARKET_SEARCH, (_e, query) => market.search(validateMarketSearchQuery(query)))
}

// ── Championship standings + practice intelligence ───────────────────

const PRACTICE_SOURCE_HOSTS: ReadonlySet<string> = new Set([
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

function registerInsightIpc(
  bind: Binder,
  standings: StandingsService,
  practice: PracticeService
): void {
  bind.handle(IPC.STANDINGS_SEASON, (_e, req) => standings.getChampionship(req))
  bind.handle(IPC.PRACTICE_BRIEFING, (_e, req) =>
    practice.briefing(validatePracticeBriefRequest(req))
  )
  bind.handle(IPC.PRACTICE_OPEN_SOURCE, async (_e, rawUrl) => {
    let url: URL
    try {
      url = new URL(rawUrl as string)
    } catch {
      throw new Error('Invalid practice source URL.')
    }
    if (url.protocol !== 'https:' || !PRACTICE_SOURCE_HOSTS.has(url.hostname)) {
      throw new Error('Practice source is not allow-listed.')
    }
    await shell.openExternal(url.toString())
  })
}

// ── F1 official live-timing archive + live timing (SignalR Core) ─────

function registerF1Ipc(bind: Binder, deps: IpcDeps): void {
  const { f1, f1auth, f1socket } = deps
  bind.handle(IPC.F1_LIST_SESSIONS, (_e, year) => f1.listSessions(validateF1Year(year)))
  bind.handle(IPC.F1_LOAD_SESSION, (_e, path) => f1.loadSession(path as string))
  bind.handle(IPC.F1_LOAD_SESSION_ENRICHMENT, (_e, req) => f1.loadSessionEnrichmentChunk(req))

  // Timing is a public stream; car telemetry (CarData.z) and positions
  // (Position.z) are gated behind an F1 TV subscription, so we attach the user's
  // subscription token when they've signed in. Reading it is a cookie lookup, so
  // this no longer costs a wait.
  bind.on(IPC.F1_OPEN_LOGIN, (e) => f1auth.openLogin(BrowserWindow.fromWebContents(e.sender)))
  bind.handle(IPC.F1_LOGIN_STATUS, () => f1auth.isLoggedIn())
  // Bumped by every connect request and every disconnect. The socket has its own
  // generation guard, but it only starts once connect() is called; a disconnect (or
  // a newer connect) that lands while the auth lookup below is still pending would
  // otherwise slip past it and re-open a feed the user just closed.
  let liveConnectEpoch = 0
  bind.handle(IPC.F1_CONNECT_LIVE, async () => {
    const epoch = ++liveConnectEpoch
    const ctx = await f1auth.getAuthContext()
    if (epoch !== liveConnectEpoch) return f1socket.getStatus()
    // The token comes straight from the cookie jar, so there is nothing to wait
    // for. (This previously blocked up to 9s opening a hidden F1 TV window to
    // sniff a token that the live feed did not even accept.)
    return f1socket.connect(ctx.hasAuth ? ctx : undefined)
  })
  bind.on(IPC.F1_DISCONNECT_LIVE, () => {
    liveConnectEpoch++
    f1socket.disconnect()
  })
  bind.handle(IPC.F1_LIVE_STATUS, () => f1socket.getStatus())
  bind.handle(IPC.F1_GET_LIVE, (_e, rawCursors, rawGeneration) => {
    const { cursors, generation } = validateF1LiveCursors(rawCursors, rawGeneration)
    return f1socket.getData(cursors, generation)
  })
}

// ── Persistence ──────────────────────────────────────────────────────

function registerStoreIpc(bind: Binder, store: PersistenceLayer): void {
  bind.handle(IPC.STORE_GET, (_e, ns, key) =>
    store.get(validateStoreNamespace(ns), toStorageKey(key))
  )
  bind.handle(IPC.STORE_SET, (_e, ns, key, value) => {
    store.set(validateStoreNamespace(ns), toStorageKey(key), validateStoreValue(value))
  })
  bind.handle(IPC.STORE_DELETE, (_e, ns, key) =>
    store.delete(validateStoreNamespace(ns), toStorageKey(key))
  )
  bind.handle(IPC.STORE_ALL, (_e, ns) => store.all(validateStoreNamespace(ns)))
  bind.handle(IPC.STORE_CLEAR_NAMESPACE, (_e, ns) =>
    store.clearNamespace(validateStoreNamespace(ns))
  )
  bind.handle(IPC.STORE_RECOVERY, () => store.recovery)
}
