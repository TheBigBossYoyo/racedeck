import type { LapSample, TyreCompound } from '@shared/models'
import type { RaceSnapshot } from '@renderer/core/providers/types'

export type PracticeProgram = 'INSTALLATION' | 'QUALIFYING RUN' | 'LONG RUN' | 'MIXED'

export interface PracticeDriverRun {
  driverNumber: number
  code: string
  teamName: string | null
  lapCount: number
  bestLap: number | null
  longRunPace: number | null
  consistency: number | null
  currentCompound: TyreCompound | null
  program: PracticeProgram
}

export interface PracticeAnalysis {
  available: boolean
  reason: string | null
  runs: PracticeDriverRun[]
  mostProductive: PracticeDriverRun | null
  bestLongRun: PracticeDriverRun | null
  isEstimate: true
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function standardDeviation(values: number[]): number | null {
  if (values.length < 3) return null
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length)
}

function cleanTimes(laps: LapSample[]): number[] {
  const valid = laps
    .filter((lap) => lap.lapTime != null && lap.lapTime > 0 && !lap.isPitInLap && !lap.isPitOutLap)
    .map((lap) => lap.lapTime as number)
  const best = valid.length ? Math.min(...valid) : null
  return best == null ? [] : valid.filter((time) => time <= best * 1.07)
}

export const PracticeEngine = {
  analyze(snapshot: RaceSnapshot): PracticeAnalysis {
    if (snapshot.session.type !== 'practice') {
      return { available: false, reason: 'Load a practice session.', runs: [], mostProductive: null, bestLongRun: null, isEstimate: true }
    }
    const runs: PracticeDriverRun[] = snapshot.drivers.map((driver) => {
      const entry = snapshot.timing.find((timing) => timing.driverNumber === driver.number)
      const laps = snapshot.laps.filter(
        (lap) =>
          lap.driverNumber === driver.number &&
          (lap.sessionTime == null || !Number.isFinite(lap.sessionTime) || lap.sessionTime <= snapshot.clock)
      )
      const times = cleanTimes(laps)
      const bestLap = times.length ? Math.min(...times) : entry?.bestLap ?? null
      const recent = times.slice(-8)
      const longRun = recent.length >= 5 ? recent : []
      const longRunPace = median(longRun)
      const consistency = standardDeviation(longRun)
      const recentBest = recent.length ? Math.min(...recent) : null
      const program: PracticeProgram =
        times.length <= 2
          ? 'INSTALLATION'
          : longRun.length >= 5 && consistency != null && consistency <= 0.65
            ? 'LONG RUN'
            : recentBest != null && bestLap != null && recentBest <= bestLap * 1.003 && (entry?.stintAge ?? 0) <= 4
              ? 'QUALIFYING RUN'
              : 'MIXED'
      return {
        driverNumber: driver.number,
        code: driver.code,
        teamName: driver.teamName,
        lapCount: laps.length,
        bestLap,
        longRunPace,
        consistency,
        currentCompound: entry?.compound ?? null,
        program
      }
    }).sort((a, b) => (a.bestLap ?? Number.POSITIVE_INFINITY) - (b.bestLap ?? Number.POSITIVE_INFINITY))
    const productive = [...runs].sort((a, b) => b.lapCount - a.lapCount)[0] ?? null
    const longRuns = runs.filter((run) => run.longRunPace != null)
    const bestLongRun = [...longRuns].sort(
      (a, b) => (a.longRunPace as number) - (b.longRunPace as number)
    )[0] ?? null
    return {
      available: runs.some((run) => run.lapCount > 0),
      reason: runs.some((run) => run.lapCount > 0) ? null : 'Waiting for completed practice laps.',
      runs,
      mostProductive: productive,
      bestLongRun,
      isEstimate: true
    }
  }
} as const
