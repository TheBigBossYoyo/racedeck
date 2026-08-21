import { useMemo, useRef } from 'react'
import GridLayout, { WidthProvider, type Layout } from 'react-grid-layout'
import { useLayoutStore } from '@renderer/store/layoutStore'
import { useSettingsStore, isModuleEnabled } from '@renderer/store/settingsStore'
import {
  GRID_COLS,
  GRID_MARGIN,
  GRID_ROW_HEIGHT,
  type PanelLayout
} from '@renderer/core/engines/LayoutManager'
import { WidgetRenderer } from './widgetRegistry'
import { cn } from '@renderer/lib/utils'

const Grid = WidthProvider(GridLayout)

export function GridLayoutHost() {
  const fullGrid = useLayoutStore((s) => s.grid)
  const editMode = useLayoutStore((s) => s.editMode)
  const updateGrid = useLayoutStore((s) => s.updateGrid)
  const modules = useSettingsStore((s) => s.modules)
  const containerRef = useRef<HTMLDivElement>(null)

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
        rowHeight={GRID_ROW_HEIGHT}
        margin={GRID_MARGIN}
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
