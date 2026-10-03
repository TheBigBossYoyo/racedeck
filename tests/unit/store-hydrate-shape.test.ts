import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { STORE_NS } from '@shared/ipc-contract'
import { persist } from '@renderer/store/persist'
import { useProfileStore } from '@renderer/store/profileStore'
import {
  MAX_PERSISTED_TRANSCRIPTS,
  useRadioTranscriptStore
} from '@renderer/store/radioTranscriptStore'
import { usePluginStore } from '@renderer/store/pluginStore'
import { useAnnotationsStore } from '@renderer/store/annotationsStore'
import { useComparisonLibraryStore } from '@renderer/store/comparisonLibraryStore'
import { useLayoutStore } from '@renderer/store/layoutStore'
import { LAYOUT_PRESETS } from '@renderer/core/engines/LayoutManager'

const WRONG_SHAPES: Array<[string, unknown]> = [
  ['string', 'not-valid'],
  ['number', 42],
  ['object', { a: 1 }],
  ['array', ['x', 3, null]],
  ['null', null]
]

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('profileStore.hydrate', () => {
  const validProfile = {
    sessionType: 'race',
    favoriteDrivers: [1, 44],
    layoutId: 'driver-focus',
    savedLayoutId: null,
    alertOverrides: { weather: false }
  }

  for (const [label, bad] of WRONG_SHAPES) {
    it(`yields no profiles when the persisted map is a ${label}`, async () => {
      await persist.set(STORE_NS.PROFILES, 'all', bad)
      await expect(useProfileStore.getState().hydrate()).resolves.toBeUndefined()
      const { profiles, hydrated } = useProfileStore.getState()
      expect(hydrated).toBe(true)
      expect(profiles).toEqual({})
    })

    it(`falls back to autoApply=true when it is a ${label}`, async () => {
      await persist.set(STORE_NS.PROFILES, 'autoApply', bad)
      await useProfileStore.getState().hydrate()
      expect(useProfileStore.getState().autoApply).toBe(true)
    })
  }

  it('keeps a valid profile and drops damaged or unknown ones', async () => {
    await persist.set(STORE_NS.PROFILES, 'all', {
      race: validProfile,
      practice: { ...validProfile, favoriteDrivers: 'nope' },
      qualifying: 'text',
      sprint: { ...validProfile, alertOverrides: 5 },
      bogusType: validProfile
    })
    await useProfileStore.getState().hydrate()
    expect(Object.keys(useProfileStore.getState().profiles)).toEqual(['race'])
    expect(useProfileStore.getState().profiles.race).toMatchObject({
      favoriteDrivers: [1, 44],
      layoutId: 'driver-focus'
    })
  })

  it('cleans nested fields of a kept profile, never trusting critical alert keys', async () => {
    await persist.set(STORE_NS.PROFILES, 'all', {
      race: {
        ...validProfile,
        favoriteDrivers: [1, 'x', -3, 44],
        layoutId: 'no-such-layout',
        savedLayoutId: 12,
        alertOverrides: { weather: false, redFlag: false, pitStop: 'no', bogus: 1 }
      }
    })
    await useProfileStore.getState().hydrate()
    const profile = useProfileStore.getState().profiles.race
    expect(profile?.favoriteDrivers).toEqual([1, 44])
    expect(profile?.layoutId).toBeNull()
    expect(profile?.savedLayoutId).toBeNull()
    expect(profile?.alertOverrides).toEqual({ weather: false })
  })

  it('a hydrated profile can be applied without throwing', async () => {
    await persist.set(STORE_NS.PROFILES, 'all', { race: validProfile })
    await useProfileStore.getState().hydrate()
    expect(() => useProfileStore.getState().applyProfile('race')).not.toThrow()
  })
})

