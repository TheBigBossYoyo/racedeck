import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { STORE_NS } from '@shared/ipc-contract'
import { persist } from '@renderer/store/persist'
import {
  createCoalescedWriter,
  flushAllCoalescedWrites,
  writeLogged
} from '@renderer/store/persistWrite'
import { useLayoutStore } from '@renderer/store/layoutStore'
import { useSettingsStore } from '@renderer/store/settingsStore'
import { useSyncStore } from '@renderer/store/syncStore'
import { usePluginStore } from '@renderer/store/pluginStore'
import { useProfileStore } from '@renderer/store/profileStore'
import { useAnnotationsStore } from '@renderer/store/annotationsStore'
import { useComparisonLibraryStore } from '@renderer/store/comparisonLibraryStore'
import {
  LAYOUT_PRESETS,
  cloneGrid,
  type PanelLayout
} from '@renderer/core/engines/LayoutManager'

const WORKING = (id: string) => `working:${id}`

function gridAt(x: number): PanelLayout[] {
  return cloneGrid(LAYOUT_PRESETS['broadcast-data'].grid).map((p, i) => (i === 0 ? { ...p, x } : p))
}

function writesTo(spy: { mock: { calls: unknown[][] } }, ns: string, key: string): unknown[][] {
  return spy.mock.calls.filter(([n, k]) => n === ns && k === key)
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

describe('createCoalescedWriter', () => {
  let setSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.useFakeTimers()
    setSpy = vi.spyOn(persist, 'set').mockResolvedValue()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('collapses a burst into one trailing write of the last value', () => {
    const writer = createCoalescedWriter(300)
    for (let i = 0; i < 50; i++) writer.schedule('ns', 'k', i)
    expect(setSpy).not.toHaveBeenCalled()

    vi.advanceTimersByTime(299)
    expect(setSpy).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)

    expect(setSpy).toHaveBeenCalledTimes(1)
    expect(setSpy).toHaveBeenCalledWith('ns', 'k', 49)
  })

  it('restarts the delay on every schedule so a continuous drag is not written mid-drag', () => {
    const writer = createCoalescedWriter(300)
    writer.schedule('ns', 'k', 1)
    vi.advanceTimersByTime(200)
    writer.schedule('ns', 'k', 2)
    vi.advanceTimersByTime(200)
    expect(setSpy).not.toHaveBeenCalled()
    vi.advanceTimersByTime(100)
    expect(setSpy).toHaveBeenCalledWith('ns', 'k', 2)
  })

  it('flush writes the queued value immediately and cancels the timer', () => {
    const writer = createCoalescedWriter(300)
    writer.schedule('ns', 'k', 'last')
    writer.flush()
    expect(setSpy).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1000)
    expect(setSpy).toHaveBeenCalledTimes(1)
    writer.flush() // nothing queued: no-op
    expect(setSpy).toHaveBeenCalledTimes(1)
  })

  it('never drops the value for the old key when the target changes', () => {
    const writer = createCoalescedWriter(300)
    writer.schedule('ns', 'a', 'A')
    writer.schedule('ns', 'b', 'B')
    expect(setSpy).toHaveBeenCalledWith('ns', 'a', 'A')
    vi.advanceTimersByTime(300)
    expect(setSpy).toHaveBeenCalledWith('ns', 'b', 'B')
  })

  it('flushAllCoalescedWrites (the unload hook) drains every writer', () => {
    const one = createCoalescedWriter(300)
    const two = createCoalescedWriter(300)
    one.schedule('ns', 'one', 1)
    two.schedule('ns', 'two', 2)
    flushAllCoalescedWrites()
    expect(setSpy).toHaveBeenCalledWith('ns', 'one', 1)
    expect(setSpy).toHaveBeenCalledWith('ns', 'two', 2)
  })

  it('flushes on pagehide so a window close inside the delay loses nothing', () => {
    const writer = createCoalescedWriter(300)
    writer.schedule('ns', 'k', 'v')
    window.dispatchEvent(new Event('pagehide'))
    expect(setSpy).toHaveBeenCalledWith('ns', 'k', 'v')
  })
})

describe('writeLogged', () => {
  it('logs a failed write with its key and never throws or leaves a rejection', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(persist, 'set').mockRejectedValue(new Error('disk full'))

    expect(() => writeLogged('ns', 'key', 1)).not.toThrow()
    await flushMicrotasks()

    expect(errorSpy).toHaveBeenCalledWith(expect.stringMatching(/ns:key.*disk full/))
    vi.restoreAllMocks()
  })
})

