import type { TimingEntry, TyreCompound } from '@shared/models'
import type { RaceSnapshot } from '@renderer/core/providers/types'

/**
 * EngineerNotesEngine — the proactive, strategic counterpart to RaceStoryEngine.
 *
 * Where Race Story narrates what JUST HAPPENED (overtakes, pits, flags), this
 * surfaces what a race engineer would be watching for NEXT: undercut threats,
 * opening pit windows, a rival closing, a neutralisation stop opportunity, rain.
 * Every note is derived DETERMINISTICALLY from the real snapshot (and its diff
 * against the previous frame) — nothing is invented, so it is honest, offline
 * and unit-testable, and works identically live or while scrubbing a replay.
 *
 * The high-priority notes (a safety car window, rain onset) are the ones the
 * optional voice read-out speaks aloud.
 */

export type NoteCategory = 'neutralisation' | 'weather' | 'undercut' | 'pit-window' | 'battle'
export type NotePriority = 'high' | 'normal'

export interface EngineerNote {
  id: string
  at: number
  lap: number | null
  drivers: number[]
  category: NoteCategory
  priority: NotePriority
  text: string
}

/** Within this interval (s) an undercut is a live threat. */
const UNDERCUT_GAP = 2.0
/** Tyre-age advantage (laps) that makes an undercut worth flagging. */
const UNDERCUT_FRESHER_BY = 8
/** A gap that shrinks by at least this per frame while <2s is a closing battle. */
const CLOSING_RATE = 0.25
const BATTLE_GAP = 2.0
/** Stint age (laps) beyond which a compound's pit window is considered open. */
const PIT_WINDOW_AGE: Record<TyreCompound, number> = {
  SOFT: 16,
  MEDIUM: 26,
  HARD: 38,
  INTERMEDIATE: 22,
  WET: 26,
  UNKNOWN: 30
}

function numericInterval(entry: TimingEntry): number | null {
  return typeof entry.intervalAhead === 'number' ? entry.intervalAhead : null
}

function racing(entry: TimingEntry): boolean {
  return !entry.inPit && !entry.retired && entry.status !== 'RETIRED' && entry.status !== 'DNF' && entry.status !== 'DSQ'
}

function byNumber(timing: TimingEntry[]): Map<number, TimingEntry> {
  return new Map(timing.map((entry) => [entry.driverNumber, entry]))
}

/** Derive the current strategic notes from a frame and its predecessor. */
export function deriveEngineerNotes(prev: RaceSnapshot, cur: RaceSnapshot): EngineerNote[] {
  const notes: EngineerNote[] = []
  const at = cur.clock
  const lap = cur.currentLap
  const codeOf = (n: number) => cur.drivers.find((d) => d.number === n)?.code ?? `#${n}`
  const push = (id: string, category: NoteCategory, priority: NotePriority, drivers: number[], text: string) =>
    notes.push({ id, at, lap, drivers, category, priority, text })

  // ── Neutralisation: a cheap-stop window just opened ──
  if (prev.trackStatus !== cur.trackStatus) {
    if (cur.trackStatus === 'SAFETY_CAR') {
      push(`neutralisation-sc-${lap ?? Math.round(at)}`, 'neutralisation', 'high', [], 'Safety Car — a pit stop is far cheaper now. Box this lap.')
    } else if (cur.trackStatus === 'VSC') {
      push(`neutralisation-vsc-${lap ?? Math.round(at)}`, 'neutralisation', 'high', [], 'Virtual Safety Car — reduced pit loss. Consider boxing now.')
    }
  }

  // ── Weather: rain onset / easing ──
  const wetNow = cur.weather?.rainfall === true
  const wetPrev = prev.weather?.rainfall === true
  if (wetNow && !wetPrev) {
    push(`weather-rain-on-${lap ?? Math.round(at)}`, 'weather', 'high', [], 'Rain reported — the intermediate crossover is approaching.')
  } else if (!wetNow && wetPrev) {
    push(`weather-rain-off-${lap ?? Math.round(at)}`, 'weather', 'high', [], 'Rain easing — a slick crossover may be near.')
  }

  const prevBy = byNumber(prev.timing)
  const ordered = [...cur.timing].filter((e) => e.position != null).sort((a, b) => (a.position as number) - (b.position as number))

  // ── Pit window: a stint running long ──
  for (const entry of ordered) {
    if (!racing(entry) || entry.compound == null || entry.stintAge == null) continue
    const threshold = PIT_WINDOW_AGE[entry.compound]
    if (entry.stintAge >= threshold) {
      // Bucket by 6-lap bands so it re-notes as the tyre ages, not every lap.
      const bucket = Math.floor(entry.stintAge / 6)
      push(
        `pit-window-${entry.driverNumber}-${bucket}`,
        'pit-window',
        'normal',
        [entry.driverNumber],
        `${codeOf(entry.driverNumber)}'s ${entry.compound.toLowerCase()}s are ${entry.stintAge} laps old — pit window open.`
      )
    }
  }

  // ── Undercut threat + closing battles (adjacent running cars) ──
  for (let i = 1; i < ordered.length; i++) {
    const behind = ordered[i]
    const ahead = ordered[i - 1]
    if (!racing(behind) || !racing(ahead)) continue
    const gap = numericInterval(behind)
    if (gap == null) continue

    // Undercut: within range AND on materially fresher rubber.
    if (
      gap <= UNDERCUT_GAP &&
      behind.stintAge != null &&
      ahead.stintAge != null &&
      ahead.stintAge - behind.stintAge >= UNDERCUT_FRESHER_BY
    ) {
      const fresher = ahead.stintAge - behind.stintAge
      push(
        `undercut-${behind.driverNumber}-${ahead.driverNumber}-${lap ?? Math.round(at)}`,
        'undercut',
        'normal',
        [behind.driverNumber, ahead.driverNumber],
        `${codeOf(behind.driverNumber)} in undercut range of ${codeOf(ahead.driverNumber)} (${gap.toFixed(1)}s, ${fresher} laps fresher).`
      )
      continue
    }

    // Closing battle: the gap shrank quickly and is now small.
    const prevBehind = prevBy.get(behind.driverNumber)
    const prevGap = prevBehind ? numericInterval(prevBehind) : null
    if (prevGap != null && gap <= BATTLE_GAP && prevGap - gap >= CLOSING_RATE) {
      push(
        `battle-${behind.driverNumber}-${ahead.driverNumber}-${lap ?? Math.round(at)}`,
        'battle',
        'normal',
        [behind.driverNumber, ahead.driverNumber],
        `${codeOf(behind.driverNumber)} closing on ${codeOf(ahead.driverNumber)} — ${gap.toFixed(1)}s and falling.`
      )
    }
  }

  return notes
}
