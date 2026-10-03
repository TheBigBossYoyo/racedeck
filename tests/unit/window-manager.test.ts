import { pathToFileURL } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Handler = (...args: unknown[]) => unknown

const electron = vi.hoisted(() => ({
  windows: [] as unknown[],
  openExternal: vi.fn(async () => undefined),
  toolkit: { is: { dev: false } }
}))

vi.mock('electron', () => {
  class FakeWindow {
    handlers = new Map<string, Handler>()
    openHandler: ((details: { url: string }) => { action: string }) | null = null
    loadFile = vi.fn()
    loadURL = vi.fn()
    webContents = {
      on: (event: string, fn: Handler) => this.webContents.handlers.set(event, fn),
      handlers: new Map<string, Handler>(),
      setWindowOpenHandler: (fn: (details: { url: string }) => { action: string }) => {
        this.openHandler = fn
      },
      send: vi.fn()
    }
    on = vi.fn()
    constructor() {
      electron.windows.push(this)
    }
  }
  return { BrowserWindow: FakeWindow, shell: { openExternal: electron.openExternal } }
})
vi.mock('@electron-toolkit/utils', () => electron.toolkit)

import { WindowManager } from '../../src/main/window-manager'

interface FakeWindow {
  loadFile: ReturnType<typeof vi.fn>
  loadURL: ReturnType<typeof vi.fn>
  openHandler: ((details: { url: string }) => { action: string }) | null
  webContents: { handlers: Map<string, Handler> }
}

function createWindow(): FakeWindow {
  new WindowManager().create()
  return electron.windows[electron.windows.length - 1] as FakeWindow
}

function navigate(win: FakeWindow, event: string, url: string): { prevented: boolean } {
  const e = { preventDefault: vi.fn() }
  const handler = win.webContents.handlers.get(event)
  if (!handler) throw new Error(`no ${event} handler registered`)
  handler(e, url)
  return { prevented: e.preventDefault.mock.calls.length > 0 }
}

beforeEach(() => {
  electron.windows.length = 0
  electron.openExternal.mockClear()
  electron.toolkit.is.dev = false
  delete process.env['ELECTRON_RENDERER_URL']
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

describe('main window navigation lock (packaged)', () => {
  it('blocks navigation and redirects to any remote page', () => {
    const win = createWindow()

    for (const event of ['will-navigate', 'will-redirect']) {
      expect(navigate(win, event, 'https://evil.example/').prevented).toBe(true)
      expect(navigate(win, event, 'http://evil.example/').prevented).toBe(true)
      expect(navigate(win, event, 'javascript:alert(1)').prevented).toBe(true)
      expect(navigate(win, event, 'file:///C:/Windows/win.ini').prevented).toBe(true)
    }
  })

  it('lets the app document reload itself', () => {
    const win = createWindow()
    const appUrl = pathToFileURL(win.loadFile.mock.calls[0][0] as string).href

    expect(navigate(win, 'will-navigate', appUrl).prevented).toBe(false)
    expect(navigate(win, 'will-navigate', `${appUrl}#/settings`).prevented).toBe(false)
  })

  it('refuses to attach webviews', () => {
    const win = createWindow()

    expect(navigate(win, 'will-attach-webview', '').prevented).toBe(true)
  })
})

describe('main window navigation lock (dev)', () => {
  it('allows the dev-server origin and nothing else remote', () => {
    electron.toolkit.is.dev = true
    process.env['ELECTRON_RENDERER_URL'] = 'http://localhost:5173'
    const win = createWindow()

    expect(win.loadURL).toHaveBeenCalledWith('http://localhost:5173')
    expect(navigate(win, 'will-navigate', 'http://localhost:5173/').prevented).toBe(false)
    expect(navigate(win, 'will-navigate', 'https://evil.example/').prevented).toBe(true)
  })
})

describe('main window new-window handling', () => {
  it('never opens an app window; https links go to the system browser', () => {
    const win = createWindow()

    expect(win.openHandler?.({ url: 'https://www.formula1.com/' })).toEqual({ action: 'deny' })
    expect(electron.openExternal).toHaveBeenCalledWith('https://www.formula1.com/')
  })

  it.each(['http://evil.example/', 'file:///C:/x', 'javascript:alert(1)', 'ms-msdt:/id x'])(
    'denies %s without opening anything',
    (url) => {
      const win = createWindow()

      expect(win.openHandler?.({ url })).toEqual({ action: 'deny' })
      expect(electron.openExternal).not.toHaveBeenCalled()
    }
  )
})
