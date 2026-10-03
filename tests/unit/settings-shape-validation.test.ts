import { beforeEach, describe, expect, it, vi } from 'vitest'
import { STORE_NS } from '@shared/ipc-contract'
import { DEFAULT_TOD_URL, SYNC_MAX_OFFSET } from '@shared/constants'
import { defaultAiConfig } from '@shared/ai'
import { persist } from '@renderer/store/persist'
import {
  defaultMarketConfig,
  defaultVoiceConfig,
  normalizeAlerts,
  normalizeFavorites,
  normalizeModules,
  normalizeSyncPresets,
  normalizeTheme,
  normalizeTodPrefs,
  SettingsPersistError,
  useSettingsStore
} from '@renderer/store/settingsStore'
import { DEFAULT_THEME } from '@renderer/core/engines/ThemeEngine'
import { DEFAULT_ALERT_CONFIG } from '@renderer/core/engines/AlertEngine'
import { defaultUnitsConfig } from '@renderer/lib/units'

/** Valid JSON that is the wrong shape for every settings value. */
const WRONG_SHAPES: Array<[string, unknown]> = [
  ['string', 'not-an-object'],
  ['number', 42],
  ['array', ['x', {}]],
  ['boolean', true],
  ['null', null]
]

/** Where each persisted setting lives, as hydrate reads it. */
const SLOTS: Array<{ field: string; ns: string; key: string }> = [
  { field: 'theme', ns: STORE_NS.SETTINGS, key: 'theme' },
  { field: 'alerts', ns: STORE_NS.ALERTS, key: 'alerts' },
  { field: 'favorites', ns: STORE_NS.FAVORITES, key: 'favorites' },
  { field: 'tod', ns: STORE_NS.SETTINGS, key: 'tod' },
  { field: 'ai', ns: STORE_NS.SETTINGS, key: 'ai' },
  { field: 'market', ns: STORE_NS.SETTINGS, key: 'market' },
  { field: 'voice', ns: STORE_NS.SETTINGS, key: 'voice' },
  { field: 'modules', ns: STORE_NS.SETTINGS, key: 'modules' },
  { field: 'performanceMode', ns: STORE_NS.SETTINGS, key: 'performanceMode' },
  { field: 'syncPresets', ns: STORE_NS.SYNC, key: 'syncPresets' },
  { field: 'units', ns: STORE_NS.SETTINGS, key: 'units' }
]

/** `true` is a valid value for a boolean setting, so it is not a wrong shape there. */
function wrongShapesFor(field: string): Array<[string, unknown]> {
  return field === 'performanceMode' ? WRONG_SHAPES.filter(([label]) => label !== 'boolean') : WRONG_SHAPES
}

function expectDefaults(): void {
  const s = useSettingsStore.getState()
  expect(s.theme).toEqual(DEFAULT_THEME)
  expect(s.alerts).toEqual(DEFAULT_ALERT_CONFIG)
  expect(s.favorites).toEqual([])
  expect(s.tod).toEqual({ autoFallback: true, url: DEFAULT_TOD_URL })
  expect(Object.keys(s.ai).sort()).toEqual(Object.keys(defaultAiConfig()).sort())
  expect(s.market).toEqual(defaultMarketConfig())
  expect(s.voice).toEqual(defaultVoiceConfig())
  expect(s.modules['timing-tower']).toBe(true)
  expect(Object.values(s.modules).every((v) => typeof v === 'boolean')).toBe(true)
  expect(s.performanceMode).toBe(false)
  expect(s.syncPresets).toEqual([])
  expect(s.units).toEqual(defaultUnitsConfig())
}

describe('settings normalizers', () => {
  it('normalizeTheme repairs field by field and keeps valid values', () => {
    expect(
      normalizeTheme({ mode: 'bogus', accent: 5, density: 'compact', fontScale: 'big', teamColorMode: 'yes' })
    ).toEqual({ ...DEFAULT_THEME, density: 'compact' })
    expect(normalizeTheme({ mode: 'light', accent: 'violet', fontScale: 1.2 })).toMatchObject({
      mode: 'light',
      accent: 'violet',
      fontScale: 1.2
    })
  })

  it('normalizeTheme refuses accents that are only inherited object properties', () => {
    expect(normalizeTheme({ accent: 'constructor' }).accent).toBe(DEFAULT_THEME.accent)
  })

  it('normalizeTheme clamps a font scale that would make the UI unusable', () => {
    expect(normalizeTheme({ fontScale: 0 }).fontScale).toBeGreaterThan(0)
    expect(normalizeTheme({ fontScale: 1e9 }).fontScale).toBeLessThanOrEqual(2)
    expect(normalizeTheme({ fontScale: Number.NaN }).fontScale).toBe(DEFAULT_THEME.fontScale)
  })

  it('normalizeAlerts keeps known flags, drops the rest, and takes favorites from the caller', () => {
    const out = normalizeAlerts({ weather: false, pitStop: 'no', bogus: true, intervalThresholdSec: -4 }, [7])
    expect(out).toEqual({ ...DEFAULT_ALERT_CONFIG, weather: false, favorites: [7] })
  })

  it('normalizeFavorites keeps unique positive integers only', () => {
    expect(normalizeFavorites([1, '2', null, 3.5, -1, 0, 1, 44])).toEqual([1, 44])
    expect(normalizeFavorites({ 0: 1 })).toEqual([])
    expect(normalizeFavorites('12')).toEqual([])
  })

  it('normalizeModules keeps only known widgets with boolean flags', () => {
    const out = normalizeModules({ weather: false, 'timing-tower': 'yes', 'not-a-widget': true })
    expect(out.weather).toBe(false)
    expect(out['timing-tower']).toBe(true)
    expect(out).not.toHaveProperty('not-a-widget')
  })

  it('normalizeSyncPresets drops malformed presets and clamps the offset', () => {
    const out = normalizeSyncPresets([
      { id: 'a', name: 'ok', offset: 12, broadcaster: 'TOD' },
      { id: 'b', name: 'far', offset: 99999, broadcaster: 'Sky' },
      { id: 1, name: 'bad id', offset: 1, broadcaster: 'x' },
      { id: 'c', name: 'nan', offset: Number.NaN, broadcaster: 'x' },
      'junk',
      null
    ])
    expect(out).toEqual([
      { id: 'a', name: 'ok', offset: 12, broadcaster: 'TOD' },
      { id: 'b', name: 'far', offset: SYNC_MAX_OFFSET, broadcaster: 'Sky' }
    ])
    expect(normalizeSyncPresets({ a: 1 })).toEqual([])
  })

  it('normalizeTodPrefs rejects wrong-typed fields', () => {
    expect(normalizeTodPrefs({ autoFallback: 'no', url: 12 })).toEqual({
      autoFallback: true,
      url: DEFAULT_TOD_URL
    })
    expect(normalizeTodPrefs('junk')).toEqual({ autoFallback: true, url: DEFAULT_TOD_URL })
  })
})

