import type {
  LapSample,
  PitLaneTime,
  RaceControlMessage,
  SessionInfo,
  TimingEntry,
  TyreCompound
} from '@shared/models'
import type { RaceSnapshot } from '@renderer/core/providers/types'
import { compoundModel, driverRecentPace } from './AnalyticsEngine'

/**
 * StrategyEngine — race strategy intelligence. EVERYTHING it produces is an
 * ESTIMATE (heuristic), never presented as fact. Estimates are derived only
 * from real, available data; when inputs are missing, insights are omitted.
 *
 * The engine is deliberately deterministic and pure so it can be unit-tested and
 * so the AI Race Engineer layer can be *grounded* in these numbers rather than
 * inventing them. The AI narrates and reasons over this factual context; it
 * never manufactures the underlying figures.
 */

/**
 * Fallback pit loss, used only until a session has enough stops to measure its
 * own. Roughly the middle of the 2026 range; every circuit differs, which is why
 * `estimatePitLoss` replaces this as soon as it can.
 */
const PIT_LOSS_SEC = 21.5
const FRESH_TYRE_GAIN = 0.85 // s/lap advantage of fresh rubber over worn (early stint)
const OUTLAP_ADVANTAGE_LAPS = 1.6 // effective laps of fresh-tyre edge an undercut banks
const OVERTAKE_RANGE = 1.0 // within 1.0s = Overtake Mode range (2026 overtaking boost)
const SC_PIT_LOSS_FACTOR = 0.5 // a stop under SC/VSC costs ~half the green-flag loss

/**
 * Longest pit-lane transit that can still be a racing pit stop.
 *
 * `PitLaneTimeCollection` measures TIME IN THE PIT LANE, not time working on the
 * car — so it also records red-flag stoppages (the 2026 Monaco race has 16
 * entries clustered near 2150s, the whole field parked for ~36 minutes) and
 * retirements that end in the garage (two entries near 1000s in Australia).
 * Those are not slow stops and must not colour the field statistics either.
 * A genuinely botched stop — cross-threaded nut, stuck gun — stays well inside
 * this bound; measured maxima across six 2026 races sit between 28.6s and 44.9s.
 */
const PLAUSIBLE_STOP_MAX_SEC = 60
/**
 * Slow-stop threshold, in median-absolute-deviations above the field median.
 *
 * An absolute margin cannot work: median transit is a property of the PIT LANE,
 * ranging across 2026 from 19.0s (Melbourne) to 25.6s (Montreal). Comparing
 * within a session removes that, but the spread differs by circuit too — Austria
 * and Hungary run a MAD of 0.3s while Spa and Canada run 1.4-1.6s — so a fixed
 * margin would be noise at one track and blind at another. Scaling by the
 * session's own dispersion adapts automatically; the floor stops a freakishly
 * consistent pit lane from flagging ordinary half-second variation.
 */
const SLOW_STOP_MAD_MULTIPLE = 4
const SLOW_STOP_MIN_MARGIN_SEC = 4
/** Fewest plausible stops before the field statistics mean anything. */
const MIN_STOPS_FOR_COMPARISON = 5

/** Median of a non-empty numeric array (caller guarantees length). */
function median(sorted: number[]): number {
  return sorted[Math.floor(sorted.length / 2)]
}

// ── Per-circuit pit loss ───────────────────────────────────────────────────────

/** Clean laps either side of a stop used to establish that stop's reference pace. */
const PIT_LOSS_REFERENCE_WINDOW = 6
/** Fewest clean laps around a stop before its reference pace means anything. */
const MIN_REFERENCE_LAPS = 3
/** Fewest usable stops before a measured pit loss beats the generic default. */
const MIN_STOPS_FOR_PIT_LOSS = 4
/** Bounds on a believable green-flag pit loss, in seconds. */
const PIT_LOSS_MIN_SEC = 10
const PIT_LOSS_MAX_SEC = 60
/**
 * How much slower than a driver's own race pace the laps around a stop may run
 * before the stop is assumed to have happened under a neutralisation. Pitting
 * behind a safety car costs far less, and its slow reference laps would drag a
 * green-flag estimate down.
 */
const NEUTRALISED_PACE_RATIO = 1.15
/**
 * Which percentile of the measured losses to take as the circuit's pit loss.
 *
 * NOT the median. Every contaminating effect pushes a stop's measured loss the
 * SAME way — slower: a safety car deployed mid-stop, traffic on the out-lap, a
 * botched wheel gun, a red flag. Nothing makes a stop look artificially quick, so
 * the error is one-sided and the truth sits near the bottom of the distribution.
 * Measured across 2026: at clean races (Hungaroring, Spielberg) the distribution
 * is tight and percentile choice barely matters — p25 21.0s vs median 22.0s — but
 * at safety-car races the median is worthless while the low end stays sane
 * (Melbourne p25 28.8s vs median 52.0s; Monaco p25 24.8s vs median 48.4s). A
 * quartile rather than the minimum keeps one freak measurement from setting it.
 */
const PIT_LOSS_PERCENTILE = 0.25

export interface PitLossEstimate {
  /** Green-flag time lost by pitting, in seconds. */
  seconds: number
  /** Stops the estimate is built from; 0 when falling back to the default. */
  sampleSize: number
  /** 'measured' from this session's own stops, or the generic 'default'. */
  source: 'measured' | 'default'
}

/**
 * Measure this circuit's green-flag pit loss from the session's own laps.
 *
 * Pit loss is a property of the PIT LANE and its entry/exit geometry, so a single
 * constant cannot serve every track — measured transits alone range from 19.0s at
 * Melbourne to 25.6s at Montreal, and the loss itself varies at least as much.
 * Every projection built on it (undercut deltas, pit windows, the "box now"
 * verdict) inherits that error.
 *
 * Method, per stop: compare the in-lap and out-lap against the driver's OWN clean
 * pace in the laps either side, and sum the two excesses. Using the driver's local
 * pace as the reference cancels fuel load, tyre age and car performance, which a
 * field-wide comparison would not. A low percentile across stops then rejects the
 * contaminated ones — see PIT_LOSS_PERCENTILE for why the median will not do.
 *
 * Note this measures the loss a driver ACTUALLY experiences, which includes
 * warming a cold set on the out-lap. That is the right quantity for strategy: it
 * is what pitting really costs, not just the pit-lane transit.
 */
