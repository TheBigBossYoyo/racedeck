import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultAiConfig } from '@shared/ai'
import { IPC } from '@shared/ipc-contract'

type Listener = (event: unknown, ...args: unknown[]) => unknown

const electron = vi.hoisted(() => ({
  handlers: new Map<string, Listener>(),
  listeners: new Map<string, Listener>(),
  openExternal: vi.fn(async () => undefined),
  showSaveDialog: vi.fn(async () => ({ canceled: false, filePath: 'C:/out/debrief.md' })),
  writeFile: vi.fn(async () => undefined)
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: Listener) => electron.handlers.set(channel, fn),
    on: (channel: string, fn: Listener) => electron.listeners.set(channel, fn)
  },
  shell: { openExternal: electron.openExternal },
  app: { getVersion: () => '0.0.0', getPath: () => 'C:/docs' },
  BrowserWindow: { fromWebContents: () => ({ webContents: {} }) },
  dialog: { showSaveDialog: electron.showSaveDialog }
}))
vi.mock('node:fs/promises', () => ({
  writeFile: electron.writeFile,
  default: { writeFile: electron.writeFile }
}))

import { registerIpc, type IpcDeps } from '../../src/main/ipc/register'

const APP_URL = 'file:///C:/app/out/renderer/index.html'
const trustedEvent = { senderFrame: { url: APP_URL }, sender: {} }
const evilEvent = { senderFrame: { url: 'https://evil.example/' }, sender: {} }

function fakeDeps(over: Partial<Record<string, unknown>> = {}) {
  const store = {
    get: vi.fn(() => null),
    set: vi.fn(),
    delete: vi.fn(),
    all: vi.fn(() => ({})),
    clearNamespace: vi.fn(),
    recovery: null
  }
  const video = {
    getState: vi.fn(),
    setMode: vi.fn(async () => ({})),
    setUrl: vi.fn(async () => ({})),
    openExternal: vi.fn(async () => undefined),
    setBounds: vi.fn(),
    setVisible: vi.fn(),
    reload: vi.fn(),
    back: vi.fn(),
    toggleDevTools: vi.fn(),
    probePlayback: vi.fn()
  }
  const ai = {
    complete: vi.fn(async () => ({ ok: true })),
    transcribe: vi.fn(async () => ({ ok: true }))
  }
  const f1 = { listSessions: vi.fn(async () => []), loadSession: vi.fn(), loadSessionEnrichmentChunk: vi.fn() }
  const f1socket = { getData: vi.fn(() => null), disconnect: vi.fn(), connect: vi.fn(), getStatus: vi.fn() }
  const deps = {
    windows: {},
    video,
    store,
    ai,
    market: {},
    practice: {},
    standings: {},
    f1,
    f1auth: {},
    f1socket,
    drmCapable: false,
    drmReady: () => false,
    isDev: false,
    ...over
  }
  return { deps: deps as unknown as IpcDeps, store, video, ai, f1, f1socket }
}

const invoke = (channel: string, event: unknown, ...args: unknown[]) => {
  const fn = electron.handlers.get(channel)
  if (!fn) throw new Error(`no handler for ${channel}`)
  return fn(event, ...args)
}
const send = (channel: string, event: unknown, ...args: unknown[]) => {
  const fn = electron.listeners.get(channel)
  if (!fn) throw new Error(`no listener for ${channel}`)
  return fn(event, ...args)
}

beforeEach(() => {
  electron.handlers.clear()
  electron.listeners.clear()
  electron.openExternal.mockClear()
  electron.showSaveDialog.mockClear()
  electron.writeFile.mockClear()
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  delete process.env['ELECTRON_RENDERER_URL']
})

