import type { LapSample, TimingEntry, TyreCompound } from '@shared/models'
import type { RaceSnapshot } from '@renderer/core/model/snapshot'
import { estimateFuelCoefficient } from '../FuelModel'
import {
  buildPitCycleField,
  classifyCloseTraffic,
  remainingStopRequirement
} from '../PitCycleModel'
import { circuitPitLoss, pitLossFor } from './PitLoss'
import { currentStintLaps, degradationTrend, knownLapsAtSnapshot, numericGap } from './StintLaps'
import { FRESH_TYRE_GAIN, OVERTAKE_RANGE, undercutDelta } from './Undercut'

const REJOIN_TRAFFIC_WINDOW = 4.5 // ± seconds around the rejoin point = "traffic"
const MIN_GREEN_STINT_AGE_LAPS = 4
const MIN_GREEN_RACE_PROGRESS_LAP = 4
const MIN_GREEN_RECOVERY_LAPS = 6
const MODERATE_DEGRADATION = 0.14
const HEAVY_DEGRADATION = 0.28
const PREPARE_DEGRADATION = 0.08

/** A car in the projected rejoin window after a hypothetical stop. */
export interface RejoinCar {
  driverNumber: number
  code: string
  gapToLeader: number
  /** Seconds relative to the driver's rejoin point (− ahead on road, + behind). */
  relativeToRejoin: number
  compound: TyreCompound | null
  stintAge: number | null
}

export type PitVerdict = 'BOX NOW' | 'BOX SOON' | 'UNDERCUT NOW' | 'PREPARE' | 'STAY OUT'

/**
 * A full "what happens if this driver pits *now*" projection. The headline
 * numbers — projected position, positions lost, rejoin gap — assume every other
 * car holds station (the standard reference scenario a race engineer pictures).
 */
export interface PitPrediction {
  driverNumber: number
  code: string
  available: boolean
  reason: string | null

  currentPosition: number | null
  currentGapToLeader: number | null

  /** Effective pit loss used for THIS projection (SC-discounted if neutralized). */
  pitLossSec: number
  /** Full green-flag pit loss, for reference. */
  greenPitLossSec: number
  freshTyreGainPerLap: number
  underNeutralization: boolean

  rejoinGapToLeaderSec: number | null
  projectedPosition: number | null
  /** Position after accounting for all still-required dry-race stops. */
  cycleAdjustedPosition: number | null
  /** Positive = positions lost by stopping; negative = positions gained. */
  positionsLost: number | null
  /** Positive = rejoining worse than the expected required-stop cycle position. */
  positionsLostVsCycle: number | null

  rejoinAhead: RejoinCar | null
  rejoinBehind: RejoinCar | null
  /** Gap to the car that would be directly ahead on the road after rejoin. */
  gapToChaseAheadSec: number | null
  /** Clear-air gap to the car that would be directly behind after rejoin. */
  clearAirBehindSec: number | null
  traffic: RejoinCar[]

  carAhead: number | null
  intervalToCarAheadSec: number | null
  /** Net seconds of an undercut vs the car ahead (>0 ⇒ projected to emerge ahead). */
  undercutNetSec: number | null
  undercutViable: boolean

  /** Laps of fresh-tyre pace needed to erase the pit loss vs a same-place rival. */
  recoveryLaps: number | null
  lapsRemaining: number | null
  degradationSlope: number | null
  requiredStopsRemaining: number

  verdict: PitVerdict
  confidence: 'low' | 'medium' | 'high'
  rationale: string[]
  isEstimate: true
}

/**
 * One entry in a side-by-side pit-decision comparison (APP_IMPROVEMENT_ROADMAP.md
 * P2 item 21). `box-now` and `box-neutralized` carry a full `PitPrediction`
 * (the latter by literally re-running `predictPitStop` under a hypothetical
 * neutralized snapshot — reusing its real verdict/rationale logic rather than
 * fabricating a second model). `box-plus-n` and `stay-out` are simpler derived
 * comparisons: extending `predictPitStop`'s own "assumes every other car holds
 * station" simplification into a fabricated future field state would be less
 * honest, not more.
 */
export interface PitScenario {
  id: 'box-now' | 'box-plus-n' | 'box-neutralized' | 'stay-out'
  label: string
  /** Full projection for box-now / box-neutralized; null for the derived scenarios. */
  prediction: PitPrediction | null
  /** Net seconds vs boxing now; positive = costs more, negative = saves. Null when not comparable. */
  deltaVsBoxNowSec: number | null
  rationale: string[]
  /** True when this scenario doesn't reflect the track's actual current state. */
  isHypothetical: boolean
}