describe('radioTranscriptStore', () => {
  const done = (text: string) => ({ status: 'done', text, error: null })

  for (const [label, bad] of WRONG_SHAPES) {
    it(`hydrates to an empty cache when the persisted entries are a ${label}`, async () => {
      await persist.set(STORE_NS.RADIO_TRANSCRIPTS, 'entries', bad)
      await useRadioTranscriptStore.getState().hydrate()
      expect(useRadioTranscriptStore.getState().entries).toEqual({})
      expect(useRadioTranscriptStore.getState().hydrated).toBe(true)
    })
  }

  it('keeps only finished transcripts with a text body', async () => {
    await persist.set(STORE_NS.RADIO_TRANSCRIPTS, 'entries', {
      'https://a': done('hello'),
      'https://stuck': { status: 'loading', text: '', error: null },
      'https://failed': { status: 'error', text: '', error: 'boom' },
      'https://notext': { status: 'done', text: 5, error: null },
      'https://junk': 'x'
    })
    await useRadioTranscriptStore.getState().hydrate()
    expect(useRadioTranscriptStore.getState().entries).toEqual({ 'https://a': done('hello') })
  })

  it('caps the persisted transcripts, evicting the oldest first', async () => {
    const over = MAX_PERSISTED_TRANSCRIPTS + 25
    const entries: Record<string, unknown> = {}
    for (let i = 0; i < over; i++) entries[`https://clip/${i}`] = done(`t${i}`)
    await persist.set(STORE_NS.RADIO_TRANSCRIPTS, 'entries', entries)
    await useRadioTranscriptStore.getState().hydrate()

    const kept = Object.keys(useRadioTranscriptStore.getState().entries)
    expect(kept).toHaveLength(MAX_PERSISTED_TRANSCRIPTS)
    expect(kept[0]).toBe('https://clip/25')
    expect(kept.at(-1)).toBe(`https://clip/${over - 1}`)
  })

  it('never persists in-flight or failed entries, and caps what it writes', async () => {
    const seeded: Record<string, unknown> = {}
    for (let i = 0; i < MAX_PERSISTED_TRANSCRIPTS; i++) seeded[`https://clip/${i}`] = done(`t${i}`)
    seeded['https://loading'] = { status: 'loading', text: '', error: null }
    useRadioTranscriptStore.setState({ entries: seeded as never, hydrated: true })

    Object.assign(window, {
      racedeck: {
        ai: { transcribe: vi.fn().mockResolvedValue({ ok: true, text: 'fresh' }) },
        store: { get: vi.fn(), set: vi.fn(), delete: vi.fn(), all: vi.fn() }
      }
    })
    const setSpy = vi.spyOn(persist, 'set').mockResolvedValue()
    try {
      await useRadioTranscriptStore.getState().transcribe('https://clip/new')
    } finally {
      delete (window as { racedeck?: unknown }).racedeck
    }

    const call = setSpy.mock.calls.find(([ns]) => ns === STORE_NS.RADIO_TRANSCRIPTS)
    const written = call?.[2] as Record<string, { status: string }>
    expect(Object.keys(written)).toHaveLength(MAX_PERSISTED_TRANSCRIPTS)
    expect(written['https://clip/0']).toBeUndefined() // oldest evicted
    expect(written['https://clip/new']).toMatchObject({ status: 'done', text: 'fresh' })
    expect(written['https://loading']).toBeUndefined()
  })

  it('records an error instead of sticking on loading when the bridge throws', async () => {
    Object.assign(window, {
      racedeck: {
        ai: { transcribe: vi.fn().mockRejectedValue(new Error('ipc down')) },
        store: { get: vi.fn(), set: vi.fn(), delete: vi.fn(), all: vi.fn() }
      }
    })
    useRadioTranscriptStore.setState({ entries: {}, hydrated: true })
    try {
      await useRadioTranscriptStore.getState().transcribe('https://clip/x')
    } finally {
      delete (window as { racedeck?: unknown }).racedeck
    }
    expect(useRadioTranscriptStore.getState().entries['https://clip/x']).toMatchObject({
      status: 'error',
      error: expect.stringContaining('ipc down')
    })
  })
})

describe('pluginStore.hydrate', () => {
  for (const [label, bad] of WRONG_SHAPES) {
    it(`yields no plugins when the persisted value is a ${label}`, async () => {
      await persist.set(STORE_NS.PLUGINS, 'entries', bad)
      await expect(usePluginStore.getState().hydrate()).resolves.toBeUndefined()
      expect(usePluginStore.getState().plugins).toEqual([])
      expect(usePluginStore.getState().hydrated).toBe(true)
    })
  }

  it('keeps the valid plugins when one entry is damaged, and drops unknown feeds', async () => {
    await persist.set(STORE_NS.PLUGINS, 'entries', [
      { id: 'a', name: 'A', source: 'function compute(){}', requiredFeeds: ['timing', 'nope'] },
      { id: 'b', name: 'B', source: 5, requiredFeeds: [] },
      'junk',
      { id: 'c', name: 'C', source: 'x', requiredFeeds: 'timing' }
    ])
    await usePluginStore.getState().hydrate()
    expect(usePluginStore.getState().plugins).toEqual([
      { id: 'a', name: 'A', source: 'function compute(){}', requiredFeeds: ['timing'] }
    ])
  })
})

