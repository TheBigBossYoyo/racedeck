import { createElement } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  REFERENCE_GRID_WIDTH,
  REFERENCE_GRID_HEIGHT,
  SHELL_CHROME_HEIGHT,
  MAX_GRID_SCALE
} from '@renderer/core/engines/LayoutManager'

// Stub react-grid-layout so this test observes exactly what GridLayoutHost
// computed and passed down (rowHeight/margin), without depending on jsdom
// doing real layout math or on WidthProvider's own resize-observer internals.
vi.mock('react-grid-layout', () => {
  function GridLayoutStub(props: {
    rowHeight: number
    margin: [number, number]
    cols: number
    children?: React.ReactNode
  }) {
    return createElement(
      'div',
      {
        'data-testid': 'grid-stub',
        'data-row-height': props.rowHeight,
        'data-margin': JSON.stringify(props.margin),
        'data-cols': props.cols
      },
      props.children
    )
  }
  return {
    __esModule: true,
    default: GridLayoutStub,
    WidthProvider: (Comp: unknown) => Comp
  }
})

import { GridLayoutHost } from '@renderer/components/dashboard/GridLayoutHost'
import { useLayoutStore } from '@renderer/store/layoutStore'
import { GRID_ROW_HEIGHT, GRID_MARGIN } from '@renderer/core/engines/LayoutManager'

/**
 * `height` defaults to a container tall enough that it never limits the scale,
 * so the width-driven tests below keep asserting pure width scaling.
 */
function mockContainerSize(width: number, height = 100_000): void {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width,
    height,
    top: 0,
    left: 0,
    right: width,
    bottom: height,
    x: 0,
    y: 0,
    toJSON: () => ({})
  })
}
const mockContainerWidth = (width: number): void => mockContainerSize(width)

describe('GridLayoutHost preset scaling on wide displays', () => {
  beforeEach(() => {
    useLayoutStore.setState({ grid: [], editMode: false, updateGrid: vi.fn() })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders the unscaled reference row height/margin at the design-reference width', () => {
    mockContainerWidth(REFERENCE_GRID_WIDTH)
    render(createElement(GridLayoutHost))

    const stub = screen.getByTestId('grid-stub')
    expect(stub.dataset.rowHeight).toBe(String(GRID_ROW_HEIGHT))
    expect(stub.dataset.margin).toBe(JSON.stringify(GRID_MARGIN))
  })

  it('scales row height/margin up proportionally on a 4K-wide container', () => {
    const fourK = 3840
    mockContainerWidth(fourK)
    render(createElement(GridLayoutHost))

    const stub = screen.getByTestId('grid-stub')
    const expectedScale = Math.min(fourK / REFERENCE_GRID_WIDTH, MAX_GRID_SCALE)
    expect(Number(stub.dataset.rowHeight)).toBe(Math.round(GRID_ROW_HEIGHT * expectedScale))
    expect(JSON.parse(stub.dataset.margin ?? '[]')).toEqual([
      Math.round(GRID_MARGIN[0] * expectedScale),
      Math.round(GRID_MARGIN[1] * expectedScale)
    ])
  })

  it('never shrinks below the reference sizing on a narrower-than-reference window', () => {
    mockContainerWidth(1100) // the app's minWidth
    render(createElement(GridLayoutHost))

    const stub = screen.getByTestId('grid-stub')
    expect(stub.dataset.rowHeight).toBe(String(GRID_ROW_HEIGHT))
    expect(stub.dataset.margin).toBe(JSON.stringify(GRID_MARGIN))
  })
})

