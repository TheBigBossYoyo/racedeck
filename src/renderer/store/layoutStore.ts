import { create } from 'zustand'
import { STORE_NS } from '@shared/ipc-contract'
import { persist } from './persist'
import { createCoalescedWriter, describeError, writeLogged } from './persistWrite'
import {
  LAYOUT_PRESETS,
  cloneGrid,
  createSavedLayout,
  defaultPanelFor,
  deserializeSavedLayout,
  gridHasVideo,
  sanitizeGrid,
  serializeSavedLayout,
  type LayoutId,
  type PanelLayout,
  type SavedLayout,
  type WidgetKey
} from '@renderer/core/engines/LayoutManager'

interface LayoutStoreState {
  currentLayoutId: LayoutId
  activeSavedId: string | null
  grid: PanelLayout[]
  savedLayouts: SavedLayout[]
  editMode: boolean
  hydrated: boolean

  hydrate: () => Promise<void>
  setLayout: (id: LayoutId) => void
  updateGrid: (grid: PanelLayout[]) => void
  resetLayout: () => void
  saveCurrentAs: (name: string) => Promise<SavedLayout>
  loadSaved: (id: string) => void
  deleteSaved: (id: string) => Promise<void>
  toggleEdit: () => void
  addWidget: (key: WidgetKey) => void
  removeWidget: (key: WidgetKey) => void
  toggleWidget: (key: WidgetKey) => void
  hasVideo: () => boolean
}

const K = { saved: 'saved', last: 'last', working: (id: string) => `working:${id}` }
let layoutReadVersion = 0

/**
 * A drag/resize emits a grid change per frame; only the settled layout is worth
 * a disk write. Every other layout action flushes first so writes to a key stay
 * in the order they were made.
 */
const GRID_WRITE_DELAY_MS = 400
const gridWriter = createCoalescedWriter(GRID_WRITE_DELAY_MS)

/** `in` would also accept inherited names such as "constructor". */
function isPresetId(value: unknown): value is LayoutId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(LAYOUT_PRESETS, value)
}

export const useLayoutStore = create<LayoutStoreState>((set, get) => ({
  currentLayoutId: 'broadcast-data',
  activeSavedId: null,
  grid: cloneGrid(LAYOUT_PRESETS['broadcast-data'].grid),
  savedLayouts: [],
  editMode: false,
  hydrated: false,

  hydrate: async () => {
    gridWriter.flush()
    const readVersion = ++layoutReadVersion
    const [rawSaved, last] = await Promise.all([
      persist.get<unknown[]>(STORE_NS.LAYOUTS, K.saved),
      persist.get<unknown>(STORE_NS.LAYOUTS, K.last)
    ])
    const savedLayouts = Array.isArray(rawSaved)
      ? rawSaved.map(deserializeSavedLayout).filter((l): l is SavedLayout => l !== null)
      : []
    const layoutId: LayoutId = isPresetId(last) ? last : 'broadcast-data'
    const working = await persist.get<unknown>(STORE_NS.LAYOUTS, K.working(layoutId))
    if (readVersion !== layoutReadVersion) return
    const workingGrid = sanitizeGrid(working)
    set({
      savedLayouts,
      currentLayoutId: layoutId,
      grid: workingGrid.length ? workingGrid : cloneGrid(LAYOUT_PRESETS[layoutId].grid),
      hydrated: true
    })
  },

  setLayout: (id) => {
    gridWriter.flush()
    const readVersion = ++layoutReadVersion
    set({ currentLayoutId: id, activeSavedId: null })
    persist
      .get<unknown>(STORE_NS.LAYOUTS, K.working(id))
      .then((working) => {
        if (readVersion !== layoutReadVersion || get().currentLayoutId !== id) return
        const workingGrid = sanitizeGrid(working)
        set({ grid: workingGrid.length ? workingGrid : cloneGrid(LAYOUT_PRESETS[id].grid) })
      })
      .catch((error: unknown) => {
        console.error(
          `[persist] Could not read the saved grid for layout "${id}", keeping the current one — ${describeError(error)}`
        )
      })
    writeLogged(STORE_NS.LAYOUTS, K.last, id)
  },

  updateGrid: (grid) => {
    layoutReadVersion++
    const sane = sanitizeGrid(grid)
    if (sane.length === 0) return
    set({ grid: sane })
    gridWriter.schedule(STORE_NS.LAYOUTS, K.working(get().currentLayoutId), sane)
  },

  resetLayout: () => {
    gridWriter.flush()
    layoutReadVersion++
    const id = get().currentLayoutId
    const grid = cloneGrid(LAYOUT_PRESETS[id].grid)
    set({ grid, activeSavedId: null })
    writeLogged(STORE_NS.LAYOUTS, K.working(id), grid)
  },

  saveCurrentAs: async (name) => {
    gridWriter.flush()
    layoutReadVersion++
    const layout = createSavedLayout(get().currentLayoutId, name, get().grid)
    const savedLayouts = [...get().savedLayouts, layout]
    set({ savedLayouts, activeSavedId: layout.id })
    await persist.set(STORE_NS.LAYOUTS, K.saved, savedLayouts.map(serializeSavedLayout))
    return layout
  },

  loadSaved: (id) => {
    const layout = get().savedLayouts.find((l) => l.id === id)
    if (!layout) return
    gridWriter.flush()
    layoutReadVersion++
    set({
      currentLayoutId: layout.base,
      activeSavedId: id,
      grid: cloneGrid(layout.grid)
    })
    writeLogged(STORE_NS.LAYOUTS, K.last, layout.base)
    writeLogged(STORE_NS.LAYOUTS, K.working(layout.base), cloneGrid(layout.grid))
  },

  deleteSaved: async (id) => {
    layoutReadVersion++
    const savedLayouts = get().savedLayouts.filter((l) => l.id !== id)
    set({ savedLayouts, activeSavedId: get().activeSavedId === id ? null : get().activeSavedId })
    await persist.set(STORE_NS.LAYOUTS, K.saved, savedLayouts.map(serializeSavedLayout))
  },

  toggleEdit: () => set((s) => ({ editMode: !s.editMode })),

  addWidget: (key) => {
    const grid = get().grid
    if (grid.some((g) => g.i === key)) return
    // Append at the bottom of the grid; vertical compaction tidies it up.
    const maxY = grid.reduce((m, g) => Math.max(m, g.y + g.h), 0)
    get().updateGrid([...grid, defaultPanelFor(key, 0, maxY)])
  },

  removeWidget: (key) => {
    const next = get().grid.filter((g) => g.i !== key)
    if (next.length === 0) return // never leave an empty workspace
    get().updateGrid(next)
  },

  toggleWidget: (key) => {
    if (get().grid.some((g) => g.i === key)) get().removeWidget(key)
    else get().addWidget(key)
  },

  hasVideo: () => gridHasVideo(get().grid)
}))
