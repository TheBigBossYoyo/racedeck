import { nanoid } from 'nanoid'

/**
 * LayoutManager — owns the built-in workspaces, the widget
 * catalog, and pure (de)serialization helpers for saved layouts.
 *
 * Grid items are react-grid-layout compatible ({i,x,y,w,h}) but typed locally so
 * this module stays dependency-light and unit-testable.
 */

export type LayoutId =
  | 'broadcast-data'
  | 'driver-focus'
  | 'strategy-wall'
  | 'qualifying-pro'
  | 'practice-lab'
  | 'minimal-watch'

export type WidgetKey =
  | 'tod-video'
  | 'timing-tower'
  | 'qualifying-monitor'
  | 'track-map'
  | 'race-control'
  | 'team-radio'
  | 'weather'
  | 'tyre-strategy'
  | 'gap-chart'
  | 'lap-time-chart'
  | 'position-trend'
  | 'driver-comparison'
  | 'telemetry'
  | 'strategy-insights'
  | 'pit-predictor'
  | 'stint-planner'
  | 'pace-battle'
  | 'driver-dossier'
  | 'ai-engineer'
  | 'team-pace'
  | 'tyre-lab'
  | 'win-probability'
  | 'championship'
  | 'battle-radar'
  | 'race-story'
  | 'engineer-notes'
  | 'alerts'
  | 'sync'
  | 'practice-runs'
  | 'practice-intelligence'
  | 'weekend-upgrades'

export interface PanelLayout {
  i: WidgetKey
  x: number
  y: number
  w: number
  h: number
  minW?: number
  minH?: number
}

export interface LayoutPreset {
  id: LayoutId
  name: string
  description: string
  /** Relative size hint used when (re)entering video modes. */
  videoSize: 'large' | 'medium' | 'small' | 'xl'
  grid: PanelLayout[]
}

export interface WidgetMeta {
  key: WidgetKey
  title: string
  /** Whether this widget renders the embedded TOD surface hole. */
  isVideo?: boolean
  /** Grouping used by the "Add widget" palette. */
  group: 'video' | 'timing' | 'strategy' | 'charts' | 'tools'
  /** Default footprint when added to a layout via the palette. */
  defaultSize: { w: number; h: number; minW: number; minH: number }
}

export const GRID_COLS = 12
export const GRID_ROW_HEIGHT = 26
export const GRID_MARGIN: [number, number] = [10, 10]

const SZ = (w: number, h: number, minW = 3, minH = 5) => ({ w, h, minW, minH })

