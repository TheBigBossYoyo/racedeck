import { beforeEach, describe, expect, it } from 'vitest'
import { STORE_NS } from '@shared/ipc-contract'
import {
  AI_PROVIDERS,
  defaultAiConfig,
  getAiProvider,
  mergeImportedAi,
  migrateAiConfig,
  resolveAiBaseUrl
} from '@shared/ai'
import { persist } from '@renderer/store/persist'
import { useSettingsStore } from '@renderer/store/settingsStore'

describe('AI key persistence', () => {
  beforeEach(() => {
    localStorage.clear()
    persist.__resetMemory()
    useSettingsStore.setState({ ai: defaultAiConfig(), hydrated: false })
  })

  it('serializes edits and restores the saved key during hydration', async () => {
    useSettingsStore.getState().setAi({ apiKey: 'secret-racedeck-key', enabled: true })
    await useSettingsStore.getState().saveAi()
    expect((await persist.get<{ apiKey: string }>(STORE_NS.SETTINGS, 'ai'))?.apiKey).toBe('secret-racedeck-key')

    useSettingsStore.setState({ ai: defaultAiConfig(), hydrated: false })
    await useSettingsStore.getState().hydrate()
    expect(useSettingsStore.getState().ai.apiKey).toBe('secret-racedeck-key')
  })

  it('redacts normal exports but supports explicit secret-inclusive exports', async () => {
    useSettingsStore.getState().setAi({ apiKey: 'secret-racedeck-key' })
    await useSettingsStore.getState().saveAi()
    const redacted = useSettingsStore.getState().exportAll() as { ai: { apiKey: string } }
    const complete = useSettingsStore.getState().exportAll({ includeSecrets: true }) as { ai: { apiKey: string } }
    expect(redacted.ai.apiKey).toBe('')
    expect(complete.ai.apiKey).toBe('secret-racedeck-key')
  })

  it('does not erase a persisted key when importing a redacted backup', async () => {
    const stored = { ...defaultAiConfig(), apiKey: 'secret-racedeck-key', enabled: true }
    await persist.set(STORE_NS.SETTINGS, 'ai', stored)
    useSettingsStore.setState({ ai: defaultAiConfig() })

    await useSettingsStore.getState().importAll({ ai: { ...stored, apiKey: '' } })

    expect(useSettingsStore.getState().ai.apiKey).toBe('secret-racedeck-key')
    expect((await persist.get<{ apiKey: string }>(STORE_NS.SETTINGS, 'ai'))?.apiKey).toBe('secret-racedeck-key')
  })

  describe('importing a backup that points at another endpoint', () => {
    beforeEach(async () => {
      const stored = { ...defaultAiConfig(), apiKey: 'secret-racedeck-key', enabled: true }
      await persist.set(STORE_NS.SETTINGS, 'ai', stored)
      useSettingsStore.setState({ ai: stored })
    })

    it('does not hand the stored key to a custom endpoint the backup introduces', async () => {
      await useSettingsStore.getState().importAll({
        ai: {
          provider: 'custom',
          baseUrl: 'https://evil.example/v1',
          model: 'x',
          apiKey: '',
          enabled: true
        }
      })

      const ai = useSettingsStore.getState().ai
      expect(ai.baseUrl).toBe('https://evil.example/v1')
      expect(ai.apiKey).toBe('')
    })

    it('pins a built-in provider to its own endpoint and keeps no key from another one', async () => {
      await useSettingsStore.getState().importAll({
        ai: {
          provider: 'groq',
          baseUrl: 'https://evil.example/v1',
          model: 'openai/gpt-oss-120b',
          apiKey: '',
          enabled: true
        }
      })

      const ai = useSettingsStore.getState().ai
      expect(ai.baseUrl).toBe(AI_PROVIDERS.groq.baseUrl)
      expect(ai.apiKey).toBe('')
    })

    it('still keeps the stored key when the backup targets the same endpoint', async () => {
      await useSettingsStore.getState().importAll({
        ai: { ...defaultAiConfig(), model: 'gemini-3.6-flash', apiKey: '' }
      })

      expect(useSettingsStore.getState().ai.apiKey).toBe('secret-racedeck-key')
    })

    it('survives a backup naming a provider that does not exist', async () => {
      await expect(
        useSettingsStore.getState().importAll({ ai: { provider: 'bogus', apiKey: '' } })
      ).resolves.not.toThrow()
    })
  })
})

describe('migrateAiConfig', () => {
  it('rewrites a Groq model decommissioned on 2026-08-16', () => {
    // Changing the provider's defaultModel does nothing for a user who already
    // has one stored — the stored value wins at hydration, so without this the
    // app keeps calling an endpoint the provider stopped serving.
    const migrated = migrateAiConfig({
      provider: 'groq',
      apiKey: 'k',
      model: 'llama-3.3-70b-versatile',
      baseUrl: 'https://api.groq.com/openai/v1',
      enabled: true
    })
    expect(migrated.model).toBe('openai/gpt-oss-120b')
    expect(migrated.apiKey).toBe('k')
  })

  it('rewrites Gemini models shut down in 2026', () => {
    const base = {
      provider: 'gemini' as const,
      apiKey: '',
      baseUrl: '',
      enabled: false
    }
    expect(migrateAiConfig({ ...base, model: 'gemini-2.0-flash' }).model).toBe('gemini-3.7-flash')
    expect(migrateAiConfig({ ...base, model: 'gemini-1.5-flash' }).model).toBe('gemini-3.7-flash')
  })

  it('leaves a current model alone', () => {
    const config = {
      provider: 'groq' as const,
      apiKey: '',
      model: 'openai/gpt-oss-120b',
      baseUrl: '',
      enabled: true
    }
    expect(migrateAiConfig(config)).toBe(config)
  })

  it('never rewrites a custom endpoint, where the user defines what is valid', () => {
    const config = {
      provider: 'custom' as const,
      apiKey: '',
      model: 'llama-3.3-70b-versatile',
      baseUrl: 'http://localhost:11434/v1',
      enabled: true
    }
    expect(migrateAiConfig(config).model).toBe('llama-3.3-70b-versatile')
  })

  it('every provider default is a model that provider still lists', () => {
    for (const meta of Object.values(AI_PROVIDERS)) {
      if (meta.models.length === 0) continue // custom endpoints list nothing
      expect(meta.models).toContain(meta.defaultModel)
      expect(migrateAiConfig({
        provider: meta.id, apiKey: '', model: meta.defaultModel, baseUrl: meta.baseUrl, enabled: true
      }).model).toBe(meta.defaultModel)
    }
  })
})

describe('provider lookups ignore inherited object properties', () => {
  // AI_PROVIDERS is a plain object, so AI_PROVIDERS['constructor'] is truthy.
  it.each(['constructor', 'toString', '__proto__', 'hasOwnProperty'])(
    'mergeImportedAi falls back to the default provider for %s',
    (provider) => {
      const merged = mergeImportedAi({ provider: provider as never, apiKey: '' }, [])
      expect(merged.provider).toBe(defaultAiConfig().provider)
    }
  )

  it('resolveAiBaseUrl returns no endpoint for an unknown provider id', () => {
    const config = { ...defaultAiConfig(), provider: 'constructor' as never }
    expect(resolveAiBaseUrl(config)).toBe('')
  })

  it('getAiProvider only returns real providers', () => {
    expect(getAiProvider('groq')?.id).toBe('groq')
    expect(getAiProvider('constructor')).toBeUndefined()
    expect(getAiProvider(42)).toBeUndefined()
  })
})
