import type { RaceSnapshot } from '@renderer/core/providers/types'
import type { LapSample, SectorState } from '@shared/models'

export type QualifyingRunState = 'HOT LAP' | 'PREP LAP' | 'COOLDOWN' | 'OUT LAP' | 'IN PITS' | 'READY' | 'OUT'

export interface QualifyingRow {
  driverNumber: number
  position: number
  bestLap: number | null
  gapToFastest: number | null
  deltaToCutoff: number | null
  sectors: SectorState[]
  state: QualifyingRunState
  stateIsEstimate: boolean
  atRisk: boolean
  bubble: boolean
  fastest: boolean
}

export interface QualifyingBoard {
  stage: 1 | 2 | 3
  cutoffPosition: number | null
  cutoffTime: number | null
  fastestTime: number | null
  rows: QualifyingRow[]
}

export interface QualifyingFocusProjection {
  driverNumber: number
  lapNumber: number | null
  currentLapTime: number | null
  bestLap: number | null
  currentSectors: [number | null, number | null, number | null]
  bestSectors: [number | null, number | null, number | null]
  projectedSectors: [number | null, number | null, number | null]
  projectedLap: number | null
  projectedPosition: number | null
  confidence: 'low' | 'medium' | 'high'
  active: boolean
  isEstimate: true
}

export interface TrackEvolutionEstimate {
  /** Late representative lap minus early representative lap. Negative = faster later. */
  deltaSeconds: number
  pairedDrivers: number
}

/** Chronology-safe track evolution estimate paired within each driver. */
export function estimateTrackEvolution(laps: LapSample[]): TrackEvolutionEstimate | null {
  const timed = laps
    .map((lap) => ({ lap, time: lapCompletionTime(lap) }))
    .filter(
      (item): item is { lap: LapSample; time: number } =>
        item.time != null &&
        item.lap.lapTime != null &&
        item.lap.lapTime > 0 &&
        !item.lap.isPitInLap &&
        !item.lap.isPitOutLap
    )
    .sort((a, b) => a.time - b.time)
  if (timed.length < 6) return null

  const bestByDriver = new Map<number, number>()
  for (const { lap } of timed) {
    const lapTime = lap.lapTime!
    const current = bestByDriver.get(lap.driverNumber)
    if (current == null || lapTime < current) bestByDriver.set(lap.driverNumber, lapTime)
  }
  const representative = timed.filter(({ lap }) => lap.lapTime! <= bestByDriver.get(lap.driverNumber)! * 1.07)
  if (representative.length < 6) return null

  const firstTime = representative[0].time
  const lastTime = representative[representative.length - 1].time
  if (lastTime <= firstTime) return null
  const midpoint = firstTime + (lastTime - firstTime) / 2
  const windows = new Map<number, { early: number[]; late: number[] }>()
  for (const { lap, time } of representative) {
    const window = windows.get(lap.driverNumber) ?? { early: [], late: [] }
    ;(time < midpoint ? window.early : window.late).push(lap.lapTime!)
    windows.set(lap.driverNumber, window)
  }
  const deltas: number[] = []
  for (const window of windows.values()) {
    if (window.early.length === 0 || window.late.length === 0) continue
    deltas.push(Math.min(...window.late) - Math.min(...window.early))
  }
  if (deltas.length < 2) return null
  return { deltaSeconds: median(deltas), pairedDrivers: deltas.length }
}

function lapCompletionTime(lap: LapSample): number | null {
  if (lap.sessionTime != null && Number.isFinite(lap.sessionTime)) return lap.sessionTime
  if (!lap.dateStart) return null
  const timestamp = Date.parse(lap.dateStart)
  return Number.isFinite(timestamp) ? timestamp / 1000 : null
}

