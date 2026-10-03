import { beforeEach, describe, expect, it } from 'vitest'
import { STORE_NS } from '@shared/ipc-contract'
import {
  AI_PROVIDERS,
  defaultAiConfig,
  isAiConfigReady,
  mergeImportedAi,
  normalizeAiConfig,
  type AiConfig
} from '@shared/ai'
import { persist } from '@renderer/store/persist'
import { useSettingsStore } from '@renderer/store/settingsStore'

const CORRUPT = { model: 5, apiKey: {}, baseUrl: 7, enabled: 'yes', provider: 'constructor' }

function expectWellFormed(ai: AiConfig): void {
  expect(typeof ai.model).toBe('string')
  expect(typeof ai.apiKey).toBe('string')
  expect(typeof ai.baseUrl).toBe('string')
  expect(typeof ai.enabled).toBe('boolean')
  expect(Object.hasOwn(AI_PROVIDERS, ai.provider)).toBe(true)
}

describe('normalizeAiConfig', () => {
  it('yields a well-formed config from a corrupt persisted shape', () => {
    const ai = normalizeAiConfig(CORRUPT)
    expectWellFormed(ai)
    expect(ai).toEqual(defaultAiConfig())
  })

  it('returns defaults for non-record input', () => {
    for (const raw of [null, undefined, 'x', 42, ['a'], true]) {
      expect(normalizeAiConfig(raw)).toEqual(defaultAiConfig())
    }
  })

  it('keeps valid fields and treats only boolean true as enabled', () => {
    const ai = normalizeAiConfig({ provider: 'groq', apiKey: 'k', model: 'm', baseUrl: 'u', enabled: true })
    expect(ai).toEqual({ provider: 'groq', apiKey: 'k', model: 'm', baseUrl: 'u', enabled: true })
    expect(normalizeAiConfig({ enabled: 1 }).enabled).toBe(false)
  })

  it('defaults a missing or wrong-typed model/baseUrl from the chosen provider, not from gemini', () => {
    const ai = normalizeAiConfig({ provider: 'groq', model: 5, baseUrl: null })
    expect(ai.provider).toBe('groq')
    expect(ai.model).toBe(AI_PROVIDERS.groq.defaultModel)
    expect(ai.baseUrl).toBe(AI_PROVIDERS.groq.baseUrl)
  })
})

describe('isAiConfigReady tolerates non-string fields', () => {
  it('returns false instead of throwing', () => {
    const bad = { ...defaultAiConfig(), ...CORRUPT, provider: 'gemini' } as unknown as AiConfig
    expect(() => isAiConfigReady(bad)).not.toThrow()
    expect(isAiConfigReady(bad)).toBe(false)
    const badKey = { ...defaultAiConfig(), enabled: true, apiKey: {} } as unknown as AiConfig
    expect(() => isAiConfigReady(badKey)).not.toThrow()
    expect(isAiConfigReady(badKey)).toBe(false)
  })

  it('still accepts a good config', () => {
    expect(isAiConfigReady({ ...defaultAiConfig(), apiKey: 'k', enabled: true })).toBe(true)
  })
})

describe('settingsStore AI validation', () => {
  beforeEach(() => {
    persist.__resetMemory()
    useSettingsStore.setState({ ai: defaultAiConfig(), hydrated: false })
  })

  it('hydrate repairs a corrupt persisted AI config so Settings cannot crash on it', async () => {
    await persist.set(STORE_NS.SETTINGS, 'ai', CORRUPT)
    await useSettingsStore.getState().hydrate()
    const { ai } = useSettingsStore.getState()
    expectWellFormed(ai)
    expect(() => isAiConfigReady(ai)).not.toThrow()
  })

  it('import repairs the same corrupt shape and never persists a non-string key', async () => {
    await persist.set(STORE_NS.SETTINGS, 'ai', { ...CORRUPT, provider: 'gemini' })
    await useSettingsStore.getState().importAll({ ai: CORRUPT })
    const { ai } = useSettingsStore.getState()
    expectWellFormed(ai)
    expect(() => isAiConfigReady(ai)).not.toThrow()
    expect(typeof (await persist.get<AiConfig>(STORE_NS.SETTINGS, 'ai'))?.apiKey).toBe('string')
  })

  it('mergeImportedAi ignores a non-string key on the stored copy when inheriting', () => {
    const stored = { ...defaultAiConfig(), apiKey: {} } as unknown as AiConfig
    const merged = mergeImportedAi({ ...defaultAiConfig() }, [stored])
    expect(merged.apiKey).toBe('')
  })

  it('mergeImportedAi keeps inheriting a good stored key for the same endpoint', () => {
    const stored = { ...defaultAiConfig(), apiKey: 'secret' }
    expect(mergeImportedAi({ ...defaultAiConfig(), apiKey: '' }, [stored]).apiKey).toBe('secret')
  })
})
