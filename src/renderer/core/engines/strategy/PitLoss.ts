import type { LapSample, PitLaneTime, RaceControlMessage } from '@shared/models'
import type { RaceSnapshot } from '@renderer/core/model/snapshot'

/**
 * Pit-lane economics: the per-circuit green-flag pit loss (measured from the
 * session's own laps), the safety-car discount, and the measured pit-lane transit
 * analysis that flags genuinely slow stops. Estimates stay estimates; the
 * pit-lane analysis is measured data.
 */

/**
 * Fallback pit loss, used only until a session has enough stops to measure its
 * own. Roughly the middle of the 2026 range; every circuit differs, which is why
 * `estimatePitLoss` replaces this as soon as it can.
 */
const PIT_LOSS_SEC = 21.5
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
          (l) => isClean(l) && Math.abs(l.lapNumber - inLap.lapNumber) <= PIT_LOSS_REFERENCE_WINDOW
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
 * This session's pit loss, measured where possible. The scan is O(laps) and every
 * strategy projection asks for it. It is a function of `snapshot.laps` alone, and
 * the providers reuse that array between lap completions, so it is memoised on
 * the array rather than on the (per-tick) snapshot object.
 */
const pitLossByLaps = new WeakMap<readonly LapSample[], PitLossEstimate>()
export function circuitPitLoss(snapshot: RaceSnapshot): PitLossEstimate {
  const cached = pitLossByLaps.get(snapshot.laps)
  if (cached) return cached
  const estimate = estimatePitLoss(snapshot.laps) ?? {
    seconds: PIT_LOSS_SEC,
    sampleSize: 0,
    source: 'default' as const
  }
  pitLossByLaps.set(snapshot.laps, estimate)
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
  slow: {
    driverNumber: number
    duration: number
    lostSec: number
    penaltySec: number
    lap: number | null
  }[]
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
  const plausible = pitLaneTimes.filter(
    (p) => p.duration > 0 && p.duration <= PLAUSIBLE_STOP_MAX_SEC
  )
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

/**
 * Effective pit loss for a snapshot (discounted while the field is neutralized).
 * The green-flag figure is MEASURED from this session's own stops where enough
 * exist — pit loss is a property of the circuit, and 2026 spans 18.3s to 31.3s.
 */
export function pitLossFor(
  snapshot: RaceSnapshot,
  greenLoss = circuitPitLoss(snapshot).seconds
): number {
  const neutralized = snapshot.trackStatus === 'SAFETY_CAR' || snapshot.trackStatus === 'VSC'
  return neutralized ? greenLoss * SC_PIT_LOSS_FACTOR : greenLoss
}
