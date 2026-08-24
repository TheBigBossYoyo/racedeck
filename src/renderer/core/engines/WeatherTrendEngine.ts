import type { WeatherSample } from '@shared/models'

/**
 * Weather trend and drying-readiness reads (APP_IMPROVEMENT_ROADMAP.md P2
 * item 18). Deliberately NOT a forecast — nothing here predicts a future
 * value. It characterizes the real historical trend in `weatherHistory` so
 * the UI can say "rain stopped 6m ago, track temp rising" instead of just
 * showing the latest sample. Always pair with `modelled` provenance.
 */

export type WeatherTrendField = 'airTemp' | 'trackTemp' | 'windSpeed'
export type WeatherTrendDirection = 'rising' | 'falling' | 'stable'

export interface WeatherTrend {
  direction: WeatherTrendDirection
  /** Least-squares slope over the sampled window; null without enough history. */
  slopePerMin: number | null
}

/** Below this magnitude a slope reads as noise, not a real trend. */
const TREND_DEADBAND_PER_MIN = 0.3

/**
 * Least-squares slope of one weather field over its last `lastN` samples,
 * in units-per-minute (same regression shape as `StrategyEngine.degradationTrend`).
 */
export function weatherFieldTrend(
  history: WeatherSample[],
  field: WeatherTrendField,
  lastN = 8
): WeatherTrend {
  const clean = history
    .map((h) => ({ t: Date.parse(h.date), v: h[field] }))
    .filter((p): p is { t: number; v: number } => Number.isFinite(p.t) && p.v != null)
    .slice(-lastN)
  if (clean.length < 3) return { direction: 'stable', slopePerMin: null }

  const t0 = clean[0].t
  const xs = clean.map((p) => (p.t - t0) / 60_000)
  const ys = clean.map((p) => p.v)
  const n = xs.length
  const meanX = xs.reduce((a, b) => a + b, 0) / n
  const meanY = ys.reduce((a, b) => a + b, 0) / n
  let num = 0
  let den = 0
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (ys[i] - meanY)
    den += (xs[i] - meanX) ** 2
  }
  if (den === 0) return { direction: 'stable', slopePerMin: null }

  const slopePerMin = num / den
  const direction: WeatherTrendDirection =
    slopePerMin > TREND_DEADBAND_PER_MIN
      ? 'rising'
      : slopePerMin < -TREND_DEADBAND_PER_MIN
        ? 'falling'
        : 'stable'
  return { direction, slopePerMin }
}

export interface RainTransition {
  kind: 'onset' | 'cessation' | null
  elapsedSec: number | null
}

/** The most recent `rainfall` boolean flip in `history`, and how long ago it was. */
export function rainTransition(history: WeatherSample[]): RainTransition {
  if (history.length < 2) return { kind: null, elapsedSec: null }
  const latestMs = Date.parse(history[history.length - 1].date)
  if (!Number.isFinite(latestMs)) return { kind: null, elapsedSec: null }

  for (let i = history.length - 1; i > 0; i--) {
    if (history[i].rainfall === history[i - 1].rainfall) continue
    const flipMs = Date.parse(history[i].date)
    if (!Number.isFinite(flipMs)) return { kind: null, elapsedSec: null }
    return {
      kind: history[i].rainfall ? 'onset' : 'cessation',
      elapsedSec: Math.max(0, (latestMs - flipMs) / 1000)
    }
  }
  return { kind: null, elapsedSec: null }
}

export type DryingReadiness = 'raining' | 'drying' | 'dry' | 'unknown'

const JUST_STOPPED_SEC = 300
const LIKELY_DRY_SEC = 900

/**
 * A qualitative read on track conditions from real history, not a forecast:
 * `raining` (currently or just stopped), `drying` (stopped a while ago and
 * track temp is climbing or a lot of time has passed), `dry` (no rain seen
 * this session), or `unknown` when the signal is genuinely ambiguous.
 */
export function dryingReadiness(
  history: WeatherSample[],
  current: WeatherSample | null
): DryingReadiness {
  if (!current) return 'unknown'
  if (current.rainfall) return 'raining'

  const transition = rainTransition(history)
  if (transition.kind !== 'cessation' || transition.elapsedSec == null) {
    const everRained = history.some((h) => h.rainfall)
    return everRained ? 'unknown' : 'dry'
  }
  if (transition.elapsedSec < JUST_STOPPED_SEC) return 'raining'

  const trackTrend = weatherFieldTrend(history, 'trackTemp')
  if (trackTrend.direction === 'rising' || transition.elapsedSec > LIKELY_DRY_SEC) return 'drying'
  return 'unknown'
}
