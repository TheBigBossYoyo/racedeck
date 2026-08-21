import { app, BrowserWindow, net } from 'electron'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { WindowManager } from './window-manager'
import { VideoSurfaceManager } from './video-surface-manager'
import { PersistenceLayer } from './persistence'
import { AiService } from './ai-service'
import { MarketService } from './market-service'
import { F1LiveService } from './f1-live-service'
import { F1AuthManager } from './f1-auth'
import { F1LiveSocket } from './f1-live-socket'
import { PracticeService } from './practice-service'
import { StandingsService } from './standings-service'
import { registerIpc } from './ipc/register'
import { IPC } from '@shared/ipc-contract'

/**
 * RaceDeck main process entry.
 *
 * Widevine / DRM: the castLabs Electron fork exposes an extra `components`
 * module used to provision the Widevine CDM. We access it DEFENSIVELY so the
 * app also runs on stock Electron (dev/CI) — there DRM is simply unavailable
 * and the UI reports it honestly. The project is pinned to the castLabs fork;
 * `npm run enable-drm` restores that pin if the dependency was replaced.
 */

// ── Smooth embedded video on projected / secondary (TV) displays ─────────────
// The TOD broadcast is a WebContentsView composited into the main window. When
// that window is moved onto — or projected to — a TV, Chromium's occlusion and
// background-throttling heuristics can wrongly treat it as hidden and cut its
// paint/compositing rate, which surfaces as stuttery video even though the
// window is fully visible on the external screen. These switches keep rendering
// at full rate for an on-screen-but-unfocused or externally-presented window.
// They disable *throttling only* (no GPU vsync / tearing trade-off), so the
// already-smooth on-PC experience is unchanged. Must run before app "ready".
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
app.commandLine.appendSwitch('disable-renderer-backgrounding')

const castlabs = electron_components()
const drmCapable = Boolean(castlabs?.whenReady)
let drmReady = false

interface ElectronComponents {
  whenReady(required?: string[]): Promise<unknown>
  status?: () => Record<string, { status: string; title: string | null; version: string | null }>
  WIDEVINE_CDM_ID?: string
  MEDIA_FOUNDATION_WIDEVINE_CDM_ID?: string
}

function electron_components(): ElectronComponents | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const e = require('electron') as Record<string, unknown>
    return e.components as ElectronComponents | undefined
  } catch {
    return undefined
  }
}

const windows = new WindowManager()
const store = new PersistenceLayer()
const ai = new AiService()
const market = new MarketService()
const practice = new PracticeService()
const standings = new StandingsService()
// Chromium's default session honors the official archive's Cache-Control/ETag
// headers across launches. Node's global fetch has no persistent HTTP cache.
const f1 = new F1LiveService((input, init) =>
  net.fetch(input, { ...init, credentials: 'omit', bypassCustomProtocolHandlers: true })
)
const f1auth = new F1AuthManager()
const f1socket = new F1LiveSocket()
f1socket.setStatusListener((status) => {
  windows.getMainWindow()?.webContents.send(IPC.F1_LIVE_STATUS_CHANGED, status)
})

const video = new VideoSurfaceManager({
  getMainWindow: () => windows.getMainWindow(),
  sendState: (state) => {
    const win = windows.getMainWindow()
    win?.webContents.send(IPC.VIDEO_STATE_CHANGED, state)
  },
  drmReady: () => drmReady
})

// Single-instance: focus the existing window instead of opening a second app.
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => windows.focus())

  app.whenReady().then(async () => {
    electronApp.setAppUserModelId('app.racedeck.desktop')

    // Provision Widevine before creating any window (castLabs only).
    if (castlabs?.whenReady) {
      try {
        const registered = castlabs.status?.()
        const candidates =
          process.platform === 'win32'
            ? [castlabs.MEDIA_FOUNDATION_WIDEVINE_CDM_ID, castlabs.WIDEVINE_CDM_ID]
            : [castlabs.WIDEVINE_CDM_ID]
        const widevineId = candidates.find(
          (id): id is string => Boolean(id && (!registered || registered[id]))
        )
        const required = widevineId ? [widevineId] : undefined
        await castlabs.whenReady(required)
        drmReady = true
        console.log('[RaceDeck] Widevine components ready:', castlabs.status?.())
      } catch (err) {
        drmReady = false
        console.warn(
          '[RaceDeck] Widevine components failed to load:',
          err,
          'Component status:',
          castlabs.status?.()
        )
      }
    }

    app.on('browser-window-created', (_e, win) => optimizer.watchWindowShortcuts(win))

    // Configure the TOD session partition now that the app is ready (session
    // APIs must not be touched before this point).
    video.init()

    registerIpc({ windows, video, store, ai, market, practice, standings, f1, f1auth, f1socket, drmCapable, drmReady: () => drmReady, isDev: is.dev })

    windows.create()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) windows.create()
    })
  })

  app.on('window-all-closed', () => {
    video.destroy()
    f1socket.disconnect()
    f1auth.destroy()
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => {
    video.destroy()
    f1socket.disconnect()
    f1auth.destroy()
  })
}
