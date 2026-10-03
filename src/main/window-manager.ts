import { BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { is } from '@electron-toolkit/utils'
import { IPC } from '@shared/ipc-contract'
import { isSafeExternalUrl } from '@shared/video-fallback'
import { isAppNavigation } from './ipc/trusted-sender'

/**
 * WindowManager — creates and tracks the main RaceDeck window.
 *
 * The window is frameless for a premium custom title bar; window controls are
 * driven from the renderer over IPC. Remote content (TOD) is NOT loaded here —
 * it lives in the VideoSurfaceManager's separate surface/session.
 */
export class WindowManager {
  private mainWindow: BrowserWindow | null = null

  getMainWindow(): BrowserWindow | null {
    return this.mainWindow && !this.mainWindow.isDestroyed() ? this.mainWindow : null
  }

  create(): BrowserWindow {
    const win = new BrowserWindow({
      width: 1560,
      height: 960,
      minWidth: 1100,
      minHeight: 700,
      show: false,
      frame: false,
      titleBarStyle: 'hidden',
      backgroundColor: '#080910',
      title: 'RaceDeck',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        // WebContentsView children (the TOD surface) are composited over this
        // window's content; keep background painting on for smooth resizes.
        backgroundThrottling: false
      }
    })

    win.on('ready-to-show', () => win.show())

    win.on('maximize', () => win.webContents.send(IPC.WINDOW_MAXIMIZED_CHANGED, true))
    win.on('unmaximize', () => win.webContents.send(IPC.WINDOW_MAXIMIZED_CHANGED, false))

    // Any window.open from OUR UI goes to the external browser.
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (isSafeExternalUrl(url)) void shell.openExternal(url)
      return { action: 'deny' }
    })

    const devServerUrl = is.dev ? (process.env['ELECTRON_RENDERER_URL'] ?? null) : null
    const appFile = join(__dirname, '../renderer/index.html')
    this.lockNavigation(win, devServerUrl, pathToFileURL(appFile).href)

    if (devServerUrl) {
      void win.loadURL(devServerUrl)
    } else {
      void win.loadFile(appFile)
    }

    this.mainWindow = win
    return win
  }

  /**
   * The main window carries the IPC bridge, so it must only ever show the app's
   * own document. Anything else (a stray link, a redirect, an injected
   * `location = ...`) is stopped before it can load with the bridge attached.
   */
  private lockNavigation(win: BrowserWindow, devServerUrl: string | null, appFileUrl: string): void {
    const guard = (event: { preventDefault(): void }, url: string): void => {
      if (isAppNavigation(url, devServerUrl, appFileUrl)) return
      event.preventDefault()
      console.warn('[window] blocked navigation of the main window to a non-app URL.')
    }
    win.webContents.on('will-navigate', (event, url) => guard(event, url))
    win.webContents.on('will-redirect', (event, url) => guard(event, url))
    // There are no <webview>s in the app; refuse any that appear.
    win.webContents.on('will-attach-webview', (event) => event.preventDefault())
  }

  focus(): void {
    const win = this.getMainWindow()
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.focus()
  }
}