export function estimatePitLoss(laps: LapSample[]): PitLossEstimate | null {
  const byDriver = new Map<number, LapSample[]>()
  for (const lap of laps) {
    const arr = byDriver.get(lap.driverNumber)
    if (arr) arr.push(lap)
    else byDriver.set(lap.driverNumber, [lap])
  }

  const losses: number[] = []
  for (const driverLaps of byDriver.values()) {
    const sorted = [...driverLaps].sort((a, b) => a.lapNumber - b.lapNumber)
    const byLap = new Map(sorted.map((l) => [l.lapNumber, l]))
    const isClean = (l: LapSample): boolean =>
      l.lapTime != null && l.lapTime > 0 && !l.isPitInLap && !l.isPitOutLap
    const cleanTimes = sorted.filter(isClean).map((l) => l.lapTime as number)
    if (cleanTimes.length < MIN_REFERENCE_LAPS) continue
    const racePace = median([...cleanTimes].sort((a, b) => a - b))

    for (const inLap of sorted) {
      if (!inLap.isPitInLap || inLap.lapTime == null) continue
      const outLap = byLap.get(inLap.lapNumber + 1)
      if (!outLap || outLap.lapTime == null) continue

      // Reference pace from clean laps either side of THIS stop, so fuel burn
      // and tyre age are held roughly constant across the comparison.
      const nearby = sorted
        .filter(
          (l) =>
            isClean(l) && Math.abs(l.lapNumber - inLap.lapNumber) <= PIT_LOSS_REFERENCE_WINDOW
        )
        .map((l) => l.lapTime as number)
      if (nearby.length < MIN_REFERENCE_LAPS) continue
      const reference = median([...nearby].sort((a, b) => a - b))

      // Laps around the stop running well off the driver's own race pace mean a
      // safety car or red flag, where pitting is much cheaper — not a green-flag
      // pit loss, and including it would bias the circuit estimate downward.
      if (reference > racePace * NEUTRALISED_PACE_RATIO) continue

      const loss = inLap.lapTime - reference + (outLap.lapTime - reference)
      if (loss < PIT_LOSS_MIN_SEC || loss > PIT_LOSS_MAX_SEC) continue
      losses.push(loss)
    }
  }

  if (losses.length < MIN_STOPS_FOR_PIT_LOSS) return null
  losses.sort((a, b) => a - b)
  const index = Math.min(losses.length - 1, Math.floor(losses.length * PIT_LOSS_PERCENTILE))
  return { seconds: losses[index], sampleSize: losses.length, source: 'measured' }
}

/**
 * This session's pit loss, measured where possible. Memoised per snapshot: the
 * scan is O(laps) and every strategy projection asks for it.
 */
const pitLossBySnapshot = new WeakMap<RaceSnapshot, PitLossEstimate>()
export function circuitPitLoss(snapshot: RaceSnapshot): PitLossEstimate {
  const cached = pitLossBySnapshot.get(snapshot)
  if (cached) return cached
  const estimate = estimatePitLoss(snapshot.laps) ?? {
    seconds: PIT_LOSS_SEC,
    sampleSize: 0,
    source: 'default' as const
  }
  pitLossBySnapshot.set(snapshot, estimate)
  return estimate
}

/**
 * Time penalties served AT a pit stop, in seconds per driver.
 *
 * A 5- or 10-second penalty is served by sitting stationary in the box before
 * any work starts, so it lands in the measured pit-lane time and would read as a
 * slow stop of exactly that size. Race control announces them as
 * "FIA STEWARDS: 10 SECOND TIME PENALTY FOR CAR 27 (HUL) - CAUSING A COLLISION".
 * Only stop-served penalties count: a time penalty added to the final
 * classification never touches the pit lane, but those are announced the same
 * way, so this is a deliberate over-subtraction that errs towards silence rather
 * than towards accusing a crew of a slow stop they did not make.
 */
export function servedTimePenalties(messages: RaceControlMessage[]): Map<number, number> {
  const out = new Map<number, number>()
  for (const m of messages) {
    const match = /(\d+)\s*SECOND TIME PENALTY FOR CAR\s*(\d+)/i.exec(m.message ?? '')
    if (!match) continue
    const seconds = Number(match[1])
    const driver = Number(match[2])
    if (!Number.isFinite(seconds) || !Number.isFinite(driver)) continue
    out.set(driver, Math.max(out.get(driver) ?? 0, seconds))
  }
  return out
}

export interface PitLaneAnalysis {
  /** Field median transit for this pit lane, from plausible stops only. */
  medianSec: number
  /** Duration at or above which a stop counts as slow. */
  thresholdSec: number
  /** Stops that are genuinely slow, worst first, penalty time already removed. */
  slow: { driverNumber: number; duration: number; lostSec: number; penaltySec: number; lap: number | null }[]
  /** How many measured transits were plausible racing stops. */
  sampleSize: number
}

/**
 * Characterise this session's pit lane and find genuinely slow stops.
 *
 * Everything here is MEASURED, not modelled — but see the constants above for
 * why raw durations cannot be compared directly across circuits, or trusted
 * without first removing red-flag stoppages, retirements and served penalties.
 */