describe('settingsStore.hydrate with wrong-shape persisted values', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    useSettingsStore.setState({ hydrated: false })
  })

  for (const slot of SLOTS) {
    for (const [label, bad] of wrongShapesFor(slot.field)) {
      it(`falls back to defaults when ${slot.field} is a ${label}`, async () => {
        await persist.set(slot.ns, slot.key, bad)
        await expect(useSettingsStore.getState().hydrate()).resolves.toBeUndefined()
        expect(useSettingsStore.getState().hydrated).toBe(true)
        expectDefaults()
      })
    }
  }

  it('treats favorites persisted as an object as empty and stays usable', async () => {
    await persist.set(STORE_NS.FAVORITES, 'favorites', { 0: 1, length: 1 })
    await useSettingsStore.getState().hydrate()
    expect(() => useSettingsStore.getState().toggleFavorite(44)).not.toThrow()
    expect(useSettingsStore.getState().favorites).toEqual([44])
    expect(useSettingsStore.getState().alerts.favorites).toEqual([44])
  })

  it('does not enable performance mode from a truthy non-boolean', async () => {
    await persist.set(STORE_NS.SETTINGS, 'performanceMode', 'false')
    await useSettingsStore.getState().hydrate()
    expect(useSettingsStore.getState().performanceMode).toBe(false)
  })
})

describe('settingsStore.importAll with wrong-shape values', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  for (const slot of SLOTS) {
    for (const [label, bad] of wrongShapesFor(slot.field)) {
      it(`imports defaults when ${slot.field} is a ${label}`, async () => {
        await expect(
          useSettingsStore.getState().importAll({ [slot.field]: bad })
        ).resolves.toBeUndefined()
        expectDefaults()
      })
    }
  }

  it('rejects a backup that is not a JSON object', async () => {
    for (const bad of [null, 'text', 7, [1, 2]]) {
      await expect(useSettingsStore.getState().importAll(bad as never)).rejects.toThrow(/object/i)
    }
  })

  it('persists only the normalized values', async () => {
    await useSettingsStore.getState().importAll({ favorites: [1, 'x', 2], theme: { mode: 'nope' } })
    expect(await persist.get(STORE_NS.FAVORITES, 'favorites')).toEqual([1, 2])
    expect(await persist.get(STORE_NS.SETTINGS, 'theme')).toEqual(DEFAULT_THEME)
  })

  it('round-trips a real export', async () => {
    useSettingsStore.getState().setFavorites([1, 44])
    useSettingsStore.getState().setTheme({ accent: 'rose', fontScale: 1.1 })
    useSettingsStore.getState().setModule('weather', false)
    useSettingsStore.getState().addSyncPreset('p', 5, 'TOD')
    const exported = JSON.parse(JSON.stringify(useSettingsStore.getState().exportAll()))
    const before = useSettingsStore.getState()

    await useSettingsStore.getState().importAll(exported)

    const after = useSettingsStore.getState()
    expect(after.favorites).toEqual(before.favorites)
    expect(after.theme).toEqual(before.theme)
    expect(after.modules).toEqual(before.modules)
    expect(after.syncPresets).toEqual(before.syncPresets)
    expect(after.alerts).toEqual(before.alerts)
  })
})

describe('settingsStore.importAll persistence failure', () => {
  it('applies the settings in memory but reports that they could not be saved', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(persist, 'set').mockRejectedValue(new Error('disk full'))
    try {
      await expect(
        useSettingsStore.getState().importAll({ favorites: [5, 6] })
      ).rejects.toBeInstanceOf(SettingsPersistError)
      expect(useSettingsStore.getState().favorites).toEqual([5, 6])
    } finally {
      vi.restoreAllMocks()
    }
  })
})