describe('sender validation', () => {
  it('refuses invoke calls from a foreign page before touching any service', async () => {
    const { deps, store } = fakeDeps()
    registerIpc(deps)

    await expect(invoke(IPC.STORE_GET, evilEvent, 'settings', 'theme')).rejects.toThrow(/untrusted/i)
    await expect(invoke(IPC.STORE_GET, evilEvent, 'settings', 'theme')).rejects.toThrow(/untrusted/i)
    expect(store.get).not.toHaveBeenCalled()
  })

  it('refuses a call whose sender frame is gone or unreadable', async () => {
    const { deps, store } = fakeDeps()
    registerIpc(deps)
    const gone = { senderFrame: null, sender: {} }
    const throwing = {
      get senderFrame(): never {
        throw new Error('disposed')
      },
      sender: {}
    }

    await expect(invoke(IPC.STORE_GET, gone, 'settings', 'theme')).rejects.toThrow(/untrusted/i)
    await expect(invoke(IPC.STORE_GET, throwing, 'settings', 'theme')).rejects.toThrow(/untrusted/i)
    expect(store.get).not.toHaveBeenCalled()
  })

  it('silently drops fire-and-forget messages from a foreign page', async () => {
    const { deps, video } = fakeDeps()
    registerIpc(deps)

    send(IPC.VIDEO_TOGGLE_DEVTOOLS, evilEvent)
    send(IPC.VIDEO_SET_BOUNDS, evilEvent, { x: 0, y: 0, width: 1, height: 1 })

    expect(video.toggleDevTools).not.toHaveBeenCalled()
    expect(video.setBounds).not.toHaveBeenCalled()
  })

  it('serves the packaged app document', async () => {
    const { deps, store } = fakeDeps()
    registerIpc(deps)

    await invoke(IPC.STORE_GET, trustedEvent, 'settings', 'theme')

    expect(store.get).toHaveBeenCalledWith('settings', 'theme')
  })

  it('trusts the dev server only in dev builds', async () => {
    process.env['ELECTRON_RENDERER_URL'] = 'http://localhost:5173'
    const devEvent = { senderFrame: { url: 'http://localhost:5173/' }, sender: {} }

    const prod = fakeDeps({ isDev: false })
    registerIpc(prod.deps)
    await expect(invoke(IPC.STORE_GET, devEvent, 'settings', 'theme')).rejects.toThrow(/untrusted/i)

    electron.handlers.clear()
    const dev = fakeDeps({ isDev: true })
    registerIpc(dev.deps)
    await invoke(IPC.STORE_GET, devEvent, 'settings', 'theme')
    expect(dev.store.get).toHaveBeenCalled()
  })
})

describe('store handlers', () => {
  it('rejects an unknown namespace on every store channel', async () => {
    const { deps, store } = fakeDeps()
    registerIpc(deps)

    for (const [channel, args] of [
      [IPC.STORE_GET, ['hax', 'k']],
      [IPC.STORE_SET, ['hax', 'k', 1]],
      [IPC.STORE_DELETE, ['hax', 'k']],
      [IPC.STORE_ALL, ['hax']],
      [IPC.STORE_CLEAR_NAMESPACE, ['hax']]
    ] as const) {
      await expect(invoke(channel, trustedEvent, ...args)).rejects.toThrow(/namespace/i)
    }
    expect(store.get).not.toHaveBeenCalled()
    expect(store.set).not.toHaveBeenCalled()
    expect(store.delete).not.toHaveBeenCalled()
    expect(store.all).not.toHaveBeenCalled()
    expect(store.clearNamespace).not.toHaveBeenCalled()
  })

  it('cannot overwrite the internal __meta entry or write an empty key', async () => {
    const { deps, store } = fakeDeps()
    registerIpc(deps)

    await expect(invoke(IPC.STORE_SET, trustedEvent, 'settings', '__meta', {})).rejects.toThrow(/key/i)
    await expect(invoke(IPC.STORE_SET, trustedEvent, 'settings', '', 1)).rejects.toThrow(/key/i)
    await expect(invoke(IPC.STORE_DELETE, trustedEvent, 'settings', '__meta')).rejects.toThrow(/key/i)
    expect(store.set).not.toHaveBeenCalled()
    expect(store.delete).not.toHaveBeenCalled()
  })

  it('never lets a dotted key nest into another path, and reads it back the same way', async () => {
    const { deps, store } = fakeDeps()
    registerIpc(deps)

    await invoke(IPC.STORE_SET, trustedEvent, 'annotations', 'a.b', [1])
    await invoke(IPC.STORE_GET, trustedEvent, 'annotations', 'a.b')

    const written = store.set.mock.calls[0][1] as string
    expect(written).not.toContain('.')
    expect(store.get.mock.calls[0][1]).toBe(written)
  })

  it('stores every legitimate real-world key unchanged', async () => {
    const { deps, store } = fakeDeps()
    registerIpc(deps)

    await invoke(IPC.STORE_SET, trustedEvent, 'layouts', 'working:broadcast-data', {})
    await invoke(IPC.STORE_SET, trustedEvent, 'trackpaths', 'v3/2024/2024-03-02_Bahrain_Grand_Prix', [])

    expect(store.set.mock.calls[0].slice(0, 2)).toEqual(['layouts', 'working:broadcast-data'])
    expect(store.set.mock.calls[1].slice(0, 2)).toEqual([
      'trackpaths',
      'v3/2024/2024-03-02_Bahrain_Grand_Prix'
    ])
  })

  it('rejects a value over the size cap with a clear error', async () => {
    const { deps, store } = fakeDeps()
    registerIpc(deps)

    const big = 'x'.repeat(6 * 1024 * 1024)
    await expect(invoke(IPC.STORE_SET, trustedEvent, 'plugins', 'entries', big)).rejects.toThrow(
      /too large/i
    )
    expect(store.set).not.toHaveBeenCalled()
  })
})

