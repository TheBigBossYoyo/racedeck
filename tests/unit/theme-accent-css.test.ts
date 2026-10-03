import { afterEach, describe, expect, it } from 'vitest'
import { ACCENT_PRESETS } from '@shared/constants'
import { DEFAULT_THEME, ThemeEngine } from '@renderer/core/engines/ThemeEngine'
import { cssVar } from '@renderer/lib/echarts'

// Tailwind and globals.css consume the accent as `rgb(var(--accent) / <alpha>)`, which is only
// valid CSS when the variable is a SPACE-separated triple; a comma triple silently voids it.
const SPACE_TRIPLE = /^\d{1,3} \d{1,3} \d{1,3}$/

describe('ThemeEngine writes CSS-valid (space-separated) accent variables', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('style')
  })

  for (const mode of ['dark', 'light'] as const) {
    for (const accent of Object.keys(ACCENT_PRESETS)) {
      it(`${accent} in ${mode} mode`, () => {
        ThemeEngine.apply({ ...DEFAULT_THEME, mode, accent })
        const style = document.documentElement.style
        for (const name of ['--accent', '--accent-soft', '--speed']) {
          expect(style.getPropertyValue(name)).toMatch(SPACE_TRIPLE)
        }
      })
    }
  }

  it('darkens the light-mode accent but keeps the dark-mode accent unchanged', () => {
    ThemeEngine.apply({ ...DEFAULT_THEME, mode: 'dark', accent: 'cyan' })
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe('34 211 238')
    ThemeEngine.apply({ ...DEFAULT_THEME, mode: 'light', accent: 'cyan' })
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe('24 152 171')
  })

  it('falls back to the cyan preset for an unknown accent key', () => {
    ThemeEngine.apply({ ...DEFAULT_THEME, mode: 'dark', accent: 'nope' })
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe('34 211 238')
  })
})

describe('cssVar (JS consumer of the tokens)', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('style')
  })

  it('emits a comma rgb() the canvas colour parser understands, from a space-separated token', () => {
    document.documentElement.style.setProperty('--accent', '34 211 238')
    expect(cssVar('--accent')).toBe('rgb(34, 211, 238)')
  })

  it('accepts an already comma-separated value and falls back when the token is unset', () => {
    document.documentElement.style.setProperty('--accent', '1, 2, 3')
    expect(cssVar('--accent')).toBe('rgb(1, 2, 3)')
    expect(cssVar('--missing', '52 211 153')).toBe('rgb(52, 211, 153)')
  })
})
