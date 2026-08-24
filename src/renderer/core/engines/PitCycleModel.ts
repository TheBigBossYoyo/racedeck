import type { SessionInfo, TimingEntry, TyreCompound } from '@shared/models'
import type { RaceSnapshot } from '@renderer/core/providers/types'

const PIT_DEBT_THRESHOLD_SEC = 1.6
const PIT_DEBT_MAX_LOSS_SEC = 45
const PIT_LOSS_MAX_SEC = 35
const PIT_LOSS_MIN_SEC = 15

export interface RaceStrategyRules {
  minimumPitStops: number
  requiresTwoDryCompounds: boolean
  label: string
}

export interface RemainingStopRequirement {
  completedStops: number
  confidence: 'high' | 'medium'
  cycleFactor: string | null
  debtActive: boolean
  minimumTotalStops: number
  requiredStopsRemaining: number
  ruleLabel: string
  source: 'timing' | 'visible-stints'
  usedDryCompounds: readonly TyreCompound[]
  wetTyreUsed: boolean
}

export interface CloseTrafficState {
  aheadDriverNumber: number | null
  intervalAheadSec: number | null
  isCloseTraffic: boolean
}

export interface PitCycleDriverState extends RemainingStopRequirement {
  cycleAdjustedPosition: number | null
  cycleGapToLeaderSec: number | null
  relativeAdjustmentSec: number
}

export interface PitCycleFieldModel {
  byDriver: ReadonlyMap<number, PitCycleDriverState>
  effectivePitLossSec: number
  minimumKnownFieldDebt: number
}

function isDryCompound(compound: TyreCompound | null | undefined): compound is TyreCompound {
  return compound === 'SOFT' || compound === 'MEDIUM' || compound === 'HARD'
}

function isWetCompound(compound: TyreCompound | null | undefined): compound is TyreCompound {
  return compound === 'INTERMEDIATE' || compound === 'WET'
}

function isNeutralized(snapshot: RaceSnapshot): boolean {
  return snapshot.trackStatus === 'SAFETY_CAR' || snapshot.trackStatus === 'VSC'
}

function isRunningOnTrack(entry: TimingEntry): boolean {
  return !entry.inPit && !entry.retired && entry.status !== 'IN_PIT' && entry.status !== 'STOPPED' && entry.status !== 'RETIRED' && entry.status !== 'DNF' && entry.status !== 'DNS' && entry.status !== 'DSQ'
}

function numericGap(entry: TimingEntry): number | null {
  if (entry.position === 1) return 0
  return typeof entry.gapToLeader === 'number' ? entry.gapToLeader : null
}

function visibleStints(snapshot: RaceSnapshot, driverNumber: number) {
  return snapshot.stints.filter(
    (stint) =>
      stint.driverNumber === driverNumber &&
      (snapshot.currentLap == null || stint.lapStart <= snapshot.currentLap)
  )
}

function hasCurrentStintEvidence(snapshot: RaceSnapshot, entry: TimingEntry, stints: ReturnType<typeof visibleStints>): boolean {
  const latest = stints[stints.length - 1]
  if (latest == null) return false
  const stintLaps =
    entry.lapsThisStint ??
    (entry.stintAge != null ? Math.max(0, entry.stintAge - latest.tyre.ageAtStart) : null)
  if (snapshot.currentLap == null || stintLaps == null || !Number.isFinite(stintLaps) || stintLaps <= 0) {
    return latest.lapEnd == null
  }
  const expectedStart = snapshot.currentLap - Math.trunc(stintLaps) + 1
  return Math.abs(expectedStart - latest.lapStart) <= 1
}

function usedDryCompounds(snapshot: RaceSnapshot, entry: TimingEntry): readonly TyreCompound[] {
  const stints = visibleStints(snapshot, entry.driverNumber)
  const used = new Set<TyreCompound>()
  for (const stint of stints) {
    if (isDryCompound(stint.tyre.compound)) used.add(stint.tyre.compound)
  }
  if (used.size === 0 && stints.length === 0 && (entry.pitStops == null || entry.pitStops <= 0) && isDryCompound(entry.compound)) {
    used.add(entry.compound)
  }
  return [...used]
}