export const WIDGET_CATALOG: Record<WidgetKey, WidgetMeta> = {
  'tod-video': { key: 'tod-video', title: 'TOD Broadcast', isVideo: true, group: 'video', defaultSize: SZ(6, 12, 4, 8) },
  'timing-tower': { key: 'timing-tower', title: 'Timing Tower', group: 'timing', defaultSize: SZ(4, 14, 3, 8) },
  'qualifying-monitor': { key: 'qualifying-monitor', title: 'Qualifying Monitor', group: 'timing', defaultSize: SZ(5, 15, 4, 10) },
  'track-map': { key: 'track-map', title: 'Track Map', group: 'timing', defaultSize: SZ(3, 9) },
  'race-control': { key: 'race-control', title: 'Race Control', group: 'timing', defaultSize: SZ(3, 9) },
  'team-radio': { key: 'team-radio', title: 'Team Radio', group: 'timing', defaultSize: SZ(3, 8) },
  weather: { key: 'weather', title: 'Weather', group: 'timing', defaultSize: SZ(3, 6) },
  'tyre-strategy': { key: 'tyre-strategy', title: 'Tyre Strategy', group: 'strategy', defaultSize: SZ(4, 10) },
  'gap-chart': { key: 'gap-chart', title: 'Gap to Leader', group: 'charts', defaultSize: SZ(4, 9) },
  'lap-time-chart': { key: 'lap-time-chart', title: 'Lap Times', group: 'charts', defaultSize: SZ(4, 9) },
  'position-trend': { key: 'position-trend', title: 'Position Trend', group: 'charts', defaultSize: SZ(4, 9) },
  'driver-comparison': { key: 'driver-comparison', title: 'Driver Comparison', group: 'strategy', defaultSize: SZ(6, 11, 4, 8) },
  telemetry: { key: 'telemetry', title: 'Telemetry', group: 'charts', defaultSize: SZ(6, 8) },
  'strategy-insights': { key: 'strategy-insights', title: 'Strategy Insights', group: 'strategy', defaultSize: SZ(4, 10) },
  'pit-predictor': { key: 'pit-predictor', title: 'Pit-Now Simulator', group: 'strategy', defaultSize: SZ(4, 17, 4, 12) },
  'stint-planner': { key: 'stint-planner', title: 'Stint Planner', group: 'strategy', defaultSize: SZ(4, 13, 4, 9) },
  'pace-battle': { key: 'pace-battle', title: 'Pace Battle', group: 'strategy', defaultSize: SZ(4, 9, 3, 7) },
  'driver-dossier': { key: 'driver-dossier', title: 'Driver Dossier', group: 'strategy', defaultSize: SZ(4, 20, 4, 14) },
  'ai-engineer': { key: 'ai-engineer', title: 'AI Race Engineer', group: 'strategy', defaultSize: SZ(4, 17, 4, 12) },
  'team-pace': { key: 'team-pace', title: 'Team Pace', group: 'strategy', defaultSize: SZ(4, 11) },
  'tyre-lab': { key: 'tyre-lab', title: 'Tyre Lab', group: 'strategy', defaultSize: SZ(4, 12) },
  'win-probability': { key: 'win-probability', title: 'Win Probability', group: 'strategy', defaultSize: SZ(4, 15, 3, 9) },
  championship: { key: 'championship', title: 'Championship', group: 'strategy', defaultSize: SZ(4, 14, 3, 9) },
  'battle-radar': { key: 'battle-radar', title: 'Battle Radar', group: 'timing', defaultSize: SZ(4, 12, 3, 7) },
  'race-story': { key: 'race-story', title: 'Race Story', group: 'timing', defaultSize: SZ(3, 12, 3, 7) },
  'engineer-notes': { key: 'engineer-notes', title: "Engineer's Notes", group: 'strategy', defaultSize: SZ(4, 12, 3, 7) },
  alerts: { key: 'alerts', title: 'Alert Center', group: 'tools', defaultSize: SZ(4, 6) },
  sync: { key: 'sync', title: 'Sync Controller', group: 'tools', defaultSize: SZ(5, 6) },
  'practice-runs': { key: 'practice-runs', title: 'Practice Run Board', group: 'timing', defaultSize: SZ(5, 16, 4, 10) },
  'practice-intelligence': { key: 'practice-intelligence', title: 'Practice Driver Watch', group: 'timing', defaultSize: SZ(5, 16, 4, 10) },
  'weekend-upgrades': { key: 'weekend-upgrades', title: 'Weekend Upgrades', group: 'strategy', defaultSize: SZ(4, 14, 4, 9) }
}

/** Default panel for a widget added via the palette. */
export function defaultPanelFor(key: WidgetKey, x = 0, y = 0): PanelLayout {
  const d = WIDGET_CATALOG[key].defaultSize
  return { i: key, x, y, w: d.w, h: d.h, minW: d.minW, minH: d.minH }
}

const P = (
  i: WidgetKey,
  x: number,
  y: number,
  w: number,
  h: number,
  minW = 2,
  minH = 3
): PanelLayout => ({ i, x, y, w, h, minW, minH })

