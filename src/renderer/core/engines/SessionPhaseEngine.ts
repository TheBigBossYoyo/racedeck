import type { SessionType, TrackStatus } from '@shared/models'

/**
 * SessionPhaseEngine — turns a session's raw track-status + lap-count series into
 * a segmented timeline of race PHASES, so the scrubber can show *where in the race
 * you are*. A live/replay feed's total length includes long non-racing stretches
 * (car prep, grid formation, the formation lap, post-race cool-down); this marks
 * those apart from green-flag racing and neutralisations (SC/VSC/yellow/red).
 *
 * Pure + unit-tested (tests/unit/phases.test.ts). Providers extract the two small
 * series cheaply; the UI renders `segments` as a colour strip and uses `phaseAt`
 * for the current-phase label.
 */

export type PhaseKind = 'pre' | 'green' | 'q1' | 'q2' | 'q3' | 'break' | 'yellow' | 'vsc' | 'sc' | 'red' | 'post'

export interface RacePhaseSegment {
  kind: PhaseKind
  tStart: number
  tEnd: number
  lapStart: number | null
  lapEnd: number | null
}

export interface SessionTimeline {
  segments: RacePhaseSegment[]
  /** Feed time (s) racing goes green (lights out for a race). */
  greenStart: number | null
  /** Feed time (s) of the chequered flag / race end. */
  chequered: number | null
  totalLaps: number | null
  type: SessionType
  duration: number
}

export interface PhaseInput {
  duration: number
  type: SessionType
  trackStatus: { t: number; status: TrackStatus }[]
  lapCount: { t: number; current: number | null; total: number | null }[]
  /** Qualifying segment transitions reconstructed from TimingData.SessionPart. */
  qualifyingParts?: { t: number; part: 1 | 2 | 3 }[]
  /** Per-part chequered times, used to separate Q1/Q2/Q3 from their breaks. */
  qualifyingPhaseEnds?: { t: number; part: 1 | 2 | 3 }[]
  /** Best-effort chequered-flag time from race control (most accurate end). */
  chequeredHint?: number | null
}

export interface CurrentPhase {
  kind: PhaseKind
  label: string
  lap: number | null
  totalLaps: number | null
}

export interface QualifyingPhaseClock {
  kind: 'q1' | 'q2' | 'q3' | 'break'
  remaining: number
  isPhase: boolean
}

const TS_KIND: Record<TrackStatus, PhaseKind> = {
  CLEAR: 'green',
  YELLOW: 'yellow',
  VSC: 'vsc',
  SAFETY_CAR: 'sc',
  RED: 'red',
  UNKNOWN: 'green'
}

