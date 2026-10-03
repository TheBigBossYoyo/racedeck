import { beforeEach, describe, expect, it, vi } from 'vitest'

const toolkit = vi.hoisted(() => ({ is: { dev: false } }))

vi.mock('electron', () => ({
  BrowserWindow: class {},
  WebContentsView: class {},
  shell: { openExternal: vi.fn() },
  session: { fromPartition: vi.fn() }
}))
vi.mock('@electron-toolkit/utils', () => toolkit)

import { VideoSurfaceManager } from '../../src/main/video-surface-manager'

interface FakeContents {
  isDevToolsOpened: ReturnType<typeof vi.fn>
  openDevTools: ReturnType<typeof vi.fn>
  closeDevTools: ReturnType<typeof vi.fn>
}

function managerWithSurface(): { manager: VideoSurfaceManager; contents: FakeContents } {
  const manager = new VideoSurfaceManager({
    getMainWindow: () => null,
    sendState: () => undefined,
    drmReady: () => false
  })
  const contents: FakeContents = {
    isDevToolsOpened: vi.fn(() => false),
    openDevTools: vi.fn(),
    closeDevTools: vi.fn()
  }
  // Default mode is 'none', which reads the companion window.
  ;(manager as unknown as { companion: unknown }).companion = { webContents: contents }
  return { manager, contents }
}

describe('VideoSurfaceManager.toggleDevTools', () => {
  beforeEach(() => {
    toolkit.is.dev = false
  })

  it('never opens DevTools on the DRM surface in a packaged build', () => {
    const { manager, contents } = managerWithSurface()

    manager.toggleDevTools()

    expect(contents.openDevTools).not.toHaveBeenCalled()
    expect(contents.closeDevTools).not.toHaveBeenCalled()
  })

  it('opens DevTools in a dev build', () => {
    toolkit.is.dev = true
    const { manager, contents } = managerWithSurface()

    manager.toggleDevTools()

    expect(contents.openDevTools).toHaveBeenCalledWith({ mode: 'detach' })
  })

  it('closes already-open DevTools in a dev build', () => {
    toolkit.is.dev = true
    const { manager, contents } = managerWithSurface()
    contents.isDevToolsOpened.mockReturnValue(true)

    manager.toggleDevTools()

    expect(contents.closeDevTools).toHaveBeenCalled()
    expect(contents.openDevTools).not.toHaveBeenCalled()
  })
})
