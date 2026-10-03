import type { SectorTime } from '@shared/models'

/**
 * Broadcast-accurate colour for a sector cell. The raw `SectorTime.state` only
 * distinguishes fastest sectors, so a normal race lap (no personal/overall best)
 * collapses to `'none'` and the whole timing tower renders grey. Real F1 timing
 * shows a *completed* sector in yellow, a personal best in green, the session
 * best in purple, and grey only for a sector not yet run this lap — with an
 * `'active'` tint while the car is mid-sector (segments lit, time not posted).
 */
export type SectorDisplayState = 'session-best' | 'personal-best' | 'complete' | 'active' | 'none'

export function sectorDisplayState(sector: SectorTime): SectorDisplayState {
  if (sector.state === 'session-best') return 'session-best'
  if (sector.state === 'personal-best') return 'personal-best'
  // A posted time this lap that isn't a best → completed (yellow), the race norm.
  if (sector.seconds != null) return 'complete'
  // No time yet, but marshalling segments are lighting up → currently on it.
  if (
    sector.segments?.some((s) => s === 'green' || s === 'yellow' || s === 'purple' || s === 'pit')
  ) {
    return 'active'
  }
  return 'none'
}