/** Pure qualifying classification/cutline projection for the current snapshot. */
export function buildQualifyingBoard(snapshot: RaceSnapshot): QualifyingBoard {
  const stage = inferStage(snapshot)
  const ordered = snapshot.timing.filter((entry) => entry.position != null)
  const cutoffPosition = qualifyingCutoff(stage, ordered.length)
  const fastestTime = ordered.reduce<number | null>(
    (best, entry) => entry.bestLap != null && (best == null || entry.bestLap < best) ? entry.bestLap : best,
    null
  )
  const cutoffTime = cutoffPosition == null
    ? null
    : ordered.find((entry) => entry.position === cutoffPosition)?.bestLap ?? null

  const rows = ordered.map<QualifyingRow>((entry) => {
    const position = entry.position ?? 99
    return {
      driverNumber: entry.driverNumber,
      position,
      bestLap: entry.bestLap,
      gapToFastest:
        entry.bestLap != null && fastestTime != null ? Math.max(0, entry.bestLap - fastestTime) : null,
      deltaToCutoff:
        entry.bestLap != null && cutoffTime != null ? entry.bestLap - cutoffTime : null,
      sectors: [entry.sector1.state, entry.sector2.state, entry.sector3.state],
      ...classifyQualifyingRunState(snapshot, entry),
      atRisk: cutoffPosition != null && position > cutoffPosition,
      bubble: cutoffPosition != null && Math.abs(position - cutoffPosition) <= 2,
      fastest: entry.isFastestLap || (entry.bestLap != null && entry.bestLap === fastestTime)
    }
  })

  return { stage, cutoffPosition, cutoffTime, fastestTime, rows }
}

export function qualifyingCutoff(stage: 1 | 2 | 3, gridSize: number): number | null {
  if (stage === 3) return null
  if (stage === 2) return Math.min(10, gridSize)
  const eliminated = gridSize >= 22 ? 6 : gridSize >= 16 ? 5 : Math.max(1, Math.floor(gridSize / 4))
  return Math.max(1, gridSize - eliminated)
}

