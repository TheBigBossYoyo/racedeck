import { beforeEach, describe, expect, it } from 'vitest'
import { STORE_NS } from '@shared/ipc-contract'
import { defaultAiConfig } from '@shared/ai'
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
})
