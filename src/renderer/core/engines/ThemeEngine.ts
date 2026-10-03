import { ACCENT_PRESETS } from '@shared/constants'

/**
 * ThemeEngine — applies theme tokens (accent color, density, team-color mode)
 * to the document root as CSS variables. The base palette lives in globals.css;
 * this only overrides the dynamic accent + density knobs.
 */

export type AccentKey = keyof typeof ACCENT_PRESETS
export type Density = 'comfortable' | 'compact'
export type ThemeMode = 'dark' | 'light' | 'system'
/** Colour-blind-safe modes; remap tyre-compound (and similar) palettes. */
export type ColorVision = 'default' | 'deuteranopia' | 'protanopia' | 'tritanopia'

export interface ThemeConfig {
  /** Colour scheme: explicit dark/light, or follow the OS. */
  mode: ThemeMode
  accent: AccentKey
  density: Density
  /** Use each driver's team color to tint their rows/highlights. */
  teamColorMode: boolean
  /** Reduce motion / disable heavy animations (perf / accessibility). */
  reducedMotion: boolean
  /** Base font scale multiplier (accessibility). */
  fontScale: number
  /** Colour-vision accommodation for compound/status palettes. */
  colorVision: ColorVision
}

export const DEFAULT_THEME: ThemeConfig = {
  mode: 'dark',
  accent: 'cyan',
  density: 'comfortable',
  teamColorMode: true,
  reducedMotion: false,
  fontScale: 1,
  colorVision: 'default'
}

function prefersLight(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: light)').matches
  )
}

export function resolveTheme(mode: ThemeMode): 'dark' | 'light' {
  if (mode === 'system') return prefersLight() ? 'light' : 'dark'
  return mode
}

// A single OS-preference listener kept in sync with the active mode.
let mql: MediaQueryList | null = null
let mqlHandler: (() => void) | null = null

/**
 * ACCENT_PRESETS keep the "r, g, b" form (JS consumers build `rgb(${...})` from it), but the CSS
 * variables feed `rgb(var(--accent) / <alpha>)`, which is only valid with SPACE separators.
 */
function toCssTriple(rgb: string): string {
  return rgb.trim().split(/[\s,]+/).join(' ')
}

/** Darken an accent triple toward a richer shade for contrast on light bg; returns a CSS triple. */
function darkenAccent(rgb: string, factor: number): string {
  const parts = rgb.trim().split(/[\s,]+/).map((n) => parseInt(n, 10))
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return toCssTriple(rgb)
  return parts.map((c) => Math.max(0, Math.round(c * factor))).join(' ')
}

export const ThemeEngine = {
  apply(config: ThemeConfig): void {
    if (typeof document === 'undefined') return
    const root = document.documentElement
    const resolved = resolveTheme(config.mode)

    const baseAccent = ACCENT_PRESETS[config.accent] ?? ACCENT_PRESETS.cyan
    // The vivid dark-theme accent reads as neon on white — deepen it for light.
    const accent = resolved === 'light' ? darkenAccent(baseAccent, 0.72) : toCssTriple(baseAccent)
    root.style.setProperty('--accent', accent)
    root.style.setProperty('--accent-soft', accent)
    root.style.setProperty('--speed', accent)
    root.style.setProperty('--density-gap', config.density === 'compact' ? '4px' : '8px')
    root.style.setProperty('--font-scale', String(config.fontScale))
    root.dataset.density = config.density
    root.dataset.reducedMotion = String(config.reducedMotion)
    root.dataset.teamColors = String(config.teamColorMode)
    root.dataset.colorVision = config.colorVision ?? 'default'
    root.style.fontSize = `${16 * config.fontScale}px`

    root.dataset.theme = resolved
    root.style.colorScheme = resolved

    // Live-follow the OS only while in "system" mode.
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      if (mql && mqlHandler) mql.removeEventListener('change', mqlHandler)
      if (config.mode === 'system') {
        mql = window.matchMedia('(prefers-color-scheme: light)')
        // Re-apply so the accent (and every token) tracks the OS switch too.
        mqlHandler = () => ThemeEngine.apply(config)
        mql.addEventListener('change', mqlHandler)
      } else {
        mql = null
        mqlHandler = null
      }
    }
  }
} as const