describe('GridLayoutHost height-aware scaling', () => {
  beforeEach(() => {
    useLayoutStore.setState({ grid: [], editMode: false, updateGrid: vi.fn() })
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  const rowHeight = () => Number(screen.getByTestId('grid-stub').dataset.rowHeight)

  it('holds an ultrawide (3440x1440) to what its height allows, not its width', () => {
    const w = 3440 - 58
    const h = 1440 - SHELL_CHROME_HEIGHT
    mockContainerSize(w, h)
    render(createElement(GridLayoutHost))

    const heightScale = h / REFERENCE_GRID_HEIGHT
    expect(heightScale).toBeLessThan(w / REFERENCE_GRID_WIDTH)
    expect(rowHeight()).toBe(Math.round(GRID_ROW_HEIGHT * heightScale))
  })

  it('still scales a 16:9 4K container ~2.4x', () => {
    mockContainerSize(3840 - 58, 2160 - SHELL_CHROME_HEIGHT)
    render(createElement(GridLayoutHost))
    expect(rowHeight() / GRID_ROW_HEIGHT).toBeGreaterThan(2.3)
    expect(rowHeight() / GRID_ROW_HEIGHT).toBeLessThan(2.5)
  })

  it('renders unscaled at the default window content size', () => {
    mockContainerSize(1560 - 58, REFERENCE_GRID_HEIGHT - 3)
    render(createElement(GridLayoutHost))
    expect(rowHeight()).toBe(GRID_ROW_HEIGHT)
  })
})

describe('GridLayoutHost container observation', () => {
  type Callback = () => void
  const observers: { cb: Callback; disconnected: boolean; observed: Element[] }[] = []

  class FakeResizeObserver {
    private readonly record: { cb: Callback; disconnected: boolean; observed: Element[] }
    constructor(cb: Callback) {
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

  beforeEach(() => {
    observers.length = 0
    useLayoutStore.setState({ grid: [], editMode: false, updateGrid: vi.fn() })
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('reacts to a container resize through ResizeObserver without polling', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    const setIntervalSpy = vi.spyOn(window, 'setInterval')
    mockContainerSize(REFERENCE_GRID_WIDTH)
    render(createElement(GridLayoutHost))

    expect(setIntervalSpy).not.toHaveBeenCalled()
    expect(observers).toHaveLength(1)
    expect(observers[0].observed).toHaveLength(1)
    expect(screen.getByTestId('grid-stub').dataset.rowHeight).toBe(String(GRID_ROW_HEIGHT))

    mockContainerSize(3840)
    act(() => observers[0].cb())
    const expectedScale = Math.min(3840 / REFERENCE_GRID_WIDTH, MAX_GRID_SCALE)
    expect(Number(screen.getByTestId('grid-stub').dataset.rowHeight)).toBe(
      Math.round(GRID_ROW_HEIGHT * expectedScale)
    )
  })

  it('disconnects the observer on unmount', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    mockContainerSize(REFERENCE_GRID_WIDTH)
    const { unmount } = render(createElement(GridLayoutHost))
    unmount()
    expect(observers[0].disconnected).toBe(true)
  })

  it('still follows window resize events (fallback listener)', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    mockContainerSize(REFERENCE_GRID_WIDTH)
    render(createElement(GridLayoutHost))
    mockContainerSize(3840)
    act(() => {
      window.dispatchEvent(new Event('resize'))
    })
    expect(Number(screen.getByTestId('grid-stub').dataset.rowHeight)).toBeGreaterThan(GRID_ROW_HEIGHT)
  })

  it('falls back to a poll only where ResizeObserver does not exist', () => {
    vi.stubGlobal('ResizeObserver', undefined)
    vi.useFakeTimers()
    mockContainerSize(REFERENCE_GRID_WIDTH)
    render(createElement(GridLayoutHost))
    expect(screen.getByTestId('grid-stub').dataset.rowHeight).toBe(String(GRID_ROW_HEIGHT))

    mockContainerSize(3840)
    act(() => {
      vi.advanceTimersByTime(600)
    })
    expect(Number(screen.getByTestId('grid-stub').dataset.rowHeight)).toBeGreaterThan(GRID_ROW_HEIGHT)
  })
})
