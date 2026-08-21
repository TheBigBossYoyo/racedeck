import type { TimingEntry, TrackStatus } from '@shared/models'
import type { RaceSnapshot } from '@renderer/core/providers/types'

/**
 * RaceStoryEngine — turns the change between two consecutive snapshots into a
 * running, human-readable narrative of what just happened: overtakes, pit stops,
 * tyre changes, fastest laps, lead changes, retirements and flag/Safety-Car
 * transitions.
 *
 * It is a PURE diff (`diffSnapshots(prev, cur)`) so it works identically whether
 * the race is playing live or being scrubbed in replay — the store simply feeds
 * it consecutive frames. Nothing is invented: every event corresponds to a real
 * change in the timing/track data.
 */

export type StoryKind =
  | 'overtake'
  | 'pit'
  | 'tyres'
  | 'fastest-lap'
  | 'lead-change'
  | 'retirement'
  | 'flag'

export type StorySeverity = 'info' | 'notice' | 'good' | 'warn'

export interface StoryEvent {
  id: string
  kind: StoryKind
  /** Data-clock time (s) of the event. */
  at: number
  lap: number | null
  drivers: number[]
  text: string
  severity: StorySeverity
}

function racing(t: TimingEntry): boolean {
  return !t.inPit && !t.retired && t.status !== 'RETIRED' && t.status !== 'DNF' && t.status !== 'DSQ'
}

function isOut(t: TimingEntry): boolean {
  return t.retired || t.status === 'RETIRED' || t.status === 'DNF' || t.status === 'DSQ'
}

function byNumber(timing: TimingEntry[]): Map<number, TimingEntry> {
  return new Map(timing.map((t) => [t.driverNumber, t]))
}

function trackStatusLabel(s: TrackStatus): { text: string; severity: StorySeverity } | null {
  switch (s) {
    case 'SAFETY_CAR':
      return { text: 'Safety Car deployed', severity: 'warn' }
    case 'VSC':
      return { text: 'Virtual Safety Car', severity: 'warn' }
    case 'YELLOW':
      return { text: 'Yellow flag', severity: 'warn' }
    case 'RED':
      return { text: 'RED FLAG — session stopped', severity: 'warn' }
    case 'CLEAR':
      return { text: 'Track clear — green flag', severity: 'good' }
    default:
      return null
  }
}

/** Diff two consecutive snapshots into narrative events (chronological). */
export function diffSnapshots(prev: RaceSnapshot, cur: RaceSnapshot): StoryEvent[] {
  const events: StoryEvent[] = []
  const at = cur.clock
  const lap = cur.currentLap
  const codeOf = (n: number) => cur.drivers.find((d) => d.number === n)?.code ?? `#${n}`
  const stamp = Math.round(cur.clock)
  const push = (
    kind: StoryKind,
    drivers: number[],
    text: string,
    severity: StorySeverity
  ) => events.push({ id: `${kind}-${drivers.join('-')}-${stamp}`, kind, at, lap, drivers, text, severity })

  const curBy = byNumber(cur.timing)

  // ── Track status / flags ──
  if (prev.trackStatus !== cur.trackStatus) {
    const label = trackStatusLabel(cur.trackStatus)
    if (label) push('flag', [], label.text, label.severity)
  }

  // ── Lead change ──
  const prevLead = prev.timing.find((t) => t.position === 1)
  const curLead = cur.timing.find((t) => t.position === 1)
  if (prevLead && curLead && prevLead.driverNumber !== curLead.driverNumber) {
    push('lead-change', [curLead.driverNumber, prevLead.driverNumber], `${codeOf(curLead.driverNumber)} takes the lead from ${codeOf(prevLead.driverNumber)}`, 'good')
  }

  // ── Fastest lap (holder changed) ──
  const prevFL = prev.timing.find((t) => t.isFastestLap)?.driverNumber ?? null
  const curFL = cur.timing.find((t) => t.isFastestLap)?.driverNumber ?? null
  if (curFL != null && curFL !== prevFL) {
    push('fastest-lap', [curFL], `${codeOf(curFL)} sets the fastest lap`, 'good')
  }

  const orderedPrev = [...prev.timing].filter((t) => t.position != null).sort((a, b) => (a.position as number) - (b.position as number))

  for (const cprev of orderedPrev) {
    const n = cprev.driverNumber
    const ccur = curBy.get(n)
    if (!ccur) continue

    // ── Retirement ──
    if (!isOut(cprev) && isOut(ccur)) {
      push('retirement', [n], `${codeOf(n)} retires from P${cprev.position ?? '—'}`, 'warn')
      continue
    }

    // ── Pit entry ──
    if (!cprev.inPit && ccur.inPit) {
      push('pit', [n], `${codeOf(n)} pits from P${cprev.position ?? '—'}`, 'info')
    }

    // ── Tyre change ──
    if (cprev.compound && ccur.compound && cprev.compound !== ccur.compound) {
      push('tyres', [n], `${codeOf(n)} fits ${ccur.compound}`, 'info')
    }
  }

  // ── On-track overtakes (clean adjacent passes only) ──
  for (let i = 1; i < orderedPrev.length; i++) {
    const behind = orderedPrev[i] // was directly behind
    const ahead = orderedPrev[i - 1] // was directly ahead
    const bCur = curBy.get(behind.driverNumber)
    const aCur = curBy.get(ahead.driverNumber)
    if (!bCur || !aCur || bCur.position == null || aCur.position == null) continue
    // The trailing car is now ahead of the car it was chasing…
    if ((bCur.position as number) < (aCur.position as number)) {
      // …and it was a genuine on-track pass (no pit stops / retirements involved).
      const clean =
        racing(behind) && racing(ahead) && racing(bCur) && racing(aCur) && !isOut(aCur) && !isOut(bCur)
      if (clean) {
        push('overtake', [behind.driverNumber, ahead.driverNumber], `${codeOf(behind.driverNumber)} passes ${codeOf(ahead.driverNumber)} for P${bCur.position}`, 'good')
      }
    }
  }

  return events
}