export function analysePitLane(
  pitLaneTimes: PitLaneTime[],
  raceControl: RaceControlMessage[] = []
): PitLaneAnalysis | null {
  const plausible = pitLaneTimes.filter((p) => p.duration > 0 && p.duration <= PLAUSIBLE_STOP_MAX_SEC)
  if (plausible.length < MIN_STOPS_FOR_COMPARISON) return null
  const sorted = plausible.map((p) => p.duration).sort((a, b) => a - b)
  const med = median(sorted)
  const mad = median(plausible.map((p) => Math.abs(p.duration - med)).sort((a, b) => a - b))
  const threshold = med + Math.max(SLOW_STOP_MIN_MARGIN_SEC, SLOW_STOP_MAD_MULTIPLE * mad)
  const penalties = servedTimePenalties(raceControl)
  const slow = plausible
    .map((p) => {
      const penaltySec = penalties.get(p.driverNumber) ?? 0
      return {
        driverNumber: p.driverNumber,
        duration: p.duration,
        penaltySec,
        lostSec: p.duration - penaltySec - med,
        lap: p.lap
      }
    })
    .filter((p) => p.duration - p.penaltySec >= threshold)
    .sort((a, b) => b.lostSec - a.lostSec)
  return { medianSec: med, thresholdSec: threshold, slow, sampleSize: plausible.length }
}
const REJOIN_TRAFFIC_WINDOW = 4.5 // ± seconds around the rejoin point = "traffic"
const MIN_GREEN_STINT_AGE_LAPS = 4
const MIN_GREEN_RACE_PROGRESS_LAP = 4
const MIN_GREEN_RECOVERY_LAPS = 6
const MIN_OPENING_STINT_PLAN_AGE = 4
const MIN_OPENING_STINT_STOP_AGE = 8
const MODERATE_DEGRADATION = 0.14
const HEAVY_DEGRADATION = 0.28
const PREPARE_DEGRADATION = 0.08

export type InsightKind =
  | 'undercut'
  | 'overcut'
  | 'pit-window'
  | 'safety-car'
  | 'degradation'
  | 'battle'
  | 'rejoin'
  | 'teammate'

export interface StrategyInsight {
  id: string
  kind: InsightKind
  title: string
  detail: string
  confidence: 'low' | 'medium' | 'high'
  driverNumbers: number[]
  /**
   * True for a projection (the default — a visible reminder that the number is
   * modelled). False only where the insight rests on data F1 actually measured,
   * such as a pit-lane transit time, so the UI can stop calling it an estimate.
   */
  isEstimate: boolean
}

export interface DegradationTrend {
  driverNumber: number
  compound: TyreCompound | null
  slopePerLap: number | null
  sampleLaps: number
}

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
  /** Positive = positions lost by stopping; negative = positions gained. */
  positionsLost: number | null

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

  verdict: PitVerdict
  confidence: 'low' | 'medium' | 'high'
  rationale: string[]
  isEstimate: true
}

// ── gap helpers ────────────────────────────────────────────────────────────────

/** Numeric gap-to-leader in seconds, or null when unknown / lapped. */
function numericGap(e: TimingEntry): number | null {
  if (e.position === 1) return 0
  if (typeof e.gapToLeader === 'number') return e.gapToLeader
  return null // '+1 LAP' or null → excluded from the road-position projection
}

function isKnownLapAtSnapshot(snapshot: RaceSnapshot, lap: LapSample): boolean {
  if (lap.sessionTime != null && Number.isFinite(lap.sessionTime)) {
    return lap.sessionTime <= snapshot.clock
  }
  if (snapshot.currentLap != null) return lap.lapNumber <= snapshot.currentLap
  return true
}

function knownLapsAtSnapshot(snapshot: RaceSnapshot, laps: LapSample[]): LapSample[] {
  return laps.filter((lap) => isKnownLapAtSnapshot(snapshot, lap))
}

function snapshotWithKnownLaps(snapshot: RaceSnapshot): RaceSnapshot {
  const laps = knownLapsAtSnapshot(snapshot, snapshot.laps)
  return laps.length === snapshot.laps.length ? snapshot : { ...snapshot, laps }
}

/**
 * The laps run in the driver's CURRENT stint.
 *
 * Must slice by `lapsThisStint`, not `stintAge`: on a used set those differ by
 * the laps the tyres already carried, and slicing by the larger tyre age drags
 * laps from an EARLIER stint on the same compound into the window — on a fresher
 * set, which flattens the degradation slope and skews every pit-window estimate.
 * Falls back to `stintAge` only when the stint-relative count is unavailable.
 */
function currentStintLaps(entry: TimingEntry | undefined, laps: LapSample[]): LapSample[] {
  const compound = entry?.compound ?? null
  if (compound == null) return laps
  const sameCompound = laps.filter((lap) => lap.compound === compound)
  const stintLaps = entry?.lapsThisStint ?? entry?.stintAge
  if (stintLaps == null || !Number.isFinite(stintLaps) || stintLaps <= 0) return sameCompound
  return sameCompound.slice(-Math.max(0, Math.trunc(stintLaps)))
}