/** Deterministic in-progress qualifying projection for the globally focused driver. */
export function buildQualifyingFocusProjection(
  snapshot: RaceSnapshot,
  driverNumber: number
): QualifyingFocusProjection | null {
  const entry = snapshot.timing.find((candidate) => candidate.driverNumber === driverNumber)
  if (!entry) return null

  const currentSectors: [number | null, number | null, number | null] = [
    entry.sector1.seconds,
    entry.sector2.seconds,
    entry.sector3.seconds
  ]
  const cleanLaps = snapshot.laps.filter(
    (lap) =>
      lap.driverNumber === driverNumber &&
      !lap.isPitInLap &&
      !lap.isPitOutLap &&
      lap.sector1 != null &&
      lap.sector2 != null &&
      lap.sector3 != null
  )
  const sessionCleanLaps = snapshot.laps.filter(
    (lap) =>
      !lap.isPitInLap &&
      !lap.isPitOutLap &&
      lap.sector1 != null &&
      lap.sector2 != null &&
      lap.sector3 != null
  )
  const bestSectors: [number | null, number | null, number | null] = [0, 1, 2].map((index) => {
    const values = cleanLaps
      .map((lap) => [lap.sector1, lap.sector2, lap.sector3][index])
      .filter((value): value is number => value != null && value > 0)
    return values.length > 0 ? Math.min(...values) : null
  }) as [number | null, number | null, number | null]
  const baselineSectors: [number | null, number | null, number | null] = [0, 1, 2].map((index) => {
    const driverValues = cleanLaps
      .slice(-6)
      .map((lap) => [lap.sector1, lap.sector2, lap.sector3][index])
      .filter((value): value is number => value != null && value > 0)
    if (driverValues.length > 0) return median(driverValues)
    const sessionValues = sessionCleanLaps
      .map((lap) => [lap.sector1, lap.sector2, lap.sector3][index])
      .filter((value): value is number => value != null && value > 0)
    return sessionValues.length > 0 ? median(sessionValues) : null
  }) as [number | null, number | null, number | null]

  const runState = classifyQualifyingRunState(snapshot, entry)
  const active = runState.state === 'HOT LAP'
  const ratios = currentSectors
    .map((value, index) => value != null && baselineSectors[index] != null
      ? value / baselineSectors[index]!
      : null)
    .filter((value): value is number => value != null && Number.isFinite(value))
  const paceRatio = ratios.length > 0 ? clamp(median(ratios), 0.97, 1.08) : 1
  const projectedSectors = currentSectors.map((value, index) =>
    value ?? (active && baselineSectors[index] != null ? baselineSectors[index]! * paceRatio : null)
  ) as [number | null, number | null, number | null]
  const projectedLap = active && projectedSectors.every((value) => value != null)
    ? projectedSectors.reduce<number>((total, value) => total + (value ?? 0), 0)
    : null
  const projectedBest = projectedLap == null
    ? null
    : entry.bestLap == null
      ? projectedLap
      : Math.min(entry.bestLap, projectedLap)
  const projectedPosition = projectedBest == null
    ? null
    : 1 + snapshot.timing.filter(
      (candidate) =>
        candidate.driverNumber !== driverNumber &&
        candidate.bestLap != null &&
        candidate.bestLap < projectedBest
    ).length
  const completedSectorCount = currentSectors.filter((value) => value != null).length
  const driverBaselineCount = baselineSectors.filter((value) => value != null).length
  const confidence = completedSectorCount >= 2 && driverBaselineCount === 3
    ? 'high'
    : completedSectorCount >= 1 && driverBaselineCount === 3
      ? 'medium'
      : 'low'

  return {
    driverNumber,
    lapNumber: entry.lapNumber,
    currentLapTime: currentSectors.some((value) => value != null)
      ? currentSectors.reduce<number>((total, value) => total + (value ?? 0), 0)
      : null,
    bestLap: entry.bestLap,
    currentSectors,
    bestSectors,
    projectedSectors,
    projectedLap,
    projectedPosition,
    confidence,
    active,
    isEstimate: true
  }
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

function inferStage(snapshot: RaceSnapshot): 1 | 2 | 3 {
  if (snapshot.qualifyingPart) return snapshot.qualifyingPart
  const match = /\bQ([123])\b/i.exec(snapshot.session.name)
  return match ? (Number(match[1]) as 1 | 2 | 3) : 1
}

export function classifyQualifyingRunState(
  snapshot: RaceSnapshot,
  entry: RaceSnapshot['timing'][number]
): { state: QualifyingRunState; stateIsEstimate: boolean } {
  if (entry.retired || entry.status === 'RETIRED' || entry.status === 'DNF' || entry.status === 'DSQ') {
    return { state: 'OUT', stateIsEstimate: false }
  }
  if (entry.inPit || entry.status === 'IN_PIT') return { state: 'IN PITS', stateIsEstimate: false }
  if (entry.status === 'OUT_LAP') return { state: 'OUT LAP', stateIsEstimate: false }

  const sectors = [entry.sector1, entry.sector2, entry.sector3]
  const hasPushSignal = sectors.some(
    (sector) =>
      sector.state !== 'none' ||
      sector.segments?.some((segment) => segment === 'green' || segment === 'purple') === true
  )
  if (hasPushSignal) return { state: 'HOT LAP', stateIsEstimate: false }
  if (entry.status !== 'RUNNING') return { state: 'READY', stateIsEstimate: false }

  const completedLaps = snapshot.laps
    .filter((lap) => lap.driverNumber === entry.driverNumber)
    .sort((a, b) => b.lapNumber - a.lapNumber)
  const latestLap = completedLaps[0]
  const lastLap = entry.lastLap ?? latestLap?.lapTime ?? null
  const bestLap = entry.bestLap
  const followsQuickLap =
    lastLap != null && bestLap != null && lastLap <= Math.max(bestLap * 1.07, bestLap + 3)

  if (followsQuickLap) return { state: 'COOLDOWN', stateIsEstimate: true }
  return { state: 'PREP LAP', stateIsEstimate: true }
}
