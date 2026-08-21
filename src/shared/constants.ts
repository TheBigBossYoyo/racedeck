import type { TyreCompound } from './models'

/**
 * Static reference data + defaults for RaceDeck.
 * Team colours are used as fallbacks when a provider doesn't supply team_colour.
 */

export const DEFAULT_TOD_URL = 'https://www.tod.tv/'

export const OPENF1_BASE_URL = 'https://api.openf1.org/v1'

/** Broadcast delay bounds for the sync slider (seconds). */
export const SYNC_MIN_OFFSET = -120
export const SYNC_MAX_OFFSET = 600
export const SYNC_FINE_STEP = 1
export const SYNC_COARSE_STEP = 5

/** Tyre compound → display colour (Pirelli-inspired). */
export const TYRE_COLORS: Record<TyreCompound, string> = {
  SOFT: '#ff3b3b',
  MEDIUM: '#ffd93d',
  HARD: '#f0f0f0',
  INTERMEDIATE: '#43d675',
  WET: '#3b8bff',
  UNKNOWN: '#8a8f98'
}

/**
 * Colour-blind-safe tyre palettes. The default Pirelli scheme confuses SOFT
 * (red) with INTERMEDIATE (green) under the common red-green deficiencies, so
 * these lean on the blue-yellow axis (and vice-versa for tritanopia). The
 * compound LETTER (`TYRE_LABELS`) is always shown alongside the colour, so
 * compounds stay distinguishable regardless of colour vision.
 */
export const TYRE_COLORS_BY_VISION: Record<string, Record<TyreCompound, string>> = {
  default: TYRE_COLORS,
  // Red-green deficiencies → distinguish on the blue-yellow axis.
  deuteranopia: {
    SOFT: '#e69f00',
    MEDIUM: '#f0e442',
    HARD: '#e8e8e8',
    INTERMEDIATE: '#0072b2',
    WET: '#56b4e9',
    UNKNOWN: '#8a8f98'
  },
  protanopia: {
    SOFT: '#e69f00',
    MEDIUM: '#f0e442',
    HARD: '#e8e8e8',
    INTERMEDIATE: '#0072b2',
    WET: '#56b4e9',
    UNKNOWN: '#8a8f98'
  },
  // Blue-yellow deficiency → distinguish on the red-green axis.
  tritanopia: {
    SOFT: '#e8002d',
    MEDIUM: '#26a269',
    HARD: '#f0f0f0',
    INTERMEDIATE: '#9141ac',
    WET: '#ff7eb6',
    UNKNOWN: '#8a8f98'
  }
}

/** Active tyre palette for a colour-vision mode (falls back to default). */
export function tyreColorsFor(vision: string | null | undefined): Record<TyreCompound, string> {
  return (vision && TYRE_COLORS_BY_VISION[vision]) || TYRE_COLORS
}

/** Short labels shown in dense tables. */
export const TYRE_LABELS: Record<TyreCompound, string> = {
  SOFT: 'S',
  MEDIUM: 'M',
  HARD: 'H',
  INTERMEDIATE: 'I',
  WET: 'W',
  UNKNOWN: '?'
}

export const TYRE_ORDER: TyreCompound[] = [
  'SOFT',
  'MEDIUM',
  'HARD',
  'INTERMEDIATE',
  'WET',
  'UNKNOWN'
]

/**
 * Fallback team colours (hex, no '#') keyed by normalized team name.
 * Providers usually supply team_colour; this is a safety net + demo data.
 */
export const TEAM_COLORS: Record<string, string> = {
  'red bull racing': '3671C6',
  'red bull': '3671C6',
  ferrari: 'E8002D',
  mercedes: '27F4D2',
  mclaren: 'FF8000',
  'aston martin': '229971',
  alpine: '0093CC',
  'alpine f1 team': '0093CC',
  williams: '64C4FF',
  'rb': '6692FF',
  'racing bulls': '6692FF',
  'visa cash app rb': '6692FF',
  'kick sauber': '52E252',
  sauber: '52E252',
  'stake f1 team kick sauber': '52E252',
  haas: 'B6BABD',
  'haas f1 team': 'B6BABD'
}

export function teamColorFor(teamName: string | null | undefined): string {
  if (!teamName) return '8A8F98'
  const key = teamName.trim().toLowerCase()
  return TEAM_COLORS[key] ?? '8A8F98'
}

/** Accent color presets for the ThemeEngine. */
export const ACCENT_PRESETS: Record<string, string> = {
  cyan: '34, 211, 238',
  violet: '139, 92, 246',
  amber: '245, 158, 11',
  emerald: '16, 185, 129',
  rose: '244, 63, 94',
  ferrariRed: '232, 0, 45'
}

export const APP_NAME = 'RaceDeck'