/**
 * Predict the outcome of pitting a given driver *right now*. Deterministic and
 * pure — the single source of truth for the pit-now UI and the AI context.
 */
export function predictPitStop(
  snapshot: RaceSnapshot,
  driverNumber: number,
  laps: LapSample[],
  greenPitLoss = circuitPitLoss(snapshot).seconds
): PitPrediction {
  const code = snapshot.drivers.find((d) => d.number === driverNumber)?.code ?? `#${driverNumber}`
  const neutralized = snapshot.trackStatus === 'SAFETY_CAR' || snapshot.trackStatus === 'VSC'
  const pitLoss = pitLossFor(snapshot, greenPitLoss)
  const lapsRemaining =
    snapshot.totalLaps != null && snapshot.currentLap != null
      ? Math.max(0, snapshot.totalLaps - snapshot.currentLap)
      : null
  const self = snapshot.timing.find((t) => t.driverNumber === driverNumber)
  const boundedLaps = knownLapsAtSnapshot(snapshot, laps)
  const stintLaps = currentStintLaps(self, boundedLaps)
  // Fuel-corrected: burn-off makes later stint laps faster for reasons that
  // are nothing to do with the tyre, and would otherwise flatten the slope.
  const rawSlope = degradationTrend(stintLaps, 6, estimateFuelCoefficient(snapshot))
  const stopState = self ? remainingStopRequirement(snapshot, self) : null
  const closeTraffic = self ? classifyCloseTraffic(snapshot, self) : null
  const slope = closeTraffic?.isCloseTraffic ? null : rawSlope

  const base: PitPrediction = {
    driverNumber,
    code,
    available: false,
    reason: null,
    currentPosition: null,
    currentGapToLeader: null,
    pitLossSec: pitLoss,
    greenPitLossSec: greenPitLoss,
    freshTyreGainPerLap: FRESH_TYRE_GAIN,
    underNeutralization: neutralized,
    rejoinGapToLeaderSec: null,
    projectedPosition: null,
    cycleAdjustedPosition: null,
    positionsLost: null,
    positionsLostVsCycle: null,
    rejoinAhead: null,
    rejoinBehind: null,
    gapToChaseAheadSec: null,
    clearAirBehindSec: null,
    traffic: [],
    carAhead: null,
    intervalToCarAheadSec: null,
    undercutNetSec: null,
    undercutViable: false,
    recoveryLaps: pitLoss / FRESH_TYRE_GAIN,
    lapsRemaining,
    degradationSlope: slope,
    requiredStopsRemaining: stopState?.requiredStopsRemaining ?? 0,
    verdict: 'STAY OUT',
    confidence: 'low',
    rationale: [],
    isEstimate: true
  }

  if (!self) {
    return { ...base, reason: 'Driver not in the current classification.' }
  }
  const gSelf = numericGap(self)
  if (gSelf == null) {
    return {
      ...base,
      currentPosition: self.position,
      requiredStopsRemaining: stopState?.requiredStopsRemaining ?? 0,
      reason: 'No numeric gap available yet for this driver — projection needs interval data.'
    }
  }

  // Build the field of cars with a known gap-to-leader (road-position basis).
  const codeOf = (n: number) => snapshot.drivers.find((d) => d.number === n)?.code ?? `#${n}`
  const field = snapshot.timing
    .map((t) => ({ t, g: numericGap(t) }))
    .filter((x): x is { t: TimingEntry; g: number } => x.g != null)

  const rejoinGap = gSelf + pitLoss
  const currentPosition = self.position ?? field.filter((x) => x.g < gSelf).length + 1
  const pitCycleState = buildPitCycleField(snapshot, greenPitLoss, snapshot.timing).byDriver.get(
    driverNumber
  )

  // Cars that would be ahead of the driver on the road after rejoin.
  const aheadAfter = field.filter((x) => x.t.driverNumber !== driverNumber && x.g < rejoinGap)
  const projectedPosition = aheadAfter.length + 1
  const positionsLost = projectedPosition - currentPosition
  const cycleAdjustedPosition = pitCycleState?.cycleAdjustedPosition ?? null
  const positionsLostVsCycle =
    cycleAdjustedPosition == null ? null : projectedPosition - cycleAdjustedPosition

  const toRejoinCar = (x: { t: TimingEntry; g: number }): RejoinCar => ({
    driverNumber: x.t.driverNumber,
    code: codeOf(x.t.driverNumber),
    gapToLeader: x.g,
    relativeToRejoin: x.g - rejoinGap,
    compound: x.t.compound,
    stintAge: x.t.stintAge
  })

  // Nearest cars either side of the rejoin point.
  const others = field
    .filter((x) => x.t.driverNumber !== driverNumber)
    .map(toRejoinCar)
    .sort((a, b) => a.gapToLeader - b.gapToLeader)
  const rejoinAhead = [...others].filter((c) => c.gapToLeader < rejoinGap).slice(-1)[0] ?? null
  const rejoinBehind = others.find((c) => c.gapToLeader >= rejoinGap) ?? null
  const traffic = others
    .filter((c) => Math.abs(c.relativeToRejoin) <= REJOIN_TRAFFIC_WINDOW)
    .sort((a, b) => a.relativeToRejoin - b.relativeToRejoin)

  // Undercut math vs the car currently directly ahead.
  const sorted = [...field].sort((a, b) => a.g - b.g)
  const selfIdx = sorted.findIndex((x) => x.t.driverNumber === driverNumber)
  const carAheadEntry = selfIdx > 0 ? sorted[selfIdx - 1] : null
  const intervalToCarAhead = carAheadEntry ? gSelf - carAheadEntry.g : null
  const undercutNet = intervalToCarAhead != null ? undercutDelta(intervalToCarAhead) : null
  const rawUndercutViable = undercutNet != null && undercutNet > 0
  const progressLap = snapshot.currentLap ?? self.lapNumber ?? null
  const currentAge = self.stintAge ?? null
  const meaningfulRaceProgress =
    progressLap != null
      ? progressLap >= MIN_GREEN_RACE_PROGRESS_LAP
      : stintLaps.length >= MIN_GREEN_STINT_AGE_LAPS
  const stintOldEnough =
    currentAge != null
      ? currentAge >= MIN_GREEN_STINT_AGE_LAPS
      : stintLaps.length >= MIN_GREEN_STINT_AGE_LAPS
  const enoughRecoveryTime = lapsRemaining == null || lapsRemaining >= MIN_GREEN_RECOVERY_LAPS
  const greenStopWindowOpen = meaningfulRaceProgress && stintOldEnough && enoughRecoveryTime
  const undercutViable = rawUndercutViable && greenStopWindowOpen
  const neutralizedStopWindowOpen =
    stintOldEnough && enoughRecoveryTime && (positionsLost <= 4 || (slope != null && slope > 0.12))
  const requiredStopsRemaining = stopState?.requiredStopsRemaining ?? 0
  const ruleWindowUrgent =
    requiredStopsRemaining > 0 &&
    lapsRemaining != null &&
    lapsRemaining <= Math.max(10, requiredStopsRemaining * 8)
  const requiredStopWindowOpen =
    requiredStopsRemaining > 0 && meaningfulRaceProgress && stintOldEnough
  const cycleAlignedStop = positionsLostVsCycle != null && positionsLostVsCycle <= 0
  const onDryTyre =
    self.compound === 'SOFT' || self.compound === 'MEDIUM' || self.compound === 'HARD'
  const wetTyreNeeded = snapshot.weather?.rainfall === true && onDryTyre

  // ── Verdict + rationale ──
  const rationale: string[] = []
  let verdict: PitVerdict = 'STAY OUT'
  let confidence: PitPrediction['confidence'] = 'medium'

  if (wetTyreNeeded && stintOldEnough) {
    verdict = 'BOX NOW'
    confidence = 'high'
    rationale.push(
      'Rain is reported while the car is on a dry tyre — switch to a wet-weather compound.'
    )
  } else if (neutralized && neutralizedStopWindowOpen) {
    verdict = 'BOX NOW'
    confidence = 'high'
    rationale.push(
      `Track neutralized — a stop now costs only ~${pitLoss.toFixed(0)}s (about half the green-flag loss).`
    )
  } else if (neutralized) {
    rationale.push(
      `Pit loss is cheaper under neutralization (~${pitLoss.toFixed(0)}s), but the tyre is too fresh or the rejoin cost is too high to stop now.`
    )
  } else if (
    requiredStopWindowOpen &&
    (ruleWindowUrgent || cycleAlignedStop || positionsLostVsCycle != null)
  ) {
    verdict = cycleAlignedStop && traffic.length <= 2 ? 'BOX NOW' : 'BOX SOON'
    confidence = 'medium'
    rationale.push(stopState?.cycleFactor ?? 'A required stop is still outstanding.')
    if (cycleAdjustedPosition != null) {
      rationale.push(
        cycleAlignedStop
          ? `Pitting now lands on the expected required-stop cycle (~P${cycleAdjustedPosition}).`
          : `The required-stop cycle is ~P${cycleAdjustedPosition}; traffic makes this a box-soon call.`
      )
    }
  } else if (
    greenStopWindowOpen &&
    slope != null &&
    slope >= HEAVY_DEGRADATION &&
    positionsLost <= 3
  ) {
    verdict = 'BOX NOW'
    confidence = 'high'
    rationale.push(
      `Heavy degradation (~+${slope.toFixed(2)}s/lap) with an acceptable rejoin cost — box before the tyre cliff.`
    )
  } else if (undercutViable && traffic.length <= 2) {
    verdict = 'UNDERCUT NOW'
    confidence = intervalToCarAhead! < OVERTAKE_RANGE ? 'high' : 'medium'
    rationale.push(
      `Undercut on ${codeOf(carAheadEntry!.t.driverNumber)} projects to net ~${undercutNet!.toFixed(1)}s — enough to emerge ahead.`
    )
  } else if (
    greenStopWindowOpen &&
    (ruleWindowUrgent || (slope != null && slope >= MODERATE_DEGRADATION))
  ) {
    verdict = 'BOX SOON'
    confidence = ruleWindowUrgent && slope == null ? 'medium' : 'high'
    rationale.push(
      ruleWindowUrgent
        ? `${requiredStopsRemaining} required stop${requiredStopsRemaining === 1 ? '' : 's'} still to serve — the legal pit window is closing.`
        : `Meaningful degradation (~+${slope!.toFixed(2)}s/lap) — target the next clean pit window.`
    )
  } else if (greenStopWindowOpen && rawUndercutViable) {
    verdict = 'PREPARE'
    confidence = 'medium'
    rationale.push(
      traffic.length > 2
        ? `The undercut gain is available, but ${traffic.length} cars crowd the rejoin window.`
        : 'The undercut margin is narrow — prepare the stop and confirm the next-lap traffic gap.'
    )
  } else if (greenStopWindowOpen && slope != null && slope >= PREPARE_DEGRADATION) {
    verdict = 'PREPARE'
    confidence = 'medium'
    rationale.push(
      `Tyre pace is beginning to fade (~+${slope.toFixed(2)}s/lap) — monitor the next 2–3 laps.`
    )
  } else if (!meaningfulRaceProgress) {
    rationale.push(
      'Race still too young for a clear-track green-flag stop call on projections alone.'
    )
  } else if (!stintOldEnough) {
    rationale.push(
      'Current tyre stint is still too fresh — bank a few more laps before forcing the stop window.'
    )
  } else if (!enoughRecoveryTime) {
    rationale.push('Too few laps remain to recover a clear-track stop unless the race neutralizes.')
  } else {
    rationale.push('Tyres are holding; track position is worth more than a stop right now.')
    // APP_IMPROVEMENT_ROADMAP.md P1 item 14: "the condition that would flip
    // STAY OUT to BOX" — the nearest actionable threshold this verdict is
    // still short of, when a degradation reading exists to compare against.
    if (slope != null && slope < PREPARE_DEGRADATION) {
      rationale.push(
        `Needs ~+${(PREPARE_DEGRADATION - slope).toFixed(2)}s/lap more degradation to trigger a stop call.`
      )
    }
  }

  if (closeTraffic?.isCloseTraffic) {
    rationale.push(
      'Following the car ahead within 1.6s — current degradation is traffic-contaminated, so tyre-drop is not actionable yet.'
    )
  }

  if (positionsLost > 0) {
    rationale.push(
      `Would rejoin ~P${projectedPosition} (${positionsLost} place${positionsLost === 1 ? '' : 's'} lost)${
        rejoinAhead ? `, right behind ${rejoinAhead.code}` : ''
      }.`
    )
  } else {
    rationale.push(`Would hold ~P${projectedPosition} — clear track on exit.`)
  }
  if (traffic.length > 0 && verdict !== 'STAY OUT') {
    const oldTyre = traffic.filter((c) => (c.stintAge ?? 0) >= 12).length
    rationale.push(
      `${traffic.length} car${traffic.length === 1 ? '' : 's'} in the rejoin window` +
        (oldTyre ? ` (${oldTyre} on worn tyres — passable on fresh rubber).` : '.')
    )
  }

  return {
    ...base,
    available: true,
    currentPosition,
    currentGapToLeader: gSelf,
    rejoinGapToLeaderSec: rejoinGap,
    projectedPosition,
    cycleAdjustedPosition,
    positionsLost,
    positionsLostVsCycle,
    rejoinAhead,
    rejoinBehind,
    gapToChaseAheadSec: rejoinAhead ? rejoinGap - rejoinAhead.gapToLeader : null,
    clearAirBehindSec: rejoinBehind ? rejoinBehind.gapToLeader - rejoinGap : null,
    traffic,
    carAhead: carAheadEntry?.t.driverNumber ?? null,
    intervalToCarAheadSec: intervalToCarAhead,
    undercutNetSec: undercutNet,
    undercutViable,
    recoveryLaps: pitLoss / FRESH_TYRE_GAIN,
    requiredStopsRemaining,
    verdict,
    confidence,
    rationale
  }
}

