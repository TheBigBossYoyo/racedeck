import { create } from 'zustand'
import { STORE_NS } from '@shared/ipc-contract'
import { persist } from './persist'
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

export const useLayoutStore = create<LayoutStoreState>((set, get) => ({
  currentLayoutId: 'broadcast-data',
  activeSavedId: null,
  grid: cloneGrid(LAYOUT_PRESETS['broadcast-data'].grid),
  savedLayouts: [],
  editMode: false,
  hydrated: false,

  hydrate: async () => {
    const readVersion = ++layoutReadVersion
    const [rawSaved, last] = await Promise.all([
      persist.get<unknown[]>(STORE_NS.LAYOUTS, K.saved),
      persist.get<LayoutId>(STORE_NS.LAYOUTS, K.last)
    ])
    const savedLayouts = Array.isArray(rawSaved)
      ? rawSaved.map(deserializeSavedLayout).filter((l): l is SavedLayout => l !== null)
      : []
    const layoutId: LayoutId = last && last in LAYOUT_PRESETS ? last : 'broadcast-data'
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
    const readVersion = ++layoutReadVersion
    set({ currentLayoutId: id, activeSavedId: null })
    void persist.get<unknown>(STORE_NS.LAYOUTS, K.working(id)).then((working) => {
      if (readVersion !== layoutReadVersion || get().currentLayoutId !== id) return
      const workingGrid = sanitizeGrid(working)
      set({ grid: workingGrid.length ? workingGrid : cloneGrid(LAYOUT_PRESETS[id].grid) })
    })
    void persist.set(STORE_NS.LAYOUTS, K.last, id)
  },

  updateGrid: (grid) => {
    layoutReadVersion++
    const sane = sanitizeGrid(grid)
    if (sane.length === 0) return
    set({ grid: sane })
    void persist.set(STORE_NS.LAYOUTS, K.working(get().currentLayoutId), sane)
  },

  resetLayout: () => {
    layoutReadVersion++
    const id = get().currentLayoutId
    const grid = cloneGrid(LAYOUT_PRESETS[id].grid)
    set({ grid, activeSavedId: null })
    void persist.set(STORE_NS.LAYOUTS, K.working(id), grid)
  },

  saveCurrentAs: async (name) => {
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
    layoutReadVersion++
    set({
      currentLayoutId: layout.base,
      activeSavedId: id,
      grid: cloneGrid(layout.grid)
    })
    void persist.set(STORE_NS.LAYOUTS, K.last, layout.base)
    void persist.set(STORE_NS.LAYOUTS, K.working(layout.base), cloneGrid(layout.grid))
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
