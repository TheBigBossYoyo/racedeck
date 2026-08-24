import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VideoPlaybackProbe } from '@shared/models'
import { LAYOUT_PRESETS, cloneGrid, serializeSavedLayout } from '@renderer/core/engines/LayoutManager'
import { useLayoutStore } from '@renderer/store/layoutStore'
import { persist } from '@renderer/store/persist'
import { useSyncStore } from '@renderer/store/syncStore'

const ipc = vi.hoisted(() => ({
  probePlayback: vi.fn(),
  storeGet: vi.fn(),
  storeSet: vi.fn(),
  storeDelete: vi.fn(),
  storeAll: vi.fn()
}))

vi.mock('@renderer/lib/ipc', () => ({
  hasBridge: () => true,
  bridge: () => ({
    video: { probePlayback: ipc.probePlayback },
    store: {
      get: ipc.storeGet,
      set: ipc.storeSet,
      delete: ipc.storeDelete,
      all: ipc.storeAll
    }
  })
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function playbackProbe(overrides: Partial<VideoPlaybackProbe> = {}): VideoPlaybackProbe {
  return {
    ok: true,
    currentTime: 100,
    paused: false,
    seekableEnd: 120,
    mediaKey: 'media-a',
    atMs: 1_700_000_000_000,
    reason: null,
    ...overrides
  }
}

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

async function resetSyncStore(): Promise<void> {
  await useSyncStore.getState().setFollowEnabled(false)
  useSyncStore.getState().setFollowEligible(false)
  await useSyncStore.getState().setBroadcaster('TOD')
  await useSyncStore.getState().setScope(null)
  useSyncStore.getState().setOffset(0)
  useSyncStore.setState({ candidates: [], wizardEvent: 'race-control' })
}

describe('async persisted-state reads', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    ipc.probePlayback.mockReset()
    ipc.storeGet.mockReset()
    ipc.storeSet.mockReset()
    ipc.storeDelete.mockReset()
    ipc.storeAll.mockReset()
    ipc.storeGet.mockResolvedValue(null)
    ipc.storeSet.mockResolvedValue(undefined)
    ipc.storeDelete.mockResolvedValue(undefined)
    ipc.storeAll.mockResolvedValue({})
    vi.spyOn(persist, 'set').mockResolvedValue()
    vi.spyOn(persist, 'get').mockResolvedValue(null)
  })

  afterEach(async () => {
    vi.useRealTimers()
    await useSyncStore.getState().setFollowEnabled(false)
    useSyncStore.setState({
      followEligible: false,
      anchor: null,
      follow: { enabled: false, status: 'off', detail: null, videoTime: null, paused: false },
      candidates: [],
      wizardEvent: 'race-control'
    })
  })

  it('does not let an older layout read overwrite a newer selection', async () => {
    const strategy = deferred<unknown>()
    const minimal = deferred<unknown>()
    vi.spyOn(persist, 'get').mockImplementation(async <T = unknown>(_namespace: string, key: string) => {
      if (key === 'working:strategy-wall') return (await strategy.promise) as T
      if (key === 'working:minimal-watch') return (await minimal.promise) as T
      return null
    })

    useLayoutStore.getState().setLayout('strategy-wall')
    useLayoutStore.getState().setLayout('minimal-watch')
    minimal.resolve(cloneGrid(LAYOUT_PRESETS['minimal-watch'].grid))
    await minimal.promise
    await Promise.resolve()
    strategy.resolve(cloneGrid(LAYOUT_PRESETS['strategy-wall'].grid))
    await strategy.promise
    await Promise.resolve()

    expect(useLayoutStore.getState().currentLayoutId).toBe('minimal-watch')
    expect(useLayoutStore.getState().grid.map((item) => item.i)).toEqual(
      LAYOUT_PRESETS['minimal-watch'].grid.map((item) => item.i)
    )
  })

  it('does not let hydration overwrite a newly saved layout', async () => {
    const saved = deferred<unknown[]>()
    vi.spyOn(persist, 'get').mockImplementation(async <T = unknown>(_namespace: string, key: string) => {
      if (key === 'saved') return (await saved.promise) as T
      return null
    })
    useLayoutStore.setState({ savedLayouts: [], activeSavedId: null })

    const hydration = useLayoutStore.getState().hydrate()
    const created = await useLayoutStore.getState().saveCurrentAs('Fresh layout')
    saved.resolve([])
    await hydration

    expect(useLayoutStore.getState().savedLayouts.map((layout) => layout.id)).toContain(created.id)
  })

  it('does not let hydration restore a layout deleted while it was loading', async () => {
    vi.spyOn(persist, 'get').mockResolvedValue(null)
    useLayoutStore.setState({ savedLayouts: [], activeSavedId: null })
    const created = await useLayoutStore.getState().saveCurrentAs('Delete me')
    const saved = deferred<unknown[]>()
    vi.mocked(persist.get).mockImplementation(async <T = unknown>(_namespace: string, key: string) => {
      if (key === 'saved') return (await saved.promise) as T
      return null
    })

    const hydration = useLayoutStore.getState().hydrate()
    await useLayoutStore.getState().deleteSaved(created.id)
    saved.resolve([serializeSavedLayout(created)])
    await hydration

    expect(useLayoutStore.getState().savedLayouts).toEqual([])
  })

  it('does not let an older scope read overwrite a newer sync offset', async () => {
    const first = deferred<number>()
    const second = deferred<number>()
    vi.spyOn(persist, 'get').mockImplementation(async <T = unknown>(_namespace: string, key: string) => {
      if (key.includes('provider%3Afirst')) return (await first.promise) as T
      if (key.includes('provider%3Asecond')) return (await second.promise) as T
      return null
    })

    const firstLoad = useSyncStore.getState().setScope('provider:first')
    const secondLoad = useSyncStore.getState().setScope('provider:second')
    second.resolve(20)
    await secondLoad
    first.resolve(10)
    await firstLoad

    expect(useSyncStore.getState().sync.scopeKey).toBe('provider:second')
    expect(useSyncStore.getState().sync.offsetSeconds).toBe(20)
  })

  it('does not let an older calibration probe overwrite a newer one', async () => {
    await resetSyncStore()
    useSyncStore.setState({
      followEligible: true,
      follow: { enabled: true, status: 'uncalibrated', detail: null, videoTime: null, paused: false },
      anchor: null
    })
    const older = deferred<VideoPlaybackProbe>()
    const newer = deferred<VideoPlaybackProbe>()
    ipc.probePlayback.mockImplementationOnce(() => older.promise).mockImplementationOnce(() => newer.promise)

    const firstCalibration = useSyncStore.getState().calibrate(10)
    const secondCalibration = useSyncStore.getState().calibrate(20)
    newer.resolve(playbackProbe({ currentTime: 220, mediaKey: 'media-new' }))
    await secondCalibration
    older.resolve(playbackProbe({ currentTime: 110, mediaKey: 'media-old' }))
    await firstCalibration

    expect(useSyncStore.getState().sync.offsetSeconds).toBe(20)
    expect(useSyncStore.getState().anchor).toEqual({
      videoTime: 220,
      atMs: 1_700_000_000_000,
      offset: 20,
      mediaKey: 'media-new'
    })
  })

  it('clears follow context and stops polling when follow becomes ineligible', async () => {
    await resetSyncStore()
    vi.useFakeTimers()
    ipc.probePlayback.mockResolvedValue(playbackProbe())

    useSyncStore.getState().setFollowEligible(true)
    await useSyncStore.getState().setFollowEnabled(true)
    await flushAsyncWork()
    const callsBeforeDisable = ipc.probePlayback.mock.calls.length

    useSyncStore.getState().setFollowEligible(false)
    await vi.advanceTimersByTimeAsync(5_000)

    expect(useSyncStore.getState().anchor).toBeNull()
    expect(useSyncStore.getState().follow.status).toBe('uncalibrated')
    expect(ipc.probePlayback).toHaveBeenCalledTimes(callsBeforeDisable)
  })

  it('preserves persisted follow enablement without probing until follow is eligible', async () => {
    await resetSyncStore()
    vi.useFakeTimers()
    vi.mocked(persist.get).mockImplementation(async <T = unknown>(_namespace: string, key: string) => {
      if (key === 'offset:TOD') return 12 as T
      if (key === 'follow-enabled') return true as T
      return null
    })
    ipc.probePlayback.mockResolvedValue(playbackProbe({ currentTime: 312, mediaKey: 'hydrated-media' }))

    await useSyncStore.getState().hydrate()

    expect(useSyncStore.getState().follow.enabled).toBe(true)
    expect(useSyncStore.getState().follow.status).toBe('uncalibrated')
    expect(ipc.probePlayback).not.toHaveBeenCalled()

    useSyncStore.getState().setFollowEligible(true)
    await flushAsyncWork()

    expect(ipc.probePlayback).toHaveBeenCalledTimes(1)
    expect(useSyncStore.getState().follow.status).toBe('following')
    expect(useSyncStore.getState().anchor?.offset).toBe(12)
  })

  it('does not let disabling follow mid-calibration leave a stale anchor behind', async () => {
    await resetSyncStore()
    useSyncStore.getState().setFollowEligible(true)
    const pending = deferred<VideoPlaybackProbe>()
    ipc.probePlayback.mockImplementationOnce(() => pending.promise)

    const enabling = useSyncStore.getState().setFollowEnabled(true)
    await flushAsyncWork()
    await useSyncStore.getState().setFollowEnabled(false)
    pending.resolve(playbackProbe({ currentTime: 450, mediaKey: 'stale-media' }))
    await enabling

    expect(useSyncStore.getState().follow).toEqual({
      enabled: false,
      status: 'off',
      detail: null,
      videoTime: null,
      paused: false
    })
    expect(useSyncStore.getState().anchor).toBeNull()
  })

  it('drops the old anchor before a scope change finishes loading', async () => {
    await resetSyncStore()
    ipc.probePlayback.mockResolvedValue(playbackProbe({ currentTime: 150, mediaKey: 'scope-media' }))
    useSyncStore.setState({
      followEligible: true,
      follow: { enabled: true, status: 'following', detail: null, videoTime: 100, paused: false },
      anchor: {
        videoTime: 100,
        atMs: 1_700_000_000_000,
        offset: 9,
        mediaKey: 'media-a'
      }
    })
    const scoped = deferred<number>()
    vi.mocked(persist.get).mockImplementation(async <T = unknown>(_namespace: string, key: string) => {
      if (key.includes('provider%3Anext')) return (await scoped.promise) as T
      return null
    })

    const scopeLoad = useSyncStore.getState().setScope('provider:next')

    expect(useSyncStore.getState().anchor).toBeNull()
    expect(useSyncStore.getState().follow.status).toBe('uncalibrated')
    scoped.resolve(15)
    await scopeLoad
    await flushAsyncWork()
  })

  it('drops the old anchor before a broadcaster change finishes loading', async () => {
    await resetSyncStore()
    ipc.probePlayback.mockResolvedValue(playbackProbe({ currentTime: 180, mediaKey: 'broadcaster-media' }))
    useSyncStore.setState({
      followEligible: true,
      follow: { enabled: true, status: 'following', detail: null, videoTime: 100, paused: false },
      anchor: {
        videoTime: 100,
        atMs: 1_700_000_000_000,
        offset: 9,
        mediaKey: 'media-a'
      }
    })
    const broadcaster = deferred<number>()
    vi.mocked(persist.get).mockImplementation(async <T = unknown>(_namespace: string, key: string) => {
      if (key === 'offset:Sky') return (await broadcaster.promise) as T
      return null
    })

    const broadcasterLoad = useSyncStore.getState().setBroadcaster('Sky')

    expect(useSyncStore.getState().anchor).toBeNull()
    expect(useSyncStore.getState().follow.status).toBe('uncalibrated')
    broadcaster.resolve(18)
    await broadcasterLoad
    await flushAsyncWork()
  })
})
