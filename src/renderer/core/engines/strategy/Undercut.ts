/** Undercut model constants and the undercut arithmetic built on them. */

export const FRESH_TYRE_GAIN = 0.85 // s/lap advantage of fresh rubber over worn (early stint)
export const OUTLAP_ADVANTAGE_LAPS = 1.6 // effective laps of fresh-tyre edge an undercut banks
export const OVERTAKE_RANGE = 1.0 // within 1.0s = Overtake Mode range (2026 overtaking boost)

/**
 * Net seconds of an undercut: the attacker pits now, the car ahead responds one
 * lap later. Both pay the pit loss so it cancels; the swing is the fresh-tyre
 * pace banked over the overlap minus the gap that must be erased.
 * Positive ⇒ the attacker is projected to emerge ahead.
 */
export function undercutDelta(intervalAheadSec: number, freshGainPerLap = FRESH_TYRE_GAIN): number {
  return freshGainPerLap * OUTLAP_ADVANTAGE_LAPS - intervalAheadSec
}
