import { createElement } from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TodVideoPanel } from '@renderer/widgets/TodVideoPanel'
import { useVideoStore } from '@renderer/store/videoStore'
import { useLayoutStore } from '@renderer/store/layoutStore'
import { useAppStore } from '@renderer/store/appStore'

type Observer = { cb: () => void; disconnected: boolean; observed: Element[] }
const observers: Observer[] = []

class FakeResizeObserver {
  private readonly record: Observer
  constructor(cb: () => void) {
    this.record = { cb, disconnected: false, observed: [] }
    observers.push(this.record)
  }
  observe(el: Element): void {
    this.record.observed.push(el)
  }
  unobserve(): void {}
  disconnect(): void {
    this.record.disconnected = true
  }
}

function mockRect(left: number, top: number, width: number, height: number): void {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({})
  })
}

describe('TodVideoPanel native-surface bounds reporting', () => {
  const applyBounds = vi.fn()
  const setVisible = vi.fn()

  beforeEach(() => {
    observers.length = 0
    applyBounds.mockClear()
    setVisible.mockClear()
    vi.useFakeTimers()
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      return window.setTimeout(() => cb(performance.now()), 0)
    })
    useLayoutStore.setState({ editMode: false })
    useVideoStore.setState({
      state: { ...useVideoStore.getState().state, mode: 'embedded' },
      applyBounds,
      setVisible,
      activate: vi.fn(async () => {})
    })
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('reports the initial rect, then follows a size change through ResizeObserver immediately', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    mockRect(10, 20, 400, 300)
    render(createElement(TodVideoPanel))
    expect(applyBounds).toHaveBeenCalledTimes(1)
    expect(applyBounds).toHaveBeenLastCalledWith({ x: 10, y: 20, width: 400, height: 300 })
    expect(observers).toHaveLength(1)
    expect(observers[0].observed).toHaveLength(1)

    mockRect(10, 20, 640, 360)
    act(() => {
      observers[0].cb()
      vi.advanceTimersByTime(1) // next-frame report, far sooner than any poll
    })
    expect(applyBounds).toHaveBeenLastCalledWith({ x: 10, y: 20, width: 640, height: 360 })
  })

  it('follows a pure move (which ResizeObserver cannot see) within the fast poll, even when idle', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    mockRect(0, 0, 300, 200)
    render(createElement(TodVideoPanel))
    applyBounds.mockClear()

    mockRect(50, 0, 300, 200) // pure movement: only the poll can see it
    act(() => {
      vi.advanceTimersByTime(130)
    })
    expect(applyBounds).toHaveBeenLastCalledWith({ x: 50, y: 0, width: 300, height: 200 })
  })

  it('polls fast while the layout is being edited (drag moves a panel without resizing it)', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    mockRect(0, 0, 300, 200)
    useLayoutStore.setState({ editMode: true })
    render(createElement(TodVideoPanel))
    applyBounds.mockClear()

    mockRect(0, 90, 300, 200)
    act(() => {
      vi.advanceTimersByTime(130)
    })
    expect(applyBounds).toHaveBeenLastCalledWith({ x: 0, y: 90, width: 300, height: 200 })
  })

  it('keeps the fast poll where ResizeObserver does not exist', () => {
    vi.stubGlobal('ResizeObserver', undefined)
    mockRect(0, 0, 300, 200)
    render(createElement(TodVideoPanel))
    applyBounds.mockClear()

    mockRect(0, 0, 500, 200)
    act(() => {
      vi.advanceTimersByTime(130)
    })
    expect(applyBounds).toHaveBeenLastCalledWith({ x: 0, y: 0, width: 500, height: 200 })
  })

  it('tears down the observer and hides the surface on unmount, and stops polling', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    mockRect(0, 0, 300, 200)
    const { unmount } = render(createElement(TodVideoPanel))
    setVisible.mockClear()
    unmount()
    expect(observers[0].disconnected).toBe(true)
    expect(setVisible).toHaveBeenLastCalledWith(false)
    applyBounds.mockClear()
    mockRect(1, 1, 1, 1)
    vi.advanceTimersByTime(2_000)
    expect(applyBounds).not.toHaveBeenCalled()
  })

  it('does not restart (and so does not flicker the surface) when edit mode toggles', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    mockRect(0, 0, 300, 200)
    render(createElement(TodVideoPanel))
    setVisible.mockClear()
    act(() => {
      useLayoutStore.setState({ editMode: true })
    })
    expect(setVisible).not.toHaveBeenCalled()
    expect(observers).toHaveLength(1)
  })
})

describe('TodVideoPanel DevTools button', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    mockRect(0, 0, 300, 200)
    useVideoStore.setState({
      state: { ...useVideoStore.getState().state, mode: 'companion' },
      activate: vi.fn(async () => {})
    })
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    useAppStore.setState({ info: null })
  })

  const appInfo = (isDev: boolean) =>
    ({ name: 'RaceDeck', version: '0', platform: 'win32', electron: '', chrome: '', drmCapable: false, drmReady: false, isDev }) as never

  it('is hidden in a production build and while app info is unknown', () => {
    const { queryByTitle, rerender } = render(createElement(TodVideoPanel))
    expect(queryByTitle('Inspect TOD surface (DevTools)')).toBeNull()
    act(() => useAppStore.setState({ info: appInfo(false) }))
    rerender(createElement(TodVideoPanel))
    expect(queryByTitle('Inspect TOD surface (DevTools)')).toBeNull()
    expect(queryByTitle('Reload')).not.toBeNull()
  })

  it('is shown in a dev build', () => {
    useAppStore.setState({ info: appInfo(true) })
    const { queryByTitle } = render(createElement(TodVideoPanel))
    expect(queryByTitle('Inspect TOD surface (DevTools)')).not.toBeNull()
  })
})
