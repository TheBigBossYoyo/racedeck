import { describe, expect, it } from 'vitest'
import { DEFAULT_TOD_URL } from '@shared/constants'
import { normalizeTodPrefs } from '@renderer/store/settingsStore'

describe('TOD settings migration', () => {
  it('uses embedded-first defaults for new installations', () => {
    expect(normalizeTodPrefs()).toEqual({ autoFallback: true, url: DEFAULT_TOD_URL })
  })

  it('drops the legacy preferEmbedded override while preserving active settings', () => {
    const legacy = {
      preferEmbedded: false,
      autoFallback: false,
      url: 'https://www.tod.tv/'
    }
    expect(normalizeTodPrefs(legacy)).toEqual({
      autoFallback: false,
      url: 'https://www.tod.tv/'
    })
  })
})
