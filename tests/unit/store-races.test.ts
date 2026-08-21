import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LAYOUT_PRESETS, cloneGrid, serializeSavedLayout } from '@renderer/core/engines/LayoutManager'
import { useLayoutStore } from '@renderer/store/layoutStore'
import { persist } from '@renderer/store/persist'
import { useSyncStore } from '@renderer/store/syncStore'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('async persisted-state reads', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(persist, 'set').mockResolvedValue()
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
})