function clampN(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

function isRaceType(type: SessionType): boolean {
  return type === 'race' || type === 'sprint'
}

function isQualifyingType(type: SessionType): boolean {
  return type === 'qualifying' || type === 'sprint-qualifying'
}

function qualifyingKind(part: 1 | 2 | 3): PhaseKind {
  return part === 1 ? 'q1' : part === 2 ? 'q2' : 'q3'
}

/**
 * F1 archives seed CurrentLap=1 near feed start, often almost an hour before
 * lights out. Infer the real start by subtracting representative early lap
 * duration from the first transition to lap 2.
 */
export function inferRaceGreenStart(lapCount: PhaseInput['lapCount']): number | null {
  const laps = lapCount
    .filter((entry) => Number.isFinite(entry.t) && entry.current != null)
    .slice()
    .sort((a, b) => a.t - b.t)
  const lapTwoIndex = laps.findIndex((entry) => (entry.current ?? 0) >= 2)
  if (lapTwoIndex >= 0) {
    const intervals: number[] = []
    for (let index = lapTwoIndex + 1; index < Math.min(laps.length, lapTwoIndex + 8); index += 1) {
      const previous = laps[index - 1]
      const current = laps[index]
      if ((current.current ?? 0) !== (previous.current ?? 0) + 1) continue
      const interval = current.t - previous.t
      if (interval >= 20 && interval <= 600) intervals.push(interval)
    }
    if (intervals.length > 0) {
      intervals.sort((a, b) => a - b)
      const middle = Math.floor(intervals.length / 2)
      const lapDuration =
        intervals.length % 2 === 1
          ? intervals[middle]
          : (intervals[middle - 1] + intervals[middle]) / 2
      return Math.max(0, laps[lapTwoIndex].t - lapDuration)
    }
  }
  return laps.find((entry) => (entry.current ?? 0) >= 1)?.t ?? null
}

/** Build the phase timeline from the raw series. Robust to missing data. */
export function buildTimeline(input: PhaseInput): SessionTimeline {
  const dur = Math.max(0, input.duration)
  const type = input.type
  const ts = input.trackStatus
    .filter((x) => Number.isFinite(x.t))
    .slice()
    .sort((a, b) => a.t - b.t)
  const lc = input.lapCount
    .filter((x) => Number.isFinite(x.t))
    .slice()
    .sort((a, b) => a.t - b.t)
  const qp = (input.qualifyingParts ?? [])
    .filter((x) => Number.isFinite(x.t) && (x.part === 1 || x.part === 2 || x.part === 3))
    .slice()
    .sort((a, b) => a.t - b.t)
  const qe = (input.qualifyingPhaseEnds ?? [])
    .filter((x) => Number.isFinite(x.t) && (x.part === 1 || x.part === 2 || x.part === 3))
    .slice()
    .sort((a, b) => a.t - b.t)

  let totalLaps: number | null = null
  for (const x of lc) if (x.total != null) totalLaps = x.total

  const isRace = isRaceType(type)

  // Green start: for a race, the first moment a lap is under way (lights out);
  // otherwise the first clear/green track status (session running).
  let greenStart: number | null = null
  if (isRace) {
    greenStart = inferRaceGreenStart(lc)
  }
  if (greenStart == null && isQualifyingType(type) && qp.length > 0) {
    greenStart = qp[0].t
  }
  if (greenStart == null) {
    const firstClear = ts.find((x) => x.status === 'CLEAR')
    greenStart = firstClear ? firstClear.t : 0
  }
  greenStart = clampN(greenStart, 0, dur || greenStart)

  // Chequered: race-control hint wins; else when the leader reaches the last lap.
  let chequered: number | null = input.chequeredHint ?? null
  if (chequered == null && isRace && totalLaps) {
    const fin = lc.find((x) => (x.current ?? 0) >= totalLaps!)
    if (fin) chequered = fin.t
  }
  if (chequered != null) chequered = clampN(chequered, 0, dur || chequered)
  const racingEnd = chequered ?? dur

  const lapAt = (t: number): number | null => {
    let v: number | null = null
    for (const x of lc) {
      if (x.t > t) break
      if (x.current != null) v = x.current
    }
    return v
  }

  const segments: RacePhaseSegment[] = []

  // Pre-race (prep, grid, formation) — everything before green.
  if (greenStart > 0.5) {
    segments.push({ kind: 'pre', tStart: 0, tEnd: greenStart, lapStart: null, lapEnd: null })
  }

  // Active window, subdivided by track status and (for qualifying) Q1/Q2/Q3.
  let curStatus: TrackStatus = 'CLEAR'
  if (!isRace) {
    for (const x of ts) {
      if (x.t <= greenStart) curStatus = x.status
      else break
    }
  }
  let curPart: 1 | 2 | 3 | null = null
  let inQualifyingBreak = false
  for (const x of qp) {
    if (x.t <= greenStart) curPart = x.part
    else break
  }
  curPart ??= qp[0]?.part ?? null
  const changes = [
    ...ts
      .filter((x) => x.t > greenStart && x.t < racingEnd)
      .map((x) => ({ t: x.t, status: x.status, part: null as 1 | 2 | 3 | null })),
    ...qp
      .filter((x) => x.t > greenStart && x.t < racingEnd)
      .map((x) => ({ t: x.t, status: null as TrackStatus | null, part: x.part, endPart: null as 1 | 2 | 3 | null })),
    ...qe
      .filter((x) => x.t > greenStart && x.t < racingEnd)
      .map((x) => ({ t: x.t, status: null as TrackStatus | null, part: null as 1 | 2 | 3 | null, endPart: x.part }))
  ].map((change) => ({ ...change, endPart: 'endPart' in change ? change.endPart : null }))
    .sort((a, b) => a.t - b.t || (a.endPart != null ? -1 : b.endPart != null ? 1 : 0))
  let segStart = greenStart
  const activeKind = (): PhaseKind =>
    inQualifyingBreak
      ? 'break'
      : curStatus !== 'CLEAR' && curStatus !== 'UNKNOWN'
      ? TS_KIND[curStatus] ?? 'green'
      : isQualifyingType(type) && curPart != null
        ? qualifyingKind(curPart)
        : 'green'
  let kind = activeKind()
  for (const ch of changes) {
    if (ch.t > segStart) {
      segments.push({ kind, tStart: segStart, tEnd: ch.t, lapStart: lapAt(segStart), lapEnd: lapAt(ch.t) })
      segStart = ch.t
    }
    if (ch.status != null) curStatus = ch.status
    if (ch.endPart != null && ch.endPart === curPart) inQualifyingBreak = true
    if (ch.part != null) {
      curPart = ch.part
      inQualifyingBreak = false
    }
    kind = activeKind()
  }
  if (racingEnd > segStart) {
    segments.push({ kind, tStart: segStart, tEnd: racingEnd, lapStart: lapAt(segStart), lapEnd: lapAt(racingEnd) })
  }

  // Post-race (cool-down / in-laps) — everything after the chequered flag.
  if (chequered != null && chequered < dur - 0.5) {
    segments.push({ kind: 'post', tStart: chequered, tEnd: dur, lapStart: null, lapEnd: null })
  }

  return { segments, greenStart, chequered, totalLaps, type, duration: dur }
}

/** The phase active at feed time `t` (nearest segment), with a display label. */
export function phaseAt(timeline: SessionTimeline, t: number): CurrentPhase {
  const seg =
    timeline.segments.find((s) => t >= s.tStart && t < s.tEnd) ??
    timeline.segments[timeline.segments.length - 1] ??
    null
  if (!seg) {
    return { kind: 'green', label: isRaceType(timeline.type) ? 'Racing' : 'Running', lap: null, totalLaps: timeline.totalLaps }
  }
  const lap = seg.lapEnd ?? seg.lapStart
  return {
    kind: seg.kind,
    label: phaseLabel(seg.kind, timeline, lap),
    lap,
    totalLaps: timeline.totalLaps
  }
}

/** Remaining time in the active qualifying phase or intermission. */
export function qualifyingPhaseClockAt(timeline: SessionTimeline, t: number): QualifyingPhaseClock | null {
  const segment = timeline.segments.find((candidate) => t >= candidate.tStart && t < candidate.tEnd)
  if (!segment || !['q1', 'q2', 'q3', 'break'].includes(segment.kind)) return null
  return {
    kind: segment.kind as QualifyingPhaseClock['kind'],
    remaining: Math.max(0, segment.tEnd - t),
    isPhase: segment.kind !== 'break'
  }
}

/** Human label for a phase kind, given the timeline + a lap number if known. */
export function phaseLabel(kind: PhaseKind, timeline: SessionTimeline, lap: number | null): string {
  const race = isRaceType(timeline.type)
  const lapStr =
    lap != null && timeline.totalLaps ? `Lap ${lap}/${timeline.totalLaps}` : lap != null ? `Lap ${lap}` : null
  switch (kind) {
    case 'pre':
      return race ? 'Pre‑race · grid & formation' : 'Pre‑session'
    case 'green':
      return race ? lapStr ?? 'Racing' : 'Running'
    case 'q1':
      return 'Q1 · first elimination'
    case 'q2':
      return 'Q2 · top 10 fight'
    case 'q3':
      return 'Q3 · pole shootout'
    case 'break':
      return 'Qualifying intermission'
    case 'yellow':
      return lapStr ? `Yellow flag · ${lapStr}` : 'Yellow flag'
    case 'vsc':
      return lapStr ? `Virtual Safety Car · ${lapStr}` : 'Virtual Safety Car'
    case 'sc':
      return lapStr ? `Safety Car · ${lapStr}` : 'Safety Car'
    case 'red':
      return 'Red flag · session stopped'
    case 'post':
      return race ? 'Race finished' : 'Session ended'
    default:
      return 'Racing'
  }
}

/** Display metadata (colour token + short name) for a phase kind. */
export function phaseMeta(kind: PhaseKind): { label: string; color: string } {
  switch (kind) {
    case 'pre':
      return { label: 'Pre‑race', color: 'var(--phase-pre)' }
    case 'green':
      return { label: 'Racing', color: 'var(--phase-green)' }
    case 'q1':
      return { label: 'Q1', color: 'var(--phase-q1)' }
    case 'q2':
      return { label: 'Q2', color: 'var(--phase-q2)' }
    case 'q3':
      return { label: 'Q3', color: 'var(--phase-q3)' }
    case 'break':
      return { label: 'Intermission', color: 'var(--phase-break)' }
    case 'yellow':
      return { label: 'Yellow', color: 'var(--phase-yellow)' }
    case 'vsc':
      return { label: 'VSC', color: 'var(--phase-vsc)' }
    case 'sc':
      return { label: 'Safety Car', color: 'var(--phase-sc)' }
    case 'red':
      return { label: 'Red flag', color: 'var(--phase-red)' }
    case 'post':
      return { label: 'Post‑race', color: 'var(--phase-post)' }
    default:
      return { label: 'Racing', color: 'var(--phase-green)' }
  }
}