describe('AI handlers', () => {
  const valid = () => ({
    config: { ...defaultAiConfig(), apiKey: 'k', enabled: true },
    messages: [{ role: 'user', content: 'pit?' }]
  })

  it('rejects a malformed completion request without calling the service', async () => {
    const { deps, ai } = fakeDeps()
    registerIpc(deps)

    await expect(invoke(IPC.AI_COMPLETE, trustedEvent, { ...valid(), messages: 'nope' })).rejects.toThrow()
    await expect(invoke(IPC.AI_COMPLETE, trustedEvent, null)).rejects.toThrow()
    await expect(
      invoke(IPC.AI_TRANSCRIBE, trustedEvent, { config: valid().config, audioUrl: 7 })
    ).rejects.toThrow()
    expect(ai.complete).not.toHaveBeenCalled()
    expect(ai.transcribe).not.toHaveBeenCalled()
  })

  it('passes a valid request through', async () => {
    const { deps, ai } = fakeDeps()
    registerIpc(deps)

    await invoke(IPC.AI_COMPLETE, trustedEvent, valid())

    expect(ai.complete).toHaveBeenCalledTimes(1)
  })
})

describe('video handlers', () => {
  it('ignores malformed bounds instead of throwing inside the main process', async () => {
    const { deps, video } = fakeDeps()
    registerIpc(deps)

    expect(() => send(IPC.VIDEO_SET_BOUNDS, trustedEvent, { x: 'a' })).not.toThrow()
    expect(() => send(IPC.VIDEO_SET_BOUNDS, trustedEvent, undefined)).not.toThrow()
    expect(video.setBounds).not.toHaveBeenCalled()

    send(IPC.VIDEO_SET_BOUNDS, trustedEvent, { x: 1, y: 2, width: 3, height: 4 })
    expect(video.setBounds).toHaveBeenCalledWith({ x: 1, y: 2, width: 3, height: 4 })
  })

  it('contains an exception thrown by a fire-and-forget handler', async () => {
    const { deps, video } = fakeDeps()
    video.setBounds.mockImplementation(() => {
      throw new TypeError('boom')
    })
    registerIpc(deps)

    expect(() =>
      send(IPC.VIDEO_SET_BOUNDS, trustedEvent, { x: 1, y: 2, width: 3, height: 4 })
    ).not.toThrow()
  })

  it('rejects an unknown mode and a non-boolean visibility', async () => {
    const { deps, video } = fakeDeps()
    registerIpc(deps)

    await expect(invoke(IPC.VIDEO_SET_MODE, trustedEvent, { mode: 'pip' })).rejects.toThrow(/mode/i)
    send(IPC.VIDEO_SET_VISIBLE, trustedEvent, 'yes')
    expect(video.setMode).not.toHaveBeenCalled()
    expect(video.setVisible).not.toHaveBeenCalled()

    await invoke(IPC.VIDEO_SET_MODE, trustedEvent, { mode: 'embedded' })
    send(IPC.VIDEO_SET_VISIBLE, trustedEvent, false)
    expect(video.setMode).toHaveBeenCalledWith({ mode: 'embedded' })
    expect(video.setVisible).toHaveBeenCalledWith(false)
  })
})

describe('debrief export', () => {
  it('validates the payload before showing a dialog', async () => {
    const { deps } = fakeDeps()
    registerIpc(deps)

    await expect(invoke(IPC.APP_EXPORT_DEBRIEF, trustedEvent, 5, 'md')).rejects.toThrow()
    await expect(invoke(IPC.APP_EXPORT_DEBRIEF, trustedEvent, 'x', 'exe')).rejects.toThrow()
    expect(electron.showSaveDialog).not.toHaveBeenCalled()
  })

  it('does not let the suggested name escape the documents folder', async () => {
    const { deps } = fakeDeps()
    registerIpc(deps)

    await invoke(IPC.APP_EXPORT_DEBRIEF, trustedEvent, '# hi', 'md', '..\\..\\evil.md')

    const options = electron.showSaveDialog.mock.calls[0] as unknown as [unknown, { defaultPath: string }]
    expect(options[1].defaultPath).not.toContain('..')
    expect(electron.writeFile).toHaveBeenCalledWith('C:/out/debrief.md', '# hi', 'utf-8')
  })
})

describe('F1 handlers', () => {
  it('rejects an implausible season and malformed live cursors', async () => {
    const { deps, f1, f1socket } = fakeDeps()
    registerIpc(deps)

    await expect(invoke(IPC.F1_LIST_SESSIONS, trustedEvent, '2024/../x')).rejects.toThrow(/year/i)
    await expect(invoke(IPC.F1_GET_LIVE, trustedEvent, 'nope', 1)).rejects.toThrow()
    expect(f1.listSessions).not.toHaveBeenCalled()
    expect(f1socket.getData).not.toHaveBeenCalled()

    await invoke(IPC.F1_LIST_SESSIONS, trustedEvent, 2024)
    await invoke(IPC.F1_GET_LIVE, trustedEvent, { CarData: 3 }, 1)
    expect(f1.listSessions).toHaveBeenCalledWith(2024)
    expect(f1socket.getData).toHaveBeenCalledWith({ CarData: 3 }, 1)
  })
})