function wetTyreUsed(snapshot: RaceSnapshot, entry: TimingEntry): boolean {
  return isWetCompound(entry.compound) || visibleStints(snapshot, entry.driverNumber).some((stint) => isWetCompound(stint.tyre.compound))
}

function completedStops(snapshot: RaceSnapshot, entry: TimingEntry) {
  if (typeof entry.pitStops === 'number' && Number.isFinite(entry.pitStops) && entry.pitStops >= 0) {
    return { completedStops: Math.trunc(entry.pitStops), confidence: 'high' as const, source: 'timing' as const }
  }
  return {
    completedStops: Math.max(0, visibleStints(snapshot, entry.driverNumber).length - 1),
    confidence: 'medium' as const,
    source: 'visible-stints' as const
  }
}

export function raceRulesForSession(session: SessionInfo): RaceStrategyRules {
  if (session.type === 'sprint') {
    return { minimumPitStops: 0, requiresTwoDryCompounds: false, label: 'Sprint: no mandatory stop' }
  }
  if (session.type !== 'race') {
    return { minimumPitStops: 0, requiresTwoDryCompounds: false, label: 'No race tyre rule' }
  }
  const identity = [session.meetingName, session.name, session.circuitName, session.location]
    .filter((value): value is string => value != null && value.length > 0)
    .join(' ')
    .toLowerCase()
  const year = session.year ?? (session.dateStart ? new Date(session.dateStart).getUTCFullYear() : null)
  if (year === 2025 && identity.includes('monaco')) {
    return {
      minimumPitStops: 2,
      requiresTwoDryCompounds: true,
      label: 'Monaco 2025: two mandatory stops'
    }
  }
  return {
    minimumPitStops: 1,
    requiresTwoDryCompounds: true,
    label: 'Dry race: two compounds'
  }
}

export function remainingStopRequirement(snapshot: RaceSnapshot, entry: TimingEntry): RemainingStopRequirement {
  const rules = raceRulesForSession(snapshot.session)
  const stints = visibleStints(snapshot, entry.driverNumber)
  const stopState = completedStops(snapshot, entry)
  const usedCompounds = usedDryCompounds(snapshot, entry)
  const usedWetTyre = wetTyreUsed(snapshot, entry)
  const debtActive = snapshot.session.type === 'race' && snapshot.trackStatus !== 'RED' && snapshot.weather?.rainfall !== true
  const minimumTotalStops = usedWetTyre && rules.minimumPitStops === 1 ? 0 : rules.minimumPitStops
  const stopCountNeed = Math.max(0, minimumTotalStops - stopState.completedStops)
  const canAssessDryCompoundRule =
    stopState.completedStops === 0 ||
    (stints.length >= stopState.completedStops + 1 && hasCurrentStintEvidence(snapshot, entry, stints))
  const confidence = stopState.source === 'visible-stints'
    ? 'medium'
    : canAssessDryCompoundRule || stopState.completedStops === 0
      ? 'high'
      : 'medium'
  const dryCompoundNeed =
    usedWetTyre || !rules.requiresTwoDryCompounds || !canAssessDryCompoundRule || usedCompounds.length >= 2
      ? 0
      : 1
  const requiredStopsRemaining = debtActive ? Math.max(stopCountNeed, dryCompoundNeed) : 0
  const ruleLabel = snapshot.trackStatus === 'RED'
    ? 'Red flag — dry stop debt suspended'
    : snapshot.weather?.rainfall === true
      ? 'Active rain — dry stop debt suspended'
      : usedWetTyre && rules.minimumPitStops === 1
        ? 'Wet-weather tyre used: dry compound rule waived'
        : rules.label
  const cycleFactor = !debtActive || snapshot.session.type !== 'race'
    ? null
    : confidence === 'medium' && stopState.completedStops > 0 && !canAssessDryCompoundRule
      ? null
    : requiredStopsRemaining > 0
      ? `${requiredStopsRemaining} required stop${requiredStopsRemaining === 1 ? '' : 's'} outstanding`
      : 'Required stop served'
  return {
    completedStops: stopState.completedStops,
    confidence,
    cycleFactor,
    debtActive,
    minimumTotalStops,
    requiredStopsRemaining,
    ruleLabel,
    source: stopState.source,
    usedDryCompounds: usedCompounds,
    wetTyreUsed: usedWetTyre
  }
}

