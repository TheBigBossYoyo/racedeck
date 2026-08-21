import { describe, it, expect } from 'vitest'
import { STORE_NS } from '@shared/ipc-contract'
import { persist } from '@renderer/store/persist'
import {
  sanitizePanel,
  sanitizeGrid,
  serializeSavedLayout,
  deserializeSavedLayout,
  createSavedLayout,
  cloneGrid,
  gridHasVideo,
  LAYOUT_PRESETS,
  type PanelLayout,
  type SavedLayout
} from '@renderer/core/engines/LayoutManager'

describe('LayoutManager sanitation', () => {
  it('sanitizes a valid panel and rejects an invalid one', () => {
    expect(sanitizePanel({ i: 'timing-tower', x: 1, y: 2, w: 4, h: 5 })).toEqual({
      i: 'timing-tower',
      x: 1,
      y: 2,
      w: 4,
      h: 5,
      minW: 2,
      minH: 3
    })
    expect(sanitizePanel({ i: 'not-a-widget', x: 0, y: 0, w: 1, h: 1 })).toBeNull()
    expect(sanitizePanel({ x: 0 })).toBeNull()
    expect(sanitizePanel(null)).toBeNull()
  })

  it('drops invalid and duplicate panels from a grid', () => {
    const grid = sanitizeGrid([
      { i: 'timing-tower', x: 0, y: 0, w: 4, h: 8 },
      { i: 'timing-tower', x: 4, y: 0, w: 4, h: 8 }, // duplicate key
      { i: 'garbage', x: 0, y: 0, w: 1, h: 1 }, // invalid key
      'nonsense'
    ])
    expect(grid).toHaveLength(1)
    expect(grid[0].i).toBe('timing-tower')
  })

  it('coerces bad numeric fields to safe values', () => {
    const grid = sanitizeGrid([{ i: 'weather', x: -3, y: NaN, w: 0, h: -2 }])
    expect(grid[0]).toMatchObject({ i: 'weather', x: 0, y: 0, w: 1, h: 1 })
  })
})

describe('SavedLayout serialization round-trip', () => {
  it('round-trips a saved layout through serialize/deserialize', () => {
    const layout = createSavedLayout('driver-focus', 'My Focus', LAYOUT_PRESETS['driver-focus'].grid)
    const serialized = serializeSavedLayout(layout)
    const restored = deserializeSavedLayout(JSON.parse(JSON.stringify(serialized)))
    expect(restored).not.toBeNull()
    expect(restored!.id).toBe(layout.id)
    expect(restored!.name).toBe('My Focus')
    expect(restored!.base).toBe('driver-focus')
    expect(restored!.grid).toEqual(layout.grid)
  })

  it('rejects malformed persisted values', () => {
    expect(deserializeSavedLayout(null)).toBeNull()
    expect(deserializeSavedLayout({ id: 'x', name: 'y', base: 'bogus', grid: [] })).toBeNull()
    expect(deserializeSavedLayout({ id: 'x', name: 'y', base: 'driver-focus', grid: [] })).toBeNull()
  })

  it('cloneGrid does not mutate the source preset', () => {
    const clone = cloneGrid(LAYOUT_PRESETS['broadcast-data'].grid)
    clone[0].x = 999
    expect(LAYOUT_PRESETS['broadcast-data'].grid[0].x).not.toBe(999)
  })

  it('detects the presence of the video widget', () => {
    expect(gridHasVideo(LAYOUT_PRESETS['broadcast-data'].grid)).toBe(true)
    const noVideo: PanelLayout[] = [{ i: 'timing-tower', x: 0, y: 0, w: 4, h: 8 }]
    expect(gridHasVideo(noVideo)).toBe(false)
  })

  it('keeps every built-in preset within the 12-column grid with unique widgets', () => {
    for (const preset of Object.values(LAYOUT_PRESETS)) {
      expect(new Set(preset.grid.map((panel) => panel.i)).size).toBe(preset.grid.length)
      for (const panel of preset.grid) {
        expect(panel.x).toBeGreaterThanOrEqual(0)
        expect(panel.x + panel.w).toBeLessThanOrEqual(12)
        expect(panel.w).toBeGreaterThanOrEqual(panel.minW ?? 1)
        expect(panel.h).toBeGreaterThanOrEqual(panel.minH ?? 1)
      }
      for (let i = 0; i < preset.grid.length; i++) {
        for (let j = i + 1; j < preset.grid.length; j++) {
          const a = preset.grid[i]
          const b = preset.grid[j]
          const overlaps = a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
          expect(overlaps, `${preset.id}: ${a.i} overlaps ${b.i}`).toBe(false)
        }
      }
    }
    expect(LAYOUT_PRESETS['qualifying-pro'].grid.some((panel) => panel.i === 'qualifying-monitor')).toBe(true)
    expect(LAYOUT_PRESETS['qualifying-pro'].grid.at(-1)?.i).toBe('weekend-upgrades')
    expect(LAYOUT_PRESETS['practice-lab'].grid.some((panel) => panel.i === 'practice-runs')).toBe(true)
  })

  it('keeps each workspace anchored to its core job', () => {
    const keys = (id: keyof typeof LAYOUT_PRESETS) => new Set(LAYOUT_PRESETS[id].grid.map((panel) => panel.i))
    expect(keys('broadcast-data').has('battle-radar')).toBe(true)
    expect(keys('driver-focus').has('driver-dossier')).toBe(true)
    expect(keys('driver-focus').has('timing-tower')).toBe(true)
    expect(keys('strategy-wall').has('pit-predictor')).toBe(true)
    expect(keys('strategy-wall').has('driver-dossier')).toBe(true)
    expect(keys('strategy-wall').has('pace-battle')).toBe(true)
    expect(keys('qualifying-pro').has('qualifying-monitor')).toBe(true)
    expect(keys('qualifying-pro').has('weekend-upgrades')).toBe(true)
    expect(keys('practice-lab').has('practice-intelligence')).toBe(true)
    expect(keys('practice-lab').has('weekend-upgrades')).toBe(true)
    expect(keys('minimal-watch').has('tod-video')).toBe(true)
  })
})

describe('Layout persistence via the persist adapter', () => {
  it('stores and reloads saved layouts, deserializing each', async () => {
    const a = createSavedLayout('strategy-wall', 'Wall A', LAYOUT_PRESETS['strategy-wall'].grid)
    const b = createSavedLayout('qualifying-pro', 'Quali B', LAYOUT_PRESETS['qualifying-pro'].grid)

    await persist.set(STORE_NS.LAYOUTS, 'saved', [a, b].map(serializeSavedLayout))

    const raw = await persist.get<unknown[]>(STORE_NS.LAYOUTS, 'saved')
    expect(Array.isArray(raw)).toBe(true)

    const restored = (raw ?? [])
      .map(deserializeSavedLayout)
      .filter((l): l is SavedLayout => l !== null)

    expect(restored).toHaveLength(2)
    expect(restored.map((l) => l.name)).toEqual(['Wall A', 'Quali B'])
    expect(restored[0].base).toBe('strategy-wall')
    expect(restored[0].grid).toEqual(a.grid)
  })

  it('persists and removes the last-used layout id', async () => {
    await persist.set(STORE_NS.LAYOUTS, 'last', 'minimal-watch')
    expect(await persist.get(STORE_NS.LAYOUTS, 'last')).toBe('minimal-watch')
    await persist.remove(STORE_NS.LAYOUTS, 'last')
    expect(await persist.get(STORE_NS.LAYOUTS, 'last')).toBeNull()
  })
})