describe('allow-listed external links', () => {
  it('opens an AI key page and the Polymarket event page', async () => {
    const { deps } = fakeDeps()
    registerIpc(deps)

    await invoke(IPC.APP_OPEN_EXTERNAL, trustedEvent, 'https://aistudio.google.com/apikey')
    await invoke(IPC.APP_OPEN_EXTERNAL, trustedEvent, 'https://polymarket.com/event/abc')

    expect(electron.openExternal).toHaveBeenNthCalledWith(1, 'https://aistudio.google.com/apikey')
    expect(electron.openExternal).toHaveBeenNthCalledWith(2, 'https://polymarket.com/event/abc')
  })

  it.each([
    'https://evil.example/',
    'http://polymarket.com/event/abc',
    'file:///C:/Windows/System32/calc.exe',
    'https://polymarket.com.evil.example/',
    5
  ])('refuses %s', async (url) => {
    const { deps } = fakeDeps()
    registerIpc(deps)

    await expect(invoke(IPC.APP_OPEN_EXTERNAL, trustedEvent, url)).rejects.toThrow(/allow-listed/i)
    expect(electron.openExternal).not.toHaveBeenCalled()
  })

  it('leaves the TOD-only external channel to the video manager', async () => {
    const { deps, video } = fakeDeps()
    registerIpc(deps)

    await invoke(IPC.VIDEO_OPEN_EXTERNAL, trustedEvent, undefined)
    await invoke(IPC.VIDEO_OPEN_EXTERNAL, trustedEvent, 'https://tod.example/x')

    expect(video.openExternal).toHaveBeenNthCalledWith(1, undefined)
    expect(video.openExternal).toHaveBeenNthCalledWith(2, 'https://tod.example/x')
  })
})

describe('F1 live connect / disconnect race', () => {
  /** getAuthContext promises the test resolves by hand, in the order they were requested. */
  function heldAuth() {
    const releases: Array<(ctx: unknown) => void> = []
    const getAuthContext = vi.fn(() => new Promise((resolve) => releases.push(resolve)))
    return { getAuthContext, releases }
  }

  it('does not connect when the user disconnects while auth is still being resolved', async () => {
    const { getAuthContext, releases } = heldAuth()
    const { deps, f1socket } = fakeDeps({ f1auth: { getAuthContext } })
    f1socket.getStatus.mockReturnValue({ state: 'closed' })
    registerIpc(deps)

    const pending = invoke(IPC.F1_CONNECT_LIVE, trustedEvent)
    send(IPC.F1_DISCONNECT_LIVE, trustedEvent)
    releases[0]({ hasAuth: false })
    const result = await pending

    expect(f1socket.connect).not.toHaveBeenCalled()
    expect(f1socket.disconnect).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ state: 'closed' })
  })

  it('lets only the newest of two overlapping connects reach the socket', async () => {
    const { getAuthContext, releases } = heldAuth()
    const { deps, f1socket } = fakeDeps({ f1auth: { getAuthContext } })
    f1socket.getStatus.mockReturnValue({ state: 'connecting' })
    f1socket.connect.mockResolvedValue({ state: 'connected' })
    registerIpc(deps)

    const first = invoke(IPC.F1_CONNECT_LIVE, trustedEvent)
    const second = invoke(IPC.F1_CONNECT_LIVE, trustedEvent)
    releases[1]({ hasAuth: true, bearer: 'b' })
    releases[0]({ hasAuth: true, bearer: 'b' })
    await Promise.all([first, second])

    expect(f1socket.connect).toHaveBeenCalledTimes(1)
  })

  it('connects normally, passing the auth context only when the user is signed in', async () => {
    const signedIn = { hasAuth: true, bearer: 'tok' }
    const getAuthContext = vi.fn().mockResolvedValueOnce(signedIn).mockResolvedValueOnce({ hasAuth: false })
    const { deps, f1socket } = fakeDeps({ f1auth: { getAuthContext } })
    f1socket.connect.mockResolvedValue({ state: 'connected' })
    registerIpc(deps)

    await invoke(IPC.F1_CONNECT_LIVE, trustedEvent)
    await invoke(IPC.F1_CONNECT_LIVE, trustedEvent)

    expect(f1socket.connect).toHaveBeenNthCalledWith(1, signedIn)
    expect(f1socket.connect).toHaveBeenNthCalledWith(2, undefined)
  })
})