export function classifyCloseTraffic(snapshot: RaceSnapshot, entry: TimingEntry): CloseTrafficState {
  const ordered = [...snapshot.timing]
    .filter((timing): timing is TimingEntry & { position: number } => timing.position != null)
    .sort((left, right) => left.position - right.position)
  const index = ordered.findIndex((timing) => timing.driverNumber === entry.driverNumber)
  if (index <= 0 || !isRunningOnTrack(entry)) {
    return { aheadDriverNumber: null, intervalAheadSec: null, isCloseTraffic: false }
  }
  const ahead = ordered[index - 1]
  const intervalAheadSec = typeof entry.intervalAhead === 'number' ? entry.intervalAhead : null
  return {
    aheadDriverNumber: ahead.driverNumber,
    intervalAheadSec,
    isCloseTraffic: isRunningOnTrack(ahead) && intervalAheadSec != null && intervalAheadSec >= 0 && intervalAheadSec <= PIT_DEBT_THRESHOLD_SEC
  }
}

export function buildPitCycleField(
  snapshot: RaceSnapshot,
  greenPitLossSec: number,
  entries: readonly TimingEntry[] = snapshot.timing
): PitCycleFieldModel {
  const effectivePitLossSec = Math.min(
    PIT_DEBT_MAX_LOSS_SEC,
    Math.max(PIT_LOSS_MIN_SEC, Math.min(PIT_LOSS_MAX_SEC, greenPitLossSec)) * (isNeutralized(snapshot) ? 0.5 : 1)
  )
  const drivers = entries.map((entry) => {
    const requirement = remainingStopRequirement(snapshot, entry)
    const gapToLeader = numericGap(entry)
    return {
      driverNumber: entry.driverNumber,
      cycleGapToLeaderSec:
        gapToLeader == null ? null : gapToLeader + requirement.requiredStopsRemaining * effectivePitLossSec,
      entry,
      requirement
    }
  })
  const trustedDrivers = drivers.filter(
    (driver) => driver.requirement.confidence === 'high' || driver.requirement.source === 'visible-stints'
  )
  const minimumKnownFieldDebt = (trustedDrivers.length === 0 ? drivers : trustedDrivers).reduce(
    (minimum, driver) => Math.min(minimum, driver.requirement.requiredStopsRemaining),
    Number.POSITIVE_INFINITY
  )
  const normalizedMinimum = Number.isFinite(minimumKnownFieldDebt) ? minimumKnownFieldDebt : 0
  const cyclePositions = new Map(
    drivers
      .filter((driver): driver is typeof driver & { cycleGapToLeaderSec: number } => driver.cycleGapToLeaderSec != null)
      .sort((left, right) => left.cycleGapToLeaderSec - right.cycleGapToLeaderSec)
      .map((driver, index) => [driver.driverNumber, index + 1])
  )
  return {
    byDriver: new Map(
      drivers.map((driver) => [
        driver.driverNumber,
        {
          ...driver.requirement,
          cycleAdjustedPosition: cyclePositions.get(driver.driverNumber) ?? null,
          cycleGapToLeaderSec: driver.cycleGapToLeaderSec,
          relativeAdjustmentSec: Math.min(
            PIT_DEBT_MAX_LOSS_SEC,
            Math.max(0, driver.requirement.requiredStopsRemaining - normalizedMinimum) * effectivePitLossSec
          )
        }
      ])
    ),
    effectivePitLossSec,
    minimumKnownFieldDebt: normalizedMinimum
  }
}
