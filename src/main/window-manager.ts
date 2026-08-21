import { BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { is } from '@electron-toolkit/utils'
import { IPC } from '@shared/ipc-contract'
import { isSafeExternalUrl } from '@shared/video-fallback'

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

    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
    } else {
      void win.loadFile(join(__dirname, '../renderer/index.html'))
    }

    this.mainWindow = win
    return win
  }

  focus(): void {
    const win = this.getMainWindow()
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.focus()
  }
}