describe('layoutStore write frequency', () => {
  let setSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    setSpy = vi.spyOn(persist, 'set').mockResolvedValue()
    vi.spyOn(persist, 'get').mockResolvedValue(null)
    useLayoutStore.setState({ currentLayoutId: 'broadcast-data', grid: gridAt(0) })
    // drain anything queued by a previous test
    flushAllCoalescedWrites()
    setSpy.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('updates the in-memory grid immediately but writes once after the drag settles', () => {
    for (let x = 1; x <= 30; x++) useLayoutStore.getState().updateGrid(gridAt(x))

    expect(useLayoutStore.getState().grid[0].x).toBe(30)
    expect(writesTo(setSpy, STORE_NS.LAYOUTS, WORKING('broadcast-data'))).toHaveLength(0)

    vi.advanceTimersByTime(500)

    const writes = writesTo(setSpy, STORE_NS.LAYOUTS, WORKING('broadcast-data'))
    expect(writes).toHaveLength(1)
    expect((writes[0][2] as PanelLayout[])[0].x).toBe(30)
  })

  it('flushes the pending grid to the OLD layout when the layout changes', () => {
    useLayoutStore.getState().updateGrid(gridAt(7))
    useLayoutStore.getState().setLayout('strategy-wall')

    const writes = writesTo(setSpy, STORE_NS.LAYOUTS, WORKING('broadcast-data'))
    expect(writes).toHaveLength(1)
    expect((writes[0][2] as PanelLayout[])[0].x).toBe(7)
  })

  it('flushes before a reset so the older drag cannot overwrite the reset later', () => {
    useLayoutStore.getState().updateGrid(gridAt(9))
    useLayoutStore.getState().resetLayout()
    vi.advanceTimersByTime(1000)

    const writes = writesTo(setSpy, STORE_NS.LAYOUTS, WORKING('broadcast-data'))
    const last = writes.at(-1)?.[2] as PanelLayout[]
    expect(last).toEqual(LAYOUT_PRESETS['broadcast-data'].grid)
  })

  it('logs instead of leaving an unhandled rejection when a write fails', async () => {
    setSpy.mockRejectedValue(new Error('disk full'))
    useLayoutStore.getState().resetLayout()
    useLayoutStore.getState().setLayout('minimal-watch')
    await flushMicrotasks()
    expect(console.error).toHaveBeenCalledWith(expect.stringMatching(/layouts:.*disk full/))
  })

  it('logs a failed working-layout read instead of leaving it unhandled', async () => {
    vi.mocked(persist.get).mockRejectedValue(new Error('read failed'))
    useLayoutStore.getState().setLayout('minimal-watch')
    await flushMicrotasks()
    expect(console.error).toHaveBeenCalledWith(expect.stringMatching(/minimal-watch.*read failed/))
  })
})

describe('syncStore write frequency', () => {
  let setSpy: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    vi.spyOn(persist, 'get').mockResolvedValue(null)
    setSpy = vi.spyOn(persist, 'set').mockResolvedValue()
    await useSyncStore.getState().setBroadcaster('TOD')
    await useSyncStore.getState().setScope(null)
    flushAllCoalescedWrites()
    vi.useFakeTimers()
    setSpy.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('moves the live offset on every slider tick but persists once after it settles', () => {
    for (let i = 1; i <= 60; i++) {
      useSyncStore.getState().setOffset(i / 2)
      expect(useSyncStore.getState().sync.offsetSeconds).toBe(i / 2)
    }
    expect(writesTo(setSpy, STORE_NS.SYNC, 'offset:TOD')).toHaveLength(0)

    vi.advanceTimersByTime(500)

    const writes = writesTo(setSpy, STORE_NS.SYNC, 'offset:TOD')
    expect(writes).toHaveLength(1)
    expect(writes[0][2]).toBe(30)
  })

  it('does not lose the offset when the scope changes inside the debounce window', async () => {
    useSyncStore.getState().setOffset(12)
    await useSyncStore.getState().setScope('provider:x')
    expect(writesTo(setSpy, STORE_NS.SYNC, 'offset:TOD')).toEqual([[STORE_NS.SYNC, 'offset:TOD', 12]])
  })

  it('persists a nudge and a calibration through the same coalesced path', async () => {
    useSyncStore.getState().nudge(5)
    useSyncStore.getState().nudge(5)
    await useSyncStore.getState().calibrate(40)
    vi.advanceTimersByTime(500)
    const writes = writesTo(setSpy, STORE_NS.SYNC, 'offset:TOD')
    expect(writes).toHaveLength(1)
    expect(writes[0][2]).toBe(40)
  })

  it('logs a failed offset write instead of leaving an unhandled rejection', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    setSpy.mockRejectedValue(new Error('disk full'))
    useSyncStore.getState().setOffset(3)
    vi.advanceTimersByTime(500)
    await flushMicrotasks()
    expect(errorSpy).toHaveBeenCalledWith(expect.stringMatching(/offset:TOD.*disk full/))
  })
})

describe('other stores log failed writes', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(persist, 'set').mockRejectedValue(new Error('disk full'))
  })

  afterEach(() => vi.restoreAllMocks())

  it('settingsStore', async () => {
    useSettingsStore.getState().setAlerts({ weather: false })
    useSettingsStore.getState().toggleFavorite(1)
    useSettingsStore.getState().setAi({ enabled: true })
    await flushMicrotasks()
    expect(errorSpy).toHaveBeenCalledWith(expect.stringMatching(/alerts:alerts.*disk full/))
    expect(errorSpy).toHaveBeenCalledWith(expect.stringMatching(/favorites:favorites.*disk full/))
    expect(errorSpy).toHaveBeenCalledWith(expect.stringMatching(/settings:ai.*disk full/))
  })

  it('pluginStore, profileStore, annotationsStore and comparisonLibraryStore', async () => {
    usePluginStore.getState().add('p', 'src', [])
    useProfileStore.getState().setAutoApply(false)
    useAnnotationsStore.setState({ sessionId: 's', annotations: [] })
    useAnnotationsStore.getState().add({
      t: 1,
      driverNumber: null,
      lapNumber: null,
      tag: null,
      text: 'note'
    })
    useComparisonLibraryStore.getState().remove('x')
    await flushMicrotasks()
    for (const ns of [
      STORE_NS.PLUGINS,
      STORE_NS.PROFILES,
      STORE_NS.ANNOTATIONS,
      STORE_NS.COMPARISON_LIBRARY
    ]) {
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining(`${ns}:`))
    }
  })
})