/**
 * Compare "box now" against three alternatives so the UI doesn't hide close
 * calls behind one recommendation (APP_IMPROVEMENT_ROADMAP.md P2 item 21).
 */
export function buildPitScenarios(
  snapshot: RaceSnapshot,
  driverNumber: number,
  laps: LapSample[],
  offsetLaps = 3,
  greenPitLoss = circuitPitLoss(snapshot).seconds
): PitScenario[] {
  const boxNow = predictPitStop(snapshot, driverNumber, laps, greenPitLoss)

  const alreadyNeutralized = snapshot.trackStatus === 'SAFETY_CAR' || snapshot.trackStatus === 'VSC'
  const boxNeutralized = alreadyNeutralized
    ? boxNow
    : predictPitStop({ ...snapshot, trackStatus: 'SAFETY_CAR' }, driverNumber, laps, greenPitLoss)

  const extraLossSec = boxNow.degradationSlope != null ? boxNow.degradationSlope * offsetLaps : null

  const stayOutRationale =
    boxNow.verdict === 'STAY OUT'
      ? boxNow.rationale
      : [
          `Staying out avoids an immediate ~${boxNow.pitLossSec.toFixed(0)}s pit loss` +
            (boxNow.degradationSlope != null
              ? `, but the tyre keeps degrading at ~${boxNow.degradationSlope.toFixed(2)}s/lap.`
              : '.')
        ]

  return [
    {
      id: 'box-now',
      label: 'Box now',
      prediction: boxNow,
      deltaVsBoxNowSec: 0,
      rationale: boxNow.rationale,
      isHypothetical: false
    },
    {
      id: 'box-plus-n',
      label: `Box in ${offsetLaps} laps`,
      prediction: null,
      deltaVsBoxNowSec: extraLossSec,
      rationale:
        extraLossSec != null
          ? [
              `Staying out ${offsetLaps} more laps costs ~${extraLossSec.toFixed(1)}s of pace at the current degradation rate.`,
              'Gap and traffic figures are frozen at the current snapshot, not re-simulated forward.'
            ]
          : ['Not enough clean-lap data to project a degradation cost for this offset.'],
      isHypothetical: true
    },
    {
      id: 'box-neutralized',
      label: 'Box under neutralization',
      prediction: boxNeutralized,
      deltaVsBoxNowSec: boxNeutralized.pitLossSec - boxNow.pitLossSec,
      rationale: alreadyNeutralized
        ? boxNeutralized.rationale
        : [
            `Hypothetical — track is currently green. Under Safety Car/VSC the pit loss would drop to ~${boxNeutralized.pitLossSec.toFixed(0)}s from ~${boxNow.pitLossSec.toFixed(0)}s.`
          ],
      isHypothetical: !alreadyNeutralized
    },
    {
      id: 'stay-out',
      label: 'Stay out',
      prediction: null,
      deltaVsBoxNowSec: null,
      rationale: stayOutRationale,
      isHypothetical: false
    }
  ]
}