export const LAYOUT_PRESETS: Record<LayoutId, LayoutPreset> = {
  'broadcast-data': {
    id: 'broadcast-data',
    name: 'Broadcast + Data',
    description: 'Race command: broadcast, classification, battles, story and essential strategy.',
    videoSize: 'large',
    grid: [
      P('tod-video', 0, 0, 8, 17, 4, 8),
      P('timing-tower', 8, 0, 4, 17, 3, 8),
      P('track-map', 0, 17, 4, 9),
      P('battle-radar', 4, 17, 4, 9, 3, 7),
      P('race-control', 8, 17, 4, 9),
      P('race-story', 0, 26, 4, 10, 3, 7),
      P('gap-chart', 4, 26, 4, 10),
      P('tyre-strategy', 8, 26, 4, 10),
      P('weather', 0, 36, 3, 5),
      P('alerts', 3, 36, 4, 5),
      P('sync', 7, 36, 5, 5)
    ]
  },
  'driver-focus': {
    id: 'driver-focus',
    name: 'Driver Focus',
    description: 'Driver engineering desk: dossier, classification, traces, rivals and strategy.',
    videoSize: 'small',
    grid: [
      P('driver-dossier', 0, 0, 4, 19, 4, 14),
      P('tod-video', 4, 0, 5, 11, 4, 8),
      P('timing-tower', 9, 0, 3, 19, 3, 8),
      P('driver-comparison', 4, 11, 5, 8, 4, 8),
      P('track-map', 0, 19, 4, 9),
      P('lap-time-chart', 4, 19, 4, 9),
      P('pace-battle', 8, 19, 4, 9, 3, 7),
      P('telemetry', 0, 28, 8, 9),
      P('pit-predictor', 8, 28, 4, 17, 4, 12),
      P('stint-planner', 0, 37, 4, 13, 4, 9),
      P('win-probability', 4, 37, 4, 15, 3, 9)
    ]
  },
  'strategy-wall': {
    id: 'strategy-wall',
    name: 'Strategy Wall',
    description: 'Pit-wall command: driver call, rejoin risk, race plan, win outlook and live engineering context.',
    videoSize: 'medium',
    grid: [
      P('timing-tower', 0, 0, 3, 18, 3, 8),
      P('driver-dossier', 3, 0, 3, 18, 3, 14),
      P('pit-predictor', 6, 0, 3, 18, 3, 12),
      P('strategy-insights', 9, 0, 3, 18, 3, 7),
      P('tod-video', 0, 18, 4, 13, 3, 8),
      P('stint-planner', 4, 18, 4, 13, 4, 9),
      P('win-probability', 8, 18, 4, 13, 3, 9),
      P('pace-battle', 0, 31, 3, 11, 3, 7),
      P('ai-engineer', 3, 31, 5, 11, 4, 9),
      P('tyre-lab', 8, 31, 4, 11, 3, 9)
    ]
  },
  'qualifying-pro': {
    id: 'qualifying-pro',
    name: 'Qualifying Pro',
    description: 'Qualifying command: cutline, run state, sectors, track evolution and driver traces.',
    videoSize: 'large',
    grid: [
      P('tod-video', 0, 0, 8, 18, 5, 10),
      P('qualifying-monitor', 8, 0, 4, 18, 4, 10),
      P('timing-tower', 0, 18, 4, 16, 3, 8),
      P('lap-time-chart', 4, 18, 4, 10),
      P('driver-comparison', 8, 18, 4, 10, 4, 8),
      P('telemetry', 4, 28, 8, 9),
      P('track-map', 0, 34, 4, 9),
      P('race-control', 4, 37, 5, 8),
      P('weather', 9, 37, 3, 8),
      P('weekend-upgrades', 0, 45, 12, 13, 4, 9)
    ]
  },
  'practice-lab': {
    id: 'practice-lab',
    name: 'Practice Lab',
    description: 'Practice engineering: run programmes, rookie swaps, long-run pace and weekend upgrades.',
    videoSize: 'large',
    grid: [
      P('tod-video', 0, 0, 7, 16, 5, 10),
      P('practice-runs', 7, 0, 5, 16, 4, 10),
      P('timing-tower', 0, 16, 3, 16, 3, 8),
      P('practice-intelligence', 3, 16, 5, 16, 4, 10),
      P('weekend-upgrades', 8, 16, 4, 16, 4, 9),
      P('lap-time-chart', 0, 32, 4, 10),
      P('telemetry', 4, 32, 8, 10),
      P('team-pace', 0, 42, 4, 11),
      P('tyre-lab', 4, 42, 4, 12),
      P('weather', 8, 42, 4, 6),
      P('track-map', 8, 48, 4, 9)
    ]
  },
  'minimal-watch': {
    id: 'minimal-watch',
    name: 'Minimal Watch',
    description: 'Lean race view: maximum broadcast, compact timing and a readable essentials strip.',
    videoSize: 'xl',
    grid: [
      P('tod-video', 0, 0, 9, 21, 5, 10),
      P('timing-tower', 9, 0, 3, 15, 3, 8),
      P('alerts', 9, 15, 3, 6),
      P('race-control', 0, 21, 5, 7),
      P('weather', 5, 21, 3, 7),
      P('track-map', 8, 21, 4, 7)
    ]
  }
}

