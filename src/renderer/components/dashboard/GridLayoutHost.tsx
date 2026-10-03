import { useEffect, useMemo, useRef, useState } from 'react'
import GridLayout, { WidthProvider, type Layout } from 'react-grid-layout'
import { useLayoutStore } from '@renderer/store/layoutStore'
import { useSettingsStore, isModuleEnabled } from '@renderer/store/settingsStore'
import {
  GRID_COLS,
  GRID_MARGIN,
  GRID_ROW_HEIGHT,
  gridScaleFor,
  type PanelLayout
} from '@renderer/core/engines/LayoutManager'
import { WidgetRenderer } from './widgetRegistry'
import { cn } from '@renderer/lib/utils'

const Grid = WidthProvider(GridLayout)
/** Poll cadence used ONLY where ResizeObserver does not exist. */
const CONTAINER_SIZE_POLL_MS = 500

interface ContainerSize {
  width: number
  height: number
}

/** Tracks this element's own size, not just the window's (a sidebar
 * collapse/expand resizes the container without a window resize event).
 * ResizeObserver reports those; the poll is a fallback for runtimes without it. */
function useContainerSize(ref: React.RefObject<HTMLDivElement | null>): ContainerSize | null {
  const [size, setSize] = useState<ContainerSize | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => {
      const rect = el.getBoundingClientRect()
      setSize((prev) =>
        prev != null && prev.width === rect.width && prev.height === rect.height
          ? prev
          : { width: rect.width, height: rect.height }
      )
    }
    measure()
    window.addEventListener('resize', measure)
    let observer: ResizeObserver | null = null
    let pollId: number | null = null
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(measure)
      observer.observe(el)
    } else {
      pollId = window.setInterval(measure, CONTAINER_SIZE_POLL_MS)
    }
    return () => {
      window.removeEventListener('resize', measure)
      observer?.disconnect()
      if (pollId != null) window.clearInterval(pollId)
    }
  }, [ref])
  return size
}

export function GridLayoutHost() {
  const fullGrid = useLayoutStore((s) => s.grid)
  const editMode = useLayoutStore((s) => s.editMode)
  const updateGrid = useLayoutStore((s) => s.updateGrid)
  const modules = useSettingsStore((s) => s.modules)
  const containerRef = useRef<HTMLDivElement>(null)
  const containerSize = useContainerSize(containerRef)
  const scale = useMemo(
    () => (containerSize == null ? 1 : gridScaleFor(containerSize.width, containerSize.height)),
    [containerSize]
  )
  const rowHeight = Math.round(GRID_ROW_HEIGHT * scale)
  const margin = useMemo<[number, number]>(
    () => [Math.round(GRID_MARGIN[0] * scale), Math.round(GRID_MARGIN[1] * scale)],
    [scale]
  )

  // Disabled modules are hidden from the workspace but keep their saved slot.
  const visibleGrid = useMemo(
    () => fullGrid.filter((g) => isModuleEnabled(modules, g.i)),
    [fullGrid, modules]
  )
  const hiddenGrid = useMemo(
    () => fullGrid.filter((g) => !isModuleEnabled(modules, g.i)),
    [fullGrid, modules]
  )

  const layout = useMemo<Layout[]>(() => visibleGrid.map((g) => ({ ...g })), [visibleGrid])

  const commit = (next: Layout[]) => {
    const mapped: PanelLayout[] = next.map((l) => ({
      i: l.i as PanelLayout['i'],
      x: l.x,
      y: l.y,
      w: l.w,
      h: l.h,
      minW: l.minW,
      minH: l.minH
    }))
    // Preserve hidden (disabled) panels so re-enabling restores them in place.
    updateGrid([...mapped, ...hiddenGrid])
  }

  return (
    <div
      ref={containerRef}
      className={cn('relative h-full w-full overflow-auto p-2.5', editMode && 'rd-edit')}
    >
      <Grid
        className="min-h-full"
        layout={layout}
        cols={GRID_COLS}
        rowHeight={rowHeight}
        margin={margin}
        containerPadding={[0, 0]}
        isDraggable={editMode}
        isResizable={editMode}
        draggableHandle=".rd-drag-handle"
        compactType="vertical"
        preventCollision={false}
        useCSSTransforms
        onDragStop={commit}
        onResizeStop={commit}
      >
        {visibleGrid.map((g) => (
          <div key={g.i} className="overflow-hidden">
            <WidgetRenderer widgetKey={g.i} />
          </div>
        ))}
      </Grid>
    </div>
  )
}