export const StrategyEngine = {
  /** Linear tyre-deg slope (s/lap) from the last N green laps of a stint. */
  degradationTrend(laps: LapSample[], lastN = 6): number | null {
    const clean = laps
      .filter((l) => l.lapTime != null && l.lapTime > 0 && !l.isPitOutLap && !l.isPitInLap)
      .slice(-lastN)
    if (clean.length < 3) return null
    // Simple least-squares slope over lap index.
    const n = clean.length
    const xs = clean.map((_, i) => i)
    const ys = clean.map((l) => l.lapTime as number)
    const meanX = xs.reduce((a, b) => a + b, 0) / n
    const meanY = ys.reduce((a, b) => a + b, 0) / n
    let num = 0
    let den = 0
    for (let i = 0; i < n; i++) {
      num += (xs[i] - meanX) * (ys[i] - meanY)
      den += (xs[i] - meanX) ** 2
    }
    if (den === 0) return null
    return num / den
  },

  /**
   * Net seconds of an undercut: the attacker pits now, the car ahead responds one
   * lap later. Both pay the pit loss so it cancels; the swing is the fresh-tyre
   * pace banked over the overlap minus the gap that must be erased.
   * Positive ⇒ the attacker is projected to emerge ahead.
   */
  undercutDelta(intervalAheadSec: number, freshGainPerLap = FRESH_TYRE_GAIN): number {
    return freshGainPerLap * OUTLAP_ADVANTAGE_LAPS - intervalAheadSec
  },

  /**
   * Effective pit loss for a snapshot (discounted while the field is neutralized).
   * The green-flag figure is MEASURED from this session's own stops where enough
   * exist — pit loss is a property of the circuit, and 2026 spans 18.3s to 31.3s.
   */
  pitLossFor(snapshot: RaceSnapshot, greenLoss = circuitPitLoss(snapshot).seconds): number {
    const neutralized =
      snapshot.trackStatus === 'SAFETY_CAR' || snapshot.trackStatus === 'VSC'
    return neutralized ? greenLoss * SC_PIT_LOSS_FACTOR : greenLoss
  },

  /**
   * Predict the outcome of pitting a given driver *right now*. Deterministic and
   * pure — the single source of truth for the pit-now UI and the AI context.
   */
  predictPitStop(
    snapshot: RaceSnapshot,
    driverNumber: number,
    laps: LapSample[],
    greenPitLoss = circuitPitLoss(snapshot).seconds
  ): PitPrediction {
    const code = snapshot.drivers.find((d) => d.number === driverNumber)?.code ?? `#${driverNumber}`
    const neutralized =
      snapshot.trackStatus === 'SAFETY_CAR' || snapshot.trackStatus === 'VSC'
    const pitLoss = this.pitLossFor(snapshot, greenPitLoss)
    const lapsRemaining =
      snapshot.totalLaps != null && snapshot.currentLap != null
        ? Math.max(0, snapshot.totalLaps - snapshot.currentLap)
        : null
    const self = snapshot.timing.find((t) => t.driverNumber === driverNumber)
    const boundedLaps = knownLapsAtSnapshot(snapshot, laps)
    const stintLaps = currentStintLaps(self, boundedLaps)
    const slope = this.degradationTrend(stintLaps)

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
      positionsLost: null,
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
        reason: 'No numeric gap available yet for this driver — projection needs interval data.'
      }
    }

    // Build the field of cars with a known gap-to-leader (road-position basis).
    const codeOf = (n: number) =>
      snapshot.drivers.find((d) => d.number === n)?.code ?? `#${n}`
    const field = snapshot.timing
      .map((t) => ({ t, g: numericGap(t) }))
      .filter((x): x is { t: TimingEntry; g: number } => x.g != null)

    const rejoinGap = gSelf + pitLoss
    const currentPosition = self.position ?? field.filter((x) => x.g < gSelf).length + 1

    // Cars that would be ahead of the driver on the road after rejoin.
    const aheadAfter = field.filter((x) => x.t.driverNumber !== driverNumber && x.g < rejoinGap)
    const projectedPosition = aheadAfter.length + 1
    const positionsLost = projectedPosition - currentPosition

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
    const rejoinAhead =
      [...others].filter((c) => c.gapToLeader < rejoinGap).slice(-1)[0] ?? null
    const rejoinBehind = others.find((c) => c.gapToLeader >= rejoinGap) ?? null
    const traffic = others
      .filter((c) => Math.abs(c.relativeToRejoin) <= REJOIN_TRAFFIC_WINDOW)
      .sort((a, b) => a.relativeToRejoin - b.relativeToRejoin)

    // Undercut math vs the car currently directly ahead.
    const sorted = [...field].sort((a, b) => a.g - b.g)
    const selfIdx = sorted.findIndex((x) => x.t.driverNumber === driverNumber)
    const carAheadEntry = selfIdx > 0 ? sorted[selfIdx - 1] : null
    const intervalToCarAhead = carAheadEntry ? gSelf - carAheadEntry.g : null
    const undercutNet =
      intervalToCarAhead != null ? this.undercutDelta(intervalToCarAhead) : null
    const rawUndercutViable = undercutNet != null && undercutNet > 0
    const progressLap = snapshot.currentLap ?? self.lapNumber ?? null
    const currentAge = self.stintAge ?? null
    const meaningfulRaceProgress =
      progressLap != null ? progressLap >= MIN_GREEN_RACE_PROGRESS_LAP : stintLaps.length >= MIN_GREEN_STINT_AGE_LAPS
    const stintOldEnough =
      currentAge != null ? currentAge >= MIN_GREEN_STINT_AGE_LAPS : stintLaps.length >= MIN_GREEN_STINT_AGE_LAPS
    const enoughRecoveryTime = lapsRemaining == null || lapsRemaining >= MIN_GREEN_RECOVERY_LAPS
    const greenStopWindowOpen = meaningfulRaceProgress && stintOldEnough && enoughRecoveryTime
    const undercutViable = rawUndercutViable && greenStopWindowOpen
    const neutralizedStopWindowOpen =
      stintOldEnough && enoughRecoveryTime && (positionsLost <= 4 || (slope != null && slope > 0.12))
    const rules = raceRulesForSession(snapshot.session)
    const completedStops = self.pitStops ?? 0
    const wetTyreUsed = snapshot.stints.some(
      (stint) =>
        stint.driverNumber === driverNumber &&
        stint.lapStart <= (snapshot.currentLap ?? Number.MAX_SAFE_INTEGER) &&
        (stint.tyre.compound === 'INTERMEDIATE' || stint.tyre.compound === 'WET')
    )
    const effectiveMinimumStops = wetTyreUsed && rules.minimumPitStops === 1 ? 0 : rules.minimumPitStops
    const requiredStopsRemaining = Math.max(0, effectiveMinimumStops - completedStops)
    const ruleWindowUrgent =
      requiredStopsRemaining > 0 &&
      lapsRemaining != null &&
      lapsRemaining <= Math.max(10, requiredStopsRemaining * 8)
    const onDryTyre = self.compound === 'SOFT' || self.compound === 'MEDIUM' || self.compound === 'HARD'
    const wetTyreNeeded = snapshot.weather?.rainfall === true && onDryTyre

    // ── Verdict + rationale ──
    const rationale: string[] = []
    let verdict: PitVerdict = 'STAY OUT'
    let confidence: PitPrediction['confidence'] = 'medium'

    if (wetTyreNeeded && stintOldEnough) {
      verdict = 'BOX NOW'
      confidence = 'high'
      rationale.push('Rain is reported while the car is on a dry tyre — switch to a wet-weather compound.')
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
      greenStopWindowOpen &&
      slope != null &&
      slope >= HEAVY_DEGRADATION &&
      positionsLost <= 3
    ) {
      verdict = 'BOX NOW'
      confidence = 'high'
      rationale.push(`Heavy degradation (~+${slope.toFixed(2)}s/lap) with an acceptable rejoin cost — box before the tyre cliff.`)
    } else if (undercutViable && traffic.length <= 2) {
      verdict = 'UNDERCUT NOW'
      confidence = intervalToCarAhead! < OVERTAKE_RANGE ? 'high' : 'medium'
      rationale.push(
        `Undercut on ${codeOf(carAheadEntry!.t.driverNumber)} projects to net ~${undercutNet!.toFixed(1)}s — enough to emerge ahead.`
      )
    } else if (greenStopWindowOpen && (ruleWindowUrgent || (slope != null && slope >= MODERATE_DEGRADATION))) {
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
      rationale.push(`Tyre pace is beginning to fade (~+${slope.toFixed(2)}s/lap) — monitor the next 2–3 laps.`)
    } else if (!meaningfulRaceProgress) {
      rationale.push('Race still too young for a clear-track green-flag stop call on projections alone.')
    } else if (!stintOldEnough) {
      rationale.push('Current tyre stint is still too fresh — bank a few more laps before forcing the stop window.')
    } else if (!enoughRecoveryTime) {
      rationale.push('Too few laps remain to recover a clear-track stop unless the race neutralizes.')
    } else {
      rationale.push('Tyres are holding; track position is worth more than a stop right now.')
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
      positionsLost,
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
      verdict,
      confidence,
      rationale
    }
  },

  /** Generate the most relevant insights for the current snapshot. */
  generateInsights(
    snapshot: RaceSnapshot,
    lapsByDriver: (n: number) => LapSample[],
    favorites: number[] = []
  ): StrategyInsight[] {
    const insights: StrategyInsight[] = []
    const timing = snapshot.timing
    const nameOf = (n: number) =>
      snapshot.drivers.find((d) => d.number === n)?.code ?? `#${n}`

    // Safety car opportunity — a "cheap stop" window.
    if (snapshot.trackStatus === 'SAFETY_CAR' || snapshot.trackStatus === 'VSC') {
      const label = snapshot.trackStatus === 'VSC' ? 'Virtual Safety Car' : 'Safety Car'
      insights.push({
        id: 'sc-window',
        kind: 'safety-car',
        title: `${label} pit window open`,
        detail: `Track is neutralized — a stop now costs far less than usual (~40-60% of green-flag loss). Cars yet to stop have a cheap-stop opportunity. Estimate only.`,
        confidence: 'high',
        driverNumbers: [],
        isEstimate: true
      })
    }

    // Measured pit-lane transits (F1's PitLaneTimeCollection). This is REAL
    // measured time, not a model — so it can call out a genuinely slow stop
    // against the field's own median for this pit lane. Note the feed's Duration
    // is total pit-lane transit, NOT time lost versus staying out, so it is
    // reported and compared as measured, never substituted for the pit-loss model.
    const pitLane = analysePitLane(snapshot.pitLaneTimes ?? [], snapshot.raceControl)
    if (pitLane) {
      const worst = pitLane.slow.find(
        (p) => favorites.length === 0 || favorites.includes(p.driverNumber)
      )
      if (worst) {
        const penaltyNote =
          worst.penaltySec > 0
            ? ` A ${worst.penaltySec}s time penalty served at this stop has already been deducted.`
            : ''
        insights.push({
          id: `slow-stop-${worst.driverNumber}-${worst.lap ?? 0}`,
          kind: 'pit-window',
          title: `${nameOf(worst.driverNumber)}: slow stop — +${worst.lostSec.toFixed(1)}s`,
          detail: `Measured ${worst.duration.toFixed(1)}s in the pit lane${worst.lap != null ? ` on lap ${worst.lap}` : ''} against this pit lane's median of ${pitLane.medianSec.toFixed(1)}s across ${pitLane.sampleSize} stops — about ${worst.lostSec.toFixed(1)}s dropped versus a clean stop.${penaltyNote} Measured from F1's timing, not an estimate.`,
          confidence: 'high',
          driverNumbers: [worst.driverNumber],
          isEstimate: false
        })
      }
    }

    // Close battles (interval within overtake range) → undercut/overcut framing.
    for (let i = 1; i < timing.length; i++) {
      const car = timing[i]
      const ahead = timing[i - 1]
      const interval = typeof car.intervalAhead === 'number' ? car.intervalAhead : null
      if (interval == null || interval > OVERTAKE_RANGE + 0.6) continue
      const relevant =
        favorites.length === 0 ||
        favorites.includes(car.driverNumber) ||
        favorites.includes(ahead.driverNumber)
      if (!relevant) continue

      const net = this.undercutDelta(interval)
      const isUndercut = net > 0
      insights.push({
        id: `battle-${car.driverNumber}-${ahead.driverNumber}`,
        kind: isUndercut ? 'undercut' : 'battle',
        title: `${nameOf(car.driverNumber)} vs ${nameOf(ahead.driverNumber)} — ${interval.toFixed(2)}s`,
        detail: isUndercut
          ? `${nameOf(car.driverNumber)} is within undercut range of ${nameOf(ahead.driverNumber)}. A fresh-tyre stop could net ~${net.toFixed(1)}s. Estimate only.`
          : `${nameOf(car.driverNumber)} is attacking ${nameOf(ahead.driverNumber)} (overtake range). Track position battle — overcut may be safer than pitting. Estimate only.`,
        confidence: interval < OVERTAKE_RANGE ? 'high' : 'medium',
        driverNumbers: [car.driverNumber, ahead.driverNumber],
        isEstimate: true
      })
      if (insights.length >= 6) break
    }

    // Degradation warnings for favorites (or top runners if none).
    const watch = favorites.length ? favorites : timing.slice(0, 3).map((t) => t.driverNumber)
    for (const num of watch) {
      const entry = timing.find((t) => t.driverNumber === num)
      const slope = this.degradationTrend(currentStintLaps(entry, knownLapsAtSnapshot(snapshot, lapsByDriver(num))))
      if (slope != null && slope > 0.12) {
        insights.push({
          id: `deg-${num}`,
          kind: 'degradation',
          title: `${nameOf(num)} tyres dropping off`,
          detail: `Recent pace trend ~+${slope.toFixed(2)}s/lap on ${entry?.compound ?? 'current'} tyres. Pit window approaching. Estimate only.`,
          confidence: slope > 0.2 ? 'high' : 'medium',
          driverNumbers: [num],
          isEstimate: true
        })
      }
    }

    // Teammate battles — intra-team fights are the sharpest strategy signal.
    const teamOf = (n: number) => snapshot.drivers.find((d) => d.number === n)?.teamName ?? null
    const seenTeams = new Set<string>()
    for (const t of timing) {
      const team = teamOf(t.driverNumber)
      if (!team || seenTeams.has(team)) continue
      const mate = pickTeammate(timing, t.driverNumber, teamOf)
      if (mate == null) continue
      seenTeams.add(team)
      const a = timing.find((x) => x.driverNumber === t.driverNumber)
      const b = timing.find((x) => x.driverNumber === mate)
      if (!a || !b || a.position == null || b.position == null) continue
      const [lead, chase] = a.position < b.position ? [a, b] : [b, a]
      const gA = typeof lead.gapToLeader === 'number' ? lead.gapToLeader : null
      const gB = typeof chase.gapToLeader === 'number' ? chase.gapToLeader : null
      const split = gA != null && gB != null ? gB - gA : null
      const relevant =
        favorites.length === 0 ||
        favorites.includes(a.driverNumber) ||
        favorites.includes(b.driverNumber)
      if (!relevant || split == null || split > 4) continue
      insights.push({
        id: `mate-${team}`,
        kind: 'teammate',
        title: `${team}: ${nameOf(lead.driverNumber)} vs ${nameOf(chase.driverNumber)} — ${split.toFixed(1)}s`,
        detail: `Teammates split by ${split.toFixed(1)}s (P${lead.position} vs P${chase.position}). Watch for a strategic split or team orders — the trailing car may get the undercut call. Estimate only.`,
        confidence: split < 1.5 ? 'high' : 'medium',
        driverNumbers: [lead.driverNumber, chase.driverNumber],
        isEstimate: true
      })
      if (insights.length >= 10) break
    }

    return insights.slice(0, 8)
  },

  /** "Pit now?" assistant for one driver → a labeled recommendation. */
  pitNowAssistant(
    snapshot: RaceSnapshot,
    driverNumber: number,
    laps: LapSample[]
  ): StrategyInsight {
    const p = this.predictPitStop(snapshot, driverNumber, laps)
    const entry = snapshot.timing.find((t) => t.driverNumber === driverNumber)
    const detail = p.available
      ? `${p.rationale.join(' ')} (${entry?.compound ?? 'current'}, stint age ${entry?.stintAge ?? '—'} laps.) Estimate only.`
      : `${p.reason ?? 'Insufficient data for a projection.'} Estimate only.`
    return {
      id: `pit-now-${driverNumber}`,
      kind: 'pit-window',
      title: `${p.code}: ${p.verdict}`,
      detail,
      confidence: p.confidence,
      driverNumbers: [driverNumber],
      isEstimate: true
    }
  }
} as const