export const LAYOUT_ORDER: LayoutId[] = [
  'broadcast-data',
  'driver-focus',
  'strategy-wall',
  'qualifying-pro',
  'practice-lab',
  'minimal-watch'
]

// ── Saved layouts (persistable) ──────────────────────────────────────────────

export interface SavedLayout {
  id: string
  name: string
  base: LayoutId
  grid: PanelLayout[]
  createdAt: string
  updatedAt: string
}

const VALID_KEYS = new Set(Object.keys(WIDGET_CATALOG) as WidgetKey[])

/** Deep-clone a grid so presets are never mutated by drag/resize. */
export function cloneGrid(grid: PanelLayout[]): PanelLayout[] {
  return grid.map((g) => ({ ...g }))
}

/** Validate & sanitize a single grid item; returns null if unusable. */
export function sanitizePanel(input: unknown): PanelLayout | null {
  if (!input || typeof input !== 'object') return null
  const p = input as Record<string, unknown>
  if (typeof p.i !== 'string' || !VALID_KEYS.has(p.i as WidgetKey)) return null
  const num = (v: unknown, fallback: number): number =>
    typeof v === 'number' && isFinite(v) ? v : fallback
  return {
    i: p.i as WidgetKey,
    x: Math.max(0, Math.round(num(p.x, 0))),
    y: Math.max(0, Math.round(num(p.y, 0))),
    w: Math.max(1, Math.round(num(p.w, 3))),
    h: Math.max(1, Math.round(num(p.h, 3))),
    minW: typeof p.minW === 'number' ? p.minW : 2,
    minH: typeof p.minH === 'number' ? p.minH : 3
  }
}

/** Sanitize a full grid, dropping invalid/duplicate panels. */
export function sanitizeGrid(input: unknown): PanelLayout[] {
  if (!Array.isArray(input)) return []
  const seen = new Set<string>()
  const out: PanelLayout[] = []
  for (const item of input) {
    const panel = sanitizePanel(item)
    if (panel && !seen.has(panel.i)) {
      seen.add(panel.i)
      out.push(panel)
    }
  }
  return out
}

/** Serialize a saved layout to a JSON-safe object for persistence. */
export function serializeSavedLayout(layout: SavedLayout): SavedLayout {
  return {
    id: layout.id,
    name: layout.name,
    base: layout.base,
    grid: cloneGrid(layout.grid),
    createdAt: layout.createdAt,
    updatedAt: layout.updatedAt
  }
}

/** Parse a persisted value back into a SavedLayout, or null if invalid. */
export function deserializeSavedLayout(input: unknown): SavedLayout | null {
  if (!input || typeof input !== 'object') return null
  const o = input as Record<string, unknown>
  if (typeof o.id !== 'string' || typeof o.name !== 'string') return null
  if (!isLayoutId(o.base)) return null
  const grid = sanitizeGrid(o.grid)
  if (grid.length === 0) return null
  const now = new Date().toISOString()
  return {
    id: o.id,
    name: o.name,
    base: o.base,
    grid,
    createdAt: typeof o.createdAt === 'string' ? o.createdAt : now,
    updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : now
  }
}

export function isLayoutId(v: unknown): v is LayoutId {
  return typeof v === 'string' && v in LAYOUT_PRESETS
}

export function createSavedLayout(base: LayoutId, name: string, grid: PanelLayout[]): SavedLayout {
  const now = new Date().toISOString()
  return { id: nanoid(8), name, base, grid: cloneGrid(grid), createdAt: now, updatedAt: now }
}

/** The widgets present in a given grid (used to drive video visibility etc.). */
export function widgetsInGrid(grid: PanelLayout[]): WidgetKey[] {
  return grid.map((g) => g.i)
}

export function gridHasVideo(grid: PanelLayout[]): boolean {
  return grid.some((g) => WIDGET_CATALOG[g.i]?.isVideo)
}
