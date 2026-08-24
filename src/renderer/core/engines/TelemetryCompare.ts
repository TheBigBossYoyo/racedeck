import type { TelemetrySample } from '@shared/models'

/**
 * Synchronized telemetry alignment for driver comparison (APP_IMPROVEMENT_ROADMAP.md
 * P2 item 22).
 *
 * No per-sample track-distance exists in this app's data, so "align by lap
 * progress" honestly means elapsed time since each lap's own start — not
 * distance. Buckets both series onto a shared elapsed-time axis; a bucket with
 * no sample within tolerance stays null (a real decimation gap) rather than
 * being interpolated into a fabricated value.
 */

export interface TelemetryOverlayPoint {
  tSec: number
  a: TelemetrySample | null
  b: TelemetrySample | null
}

function nearestSample(
  samples: readonly TelemetrySample[],
  lapStartMs: number,
  targetSec: number,
  toleranceSec: number
): TelemetrySample | null {
  let best: TelemetrySample | null = null
  let bestDiff = Infinity
  for (const s of samples) {
    const elapsedSec = (Date.parse(s.date) - lapStartMs) / 1000
    const diff = Math.abs(elapsedSec - targetSec)
    if (diff < bestDiff) {
      bestDiff = diff
      best = s
    }
  }
  return bestDiff <= toleranceSec ? best : null
}

/**
 * Bucket two drivers' telemetry onto a shared elapsed-seconds-since-lap-start
 * axis, `durationSec` long, at `bucketSec` resolution.
 */
export function alignTelemetryByLapTime(
  samplesA: readonly TelemetrySample[],
  lapStartIsoA: string,
  samplesB: readonly TelemetrySample[],
  lapStartIsoB: string,
  durationSec: number,
  bucketSec = 0.2
): TelemetryOverlayPoint[] {
  const startA = Date.parse(lapStartIsoA)
  const startB = Date.parse(lapStartIsoB)
  if (!Number.isFinite(startA) || !Number.isFinite(startB) || durationSec <= 0 || bucketSec <= 0) {
    return []
  }
  const bucketCount = Math.max(1, Math.ceil(durationSec / bucketSec))
  const tolerance = bucketSec * 1.5
  return Array.from({ length: bucketCount }, (_, i) => {
    const tSec = i * bucketSec
    return {
      tSec,
      a: nearestSample(samplesA, startA, tSec, tolerance),
      b: nearestSample(samplesB, startB, tSec, tolerance)
    }
  })
}