export function pickTeammate(
  timing: TimingEntry[],
  driverNumber: number,
  teamOf: (n: number) => string | null
): number | null {
  const team = teamOf(driverNumber)
  if (!team) return null
  const mate = timing.find((t) => t.driverNumber !== driverNumber && teamOf(t.driverNumber) === team)
  return mate?.driverNumber ?? null
}

// ── Optimal remaining stint strategy ────────────────────────────────────────────

const DRY_COMPOUNDS: TyreCompound[] = ['SOFT', 'MEDIUM', 'HARD']

export interface RaceStrategyRules {
  minimumPitStops: number
  requiresTwoDryCompounds: boolean
  label: string
}

/** FIA race-tyre rules that affect deterministic stint-plan legality. */
export function raceRulesForSession(session: SessionInfo): RaceStrategyRules {
  if (session.type !== 'race') {
    return { minimumPitStops: 0, requiresTwoDryCompounds: false, label: 'No race tyre rule' }
  }
  const identity = [session.meetingName, session.name, session.circuitName, session.location]
    .filter((value): value is string => !!value)
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

export interface StintSegment {
  compound: TyreCompound
  /** First lap of this stint (1-indexed). */
  startLap: number
  laps: number
  /** Tyre age at the start of the stint. */
  startAge: number
}

export interface StrategyPlan {
  stops: number
  segments: StintSegment[]
  /** Projected time (s) for the remaining laps under this plan. */
  finishTimeSec: number
  /** Seconds slower than the best plan. */
  deltaSec: number
  label: string
  /** Whether the plan (plus tyres already used) satisfies the 2-compound rule. */
  usesTwoCompounds: boolean
}

export interface RemainingStrategy {
  available: boolean
  reason: string | null
  driverNumber: number
  code: string
  lapsRemaining: number
  currentCompound: TyreCompound | null
  currentAge: number | null
  usedCompounds: TyreCompound[]
  minimumTotalStops: number
  minimumRemainingStops: number
  ruleLabel: string
  recommended: StrategyPlan | null
  alternatives: StrategyPlan[]
  isEstimate: true
}

function planLabel(plan: StrategyPlan): string {
  if (plan.stops === 0) {
    const c = plan.segments[0]?.compound ?? '—'
    return `No further stop · ${c} to the flag`
  }
  const stints = plan.segments.slice(1) // stints that begin with a pit
  const parts = stints.map((s) => `box L${s.startLap - 1} → ${s.compound}`)
  return `${plan.stops}-stop · ${parts.join(' · ')}`
}

/**
 * Optimal remaining stint plan for a driver: searches 0/1/2-stop options over a
 * pace + degradation model calibrated from THIS event's real laps, enforces the
 * dry two-compound rule, and ranks by projected finish time. All estimates.
 */
export function planRemainingStrategy(
  snapshot: RaceSnapshot,
  driverNumber: number,
  greenPitLoss = circuitPitLoss(snapshot).seconds
): RemainingStrategy {
  const liveSnapshot = snapshotWithKnownLaps(snapshot)
  const code = snapshot.drivers.find((d) => d.number === driverNumber)?.code ?? `#${driverNumber}`
  const base: RemainingStrategy = {
    available: false,
    reason: null,
    driverNumber,
    code,
    lapsRemaining: 0,
    currentCompound: null,
    currentAge: null,
    usedCompounds: [],
    minimumTotalStops: 0,
    minimumRemainingStops: 0,
    ruleLabel: 'No race tyre rule',
    recommended: null,
    alternatives: [],
    isEstimate: true
  }

  if (liveSnapshot.session.type !== 'race') return { ...base, reason: 'Stint planning applies to races.' }
  const total = liveSnapshot.totalLaps
  const cur = liveSnapshot.currentLap
  if (total == null || cur == null) return { ...base, reason: 'Race lap count unknown.' }
  const lapsRemaining = Math.max(0, total - cur)
  if (lapsRemaining < 2) return { ...base, lapsRemaining, reason: 'Too few laps remaining to plan.' }
  if (liveSnapshot.weather?.rainfall) {
    return { ...base, lapsRemaining, reason: 'Wet conditions — the dry stint model does not apply.' }
  }

  const entry = liveSnapshot.timing.find((t) => t.driverNumber === driverNumber)
  if (!entry) return { ...base, lapsRemaining, reason: 'Driver not in the current classification.' }
  const currentCompound = entry?.compound ?? null
  const currentAge = entry?.stintAge ?? 0
  const openingStint = (entry?.pitStops ?? 0) === 0
  const rules = raceRulesForSession(liveSnapshot.session)
  const completedStops = entry?.pitStops ?? 0
  const wetTyreUsed = liveSnapshot.stints.some(
    (stint) =>
      stint.driverNumber === driverNumber &&
      stint.lapStart <= cur &&
      (stint.tyre.compound === 'INTERMEDIATE' || stint.tyre.compound === 'WET')
  )
  const minimumTotalStops = wetTyreUsed && rules.minimumPitStops === 1 ? 0 : rules.minimumPitStops
  const minimumRemainingStops = Math.max(0, minimumTotalStops - completedStops)
  const ruleLabel = wetTyreUsed && rules.minimumPitStops === 1
    ? 'Wet-weather tyre used: dry compound rule waived'
    : rules.label
  if (openingStint && currentAge < MIN_OPENING_STINT_PLAN_AGE) {
    return {
      ...base,
      lapsRemaining,
      currentCompound,
      currentAge,
      minimumTotalStops,
      minimumRemainingStops,
      ruleLabel,
      reason: 'Opening stint is still too fresh to rank pit windows yet.'
    }
  }

  const model = compoundModel(liveSnapshot)
  if (model.size === 0) {
    return {
      ...base,
      lapsRemaining,
      currentCompound,
      currentAge,
      minimumTotalStops,
      minimumRemainingStops,
      ruleLabel,
      reason: 'Not enough clean-lap data to model the compounds yet.'
    }
  }

  const used = new Set<TyreCompound>()
  for (const st of liveSnapshot.stints) {
    if (st.driverNumber === driverNumber && st.lapStart <= cur) used.add(st.tyre.compound)
  }
  if (currentCompound) used.add(currentCompound)

  // Personalise the model with the driver's recent pace vs the field.
  const dRecent = driverRecentPace(liveSnapshot, driverNumber)
  const curModel = currentCompound ? model.get(currentCompound) : null
  const offset = dRecent != null && curModel ? dRecent - curModel.pace : 0
  const canMakeOpeningStop = (lapsIntoCurrentStint: number) =>
    !openingStint || currentAge + lapsIntoCurrentStint >= MIN_OPENING_STINT_STOP_AGE

  const stintTime = (compound: TyreCompound, laps: number, startAge: number): number => {
    const m = model.get(compound)
    if (laps <= 0) return 0
    if (!m) return Infinity
    const pace = m.pace + offset
    // Σ (pace + deg*(startAge + i)) for i in [0, laps)
    return laps * pace + m.deg * (startAge * laps + (laps * (laps - 1)) / 2)
  }

  const candidates = DRY_COMPOUNDS.filter((c) => model.has(c))
  const usesRequiredCompounds = (compounds: TyreCompound[]) =>
    wetTyreUsed || !rules.requiresTwoDryCompounds || new Set([...used, ...compounds]).size >= 2

  const makePlan = (segments: StintSegment[], stops: number): StrategyPlan => {
    const finishTimeSec =
      segments.reduce((a, s) => a + stintTime(s.compound, s.laps, s.startAge), 0) + stops * greenPitLoss
    const plan: StrategyPlan = {
      stops,
      segments,
      finishTimeSec,
      deltaSec: 0,
      label: '',
      usesTwoCompounds: usesRequiredCompounds(segments.map((s) => s.compound))
    }
    plan.label = planLabel(plan)
    return plan
  }

  const plans: StrategyPlan[] = []

  // 0-stop
  if (currentCompound) {
    plans.push(makePlan([{ compound: currentCompound, startLap: cur + 1, laps: lapsRemaining, startAge: currentAge }], 0))
  }

  // 1-stop — try every remaining pit lap × candidate compound.
  for (let pitLap = cur + 1; pitLap <= total - 1; pitLap++) {
    const seg1Laps = pitLap - cur
    const seg2Laps = total - pitLap
    if (currentCompound && !canMakeOpeningStop(seg1Laps)) continue
    for (const c of candidates) {
      const segments: StintSegment[] = []
      if (currentCompound && seg1Laps > 0) {
        segments.push({ compound: currentCompound, startLap: cur + 1, laps: seg1Laps, startAge: currentAge })
      }
      segments.push({ compound: c, startLap: pitLap + 1, laps: seg2Laps, startAge: 0 })
      plans.push(makePlan(segments, 1))
    }
  }

  // 2-stop — coarse search so it stays cheap.
  const step = Math.max(2, Math.round(lapsRemaining / 6))
  for (let p1 = cur + step; p1 <= total - step; p1 += step) {
    if (currentCompound && !canMakeOpeningStop(p1 - cur)) continue
    for (let p2 = p1 + step; p2 <= total - 1; p2 += step) {
      for (const c1 of candidates) {
        for (const c2 of candidates) {
          const segments: StintSegment[] = []
          if (currentCompound) {
            segments.push({ compound: currentCompound, startLap: cur + 1, laps: p1 - cur, startAge: currentAge })
          }
          segments.push({ compound: c1, startLap: p1 + 1, laps: p2 - p1, startAge: 0 })
          segments.push({ compound: c2, startLap: p2 + 1, laps: total - p2, startAge: 0 })
          plans.push(makePlan(segments, 2))
        }
      }
    }
  }

  // Rank only plans that satisfy both the event's minimum-stop and compound rules.
  const legal = plans.filter(
    (plan) => completedStops + plan.stops >= minimumTotalStops && plan.usesTwoCompounds
  )
  const pool = legal.sort((a, b) => a.finishTimeSec - b.finishTimeSec)
  const best = pool[0]
  if (!best) {
    return {
      ...base,
      lapsRemaining,
      currentCompound,
      currentAge,
      usedCompounds: [...used],
      minimumTotalStops,
      minimumRemainingStops,
      ruleLabel,
      reason: `No legal plan found for ${ruleLabel.toLowerCase()}.`
    }
  }

  // De-duplicate near-identical plans (same stops + compounds + ~pit windows).
  const seen = new Set<string>()
  const ranked: StrategyPlan[] = []
  for (const p of pool) {
    const sig =
      `${p.stops}:` +
      p.segments.map((s) => s.compound).join('') +
      ':' +
      p.segments.slice(1).map((s) => Math.round(s.startLap / 3)).join(',')
    if (seen.has(sig)) continue
    seen.add(sig)
    ranked.push(p)
    if (ranked.length >= 4) break
  }
  for (const p of ranked) p.deltaSec = p.finishTimeSec - best.finishTimeSec

  return {
    ...base,
    available: true,
    lapsRemaining,
    currentCompound,
    currentAge,
    usedCompounds: [...used],
    minimumTotalStops,
    minimumRemainingStops,
    ruleLabel,
    recommended: ranked[0] ?? null,
    alternatives: ranked.slice(1)
  }
}

// ── Pace battle: how much faster/slower vs the car ahead & behind ────────────────

export interface PaceRival {
  number: number
  code: string
  /** Interval to this rival (s), from the timing feed. */
  gapSec: number | null
  /** Gap-change rate (s/lap); positive = the gap is closing. */
  deltaPerLap: number | null
  rivalPace: number | null
  closing: boolean
  /** Laps to erase the gap at the current rate (only when closing). */
  lapsToResolve: number | null
}

export interface PaceBattle {
  available: boolean
  driverNumber: number
  code: string
  position: number | null
  driverPace: number | null
  ahead: PaceRival | null
  behind: PaceRival | null
}

/** How much faster/slower a driver is vs the car directly ahead and behind. */
export function paceComparison(snapshot: RaceSnapshot, driverNumber: number): PaceBattle {
  const liveSnapshot = snapshotWithKnownLaps(snapshot)
  const code = liveSnapshot.drivers.find((d) => d.number === driverNumber)?.code ?? `#${driverNumber}`
  const codeOf = (n: number) => liveSnapshot.drivers.find((d) => d.number === n)?.code ?? `#${n}`
  const ordered = [...liveSnapshot.timing]
    .filter((t) => t.position != null)
    .sort((a, b) => (a.position as number) - (b.position as number))
  const idx = ordered.findIndex((t) => t.driverNumber === driverNumber)
  const self = idx >= 0 ? ordered[idx] : liveSnapshot.timing.find((t) => t.driverNumber === driverNumber)

  const driverPace = driverRecentPace(liveSnapshot, driverNumber)
  const result: PaceBattle = {
    available: idx >= 0,
    driverNumber,
    code,
    position: self?.position ?? null,
    driverPace,
    ahead: null,
    behind: null
  }
  if (idx < 0) return result

  const num = (v: number | '+1 LAP' | null): number | null => (typeof v === 'number' ? v : null)

  // Ahead: gap shrinks when the focus driver is faster.
  const aheadEntry = idx > 0 ? ordered[idx - 1] : null
  if (aheadEntry) {
    const rivalPace = driverRecentPace(liveSnapshot, aheadEntry.driverNumber)
    const gap = num(self?.intervalAhead ?? null)
    const shrink = rivalPace != null && driverPace != null ? rivalPace - driverPace : null
    const closing = shrink != null && shrink > 0.03
    result.ahead = {
      number: aheadEntry.driverNumber,
      code: codeOf(aheadEntry.driverNumber),
      gapSec: gap,
      deltaPerLap: shrink,
      rivalPace,
      closing,
      lapsToResolve: closing && gap != null && shrink ? gap / shrink : null
    }
  }

  // Behind: gap shrinks when the car behind is faster than the focus driver.
  const behindEntry = idx < ordered.length - 1 ? ordered[idx + 1] : null
  if (behindEntry) {
    const rivalPace = driverRecentPace(liveSnapshot, behindEntry.driverNumber)
    const gap = num(behindEntry.intervalAhead)
    const shrink = rivalPace != null && driverPace != null ? driverPace - rivalPace : null
    const closing = shrink != null && shrink > 0.03
    result.behind = {
      number: behindEntry.driverNumber,
      code: codeOf(behindEntry.driverNumber),
      gapSec: gap,
      deltaPerLap: shrink,
      rivalPace,
      closing,
      lapsToResolve: closing && gap != null && shrink ? gap / shrink : null
    }
  }

  return result
}