describe('annotationsStore.hydrateForSession', () => {
  for (const [label, bad] of WRONG_SHAPES) {
    it(`yields no annotations when the persisted value is a ${label}`, async () => {
      await persist.set(STORE_NS.ANNOTATIONS, 's1', bad)
      await expect(useAnnotationsStore.getState().hydrateForSession('s1')).resolves.toBeUndefined()
      expect(useAnnotationsStore.getState().annotations).toEqual([])
      expect(useAnnotationsStore.getState().sessionId).toBe('s1')
    })
  }

  it('recovers with an empty list when the read itself fails', async () => {
    vi.spyOn(persist, 'get').mockRejectedValueOnce(new Error('read failed'))
    await expect(useAnnotationsStore.getState().hydrateForSession('s2')).resolves.toBeUndefined()
    expect(useAnnotationsStore.getState().annotations).toEqual([])
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('s2'))
  })
})

describe('comparisonLibraryStore.hydrate', () => {
  const summary = (sessionId: string) => ({
    sessionId,
    meetingName: 'Monza',
    sessionName: 'Race',
    dateStart: '2024-09-01T13:00:00Z',
    pitLossMedianSec: 21.5,
    degradationByCompound: { SOFT: 0.08, HARD: null },
    topSpeedKmh: 340,
    teamPaceMs: { Ferrari: 81000 },
    weather: { avgTrackTempC: 40, avgAirTempC: 28, rainFraction: 0 }
  })

  for (const [label, bad] of WRONG_SHAPES) {
    it(`yields no entries when the persisted value is a ${label}`, async () => {
      await persist.set(STORE_NS.COMPARISON_LIBRARY, 'entries', bad)
      await expect(useComparisonLibraryStore.getState().hydrate()).resolves.toBeUndefined()
      expect(useComparisonLibraryStore.getState().entries).toEqual([])
      expect(useComparisonLibraryStore.getState().hydrated).toBe(true)
    })
  }

  it('round-trips a valid summary unchanged', async () => {
    await persist.set(STORE_NS.COMPARISON_LIBRARY, 'entries', [summary('a')])
    await useComparisonLibraryStore.getState().hydrate()
    expect(useComparisonLibraryStore.getState().entries).toEqual([summary('a')])
  })

  it('drops entries the comparison table would crash on', async () => {
    await persist.set(STORE_NS.COMPARISON_LIBRARY, 'entries', [
      summary('ok'),
      { sessionId: 'no-weather', sessionName: 'Race' },
      { ...summary('bad-pace'), teamPaceMs: 'x' },
      { ...summary('no-name'), sessionName: undefined },
      'junk',
      null
    ])
    await useComparisonLibraryStore.getState().hydrate()
    expect(useComparisonLibraryStore.getState().entries.map((e) => e.sessionId)).toEqual(['ok'])
  })

  it('nulls unmeasured numbers rather than guessing', async () => {
    await persist.set(STORE_NS.COMPARISON_LIBRARY, 'entries', [
      { ...summary('n'), pitLossMedianSec: 'fast', topSpeedKmh: Number.NaN, meetingName: 7 }
    ])
    await useComparisonLibraryStore.getState().hydrate()
    expect(useComparisonLibraryStore.getState().entries[0]).toMatchObject({
      pitLossMedianSec: null,
      topSpeedKmh: null,
      meetingName: null
    })
  })
})

describe('layoutStore.hydrate', () => {
  it('ignores a last-used layout id that is only an inherited object property', async () => {
    await persist.set(STORE_NS.LAYOUTS, 'last', 'constructor')
    await useLayoutStore.getState().hydrate()
    expect(useLayoutStore.getState().currentLayoutId).toBe('broadcast-data')
    expect(useLayoutStore.getState().grid.length).toBe(LAYOUT_PRESETS['broadcast-data'].grid.length)
  })

  for (const [label, bad] of WRONG_SHAPES) {
    it(`survives a saved-layouts value that is a ${label}`, async () => {
      await persist.set(STORE_NS.LAYOUTS, 'saved', bad)
      await persist.set(STORE_NS.LAYOUTS, 'last', bad)
      await expect(useLayoutStore.getState().hydrate()).resolves.toBeUndefined()
      expect(useLayoutStore.getState().savedLayouts).toEqual([])
      expect(useLayoutStore.getState().currentLayoutId).toBe('broadcast-data')
    })
  }
})
