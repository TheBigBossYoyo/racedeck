import type { SessionType } from '@shared/models'
import type { LayoutId } from '@renderer/core/engines/LayoutManager'
import type { AlertConfig } from '@renderer/core/engines/AlertEngine'

/**
 * Personalized race-watch profiles (APP_IMPROVEMENT_ROADMAP.md P3 item 33):
 * favorite drivers, preferred layout, and alert overrides saved per session
 * type (practice/qualifying/race/…), auto-applied on load.
 *
 * The roadmap is explicit that this must never hide critical race-control
 * states. `CRITICAL_ALERT_KEYS` is the one place that boundary is drawn —
 * `sanitizeAlertOverrides` strips those keys unconditionally, and both the
 * store and the settings UI go through it, so there is no second path that
 * could bypass it.
 */

export const CRITICAL_ALERT_KEYS = ['redFlag', 'safetyCar', 'penalty', 'qualiElimination'] as const

type CriticalAlertKey = (typeof CRITICAL_ALERT_KEYS)[number]

export type ProfileAlertOverrides = Partial<Omit<AlertConfig, CriticalAlertKey | 'favorites'>>

export interface RaceWatchProfile {
  readonly sessionType: SessionType
  readonly favoriteDrivers: number[]
  readonly layoutId: LayoutId | null
  readonly savedLayoutId: string | null
  readonly alertOverrides: ProfileAlertOverrides
}

/** Strip critical-alert and favorites keys — the one enforcement point. */
export function sanitizeAlertOverrides(patch: Partial<AlertConfig>): ProfileAlertOverrides {
  const out: Partial<AlertConfig> = { ...patch }
  for (const key of CRITICAL_ALERT_KEYS) delete out[key]
  delete out.favorites
  return out as ProfileAlertOverrides
}

export function createRaceWatchProfile(
  sessionType: SessionType,
  favoriteDrivers: number[],
  layoutId: LayoutId | null,
  savedLayoutId: string | null,
  alertOverrides: Partial<AlertConfig>
): RaceWatchProfile {
  return {
    sessionType,
    favoriteDrivers: [...favoriteDrivers],
    layoutId,
    savedLayoutId,
    alertOverrides: sanitizeAlertOverrides(alertOverrides)
  }
}
