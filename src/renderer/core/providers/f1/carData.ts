import type { TelemetrySample } from '@shared/models'
import { CAR_CHANNELS, ch45ToAeroMode, indexedToArray, type F1StreamPoint } from '@shared/f1live'
import { numOrNull as num, rec } from './shared'

/** Reads over the raw CarData stream. Moved from F1LiveProvider.ts. */

/** True once any point names at least one numbered car. */
export function hasUsableCarData(points: F1StreamPoint[]): boolean {
  for (const point of points) {
    for (const entry of indexedToArray(rec(point.d).Entries)) {
      if (Object.keys(rec(rec(entry).Cars)).some((key) => /^\d+$/.test(key))) return true
    }
  }
  return false
}

/** One driver's telemetry samples in `[t - windowSec, t]`. */
export function telemetryWindow(
  carDataPoints: F1StreamPoint[],
  driverNumber: number,
  t: number,
  windowSec: number
): TelemetrySample[] {
  const key = String(driverNumber)
  const lo = t - windowSec
  const out: TelemetrySample[] = []
  // Binary-search the window start; a linear scan re-walks the whole session
  // on every widget render once the playhead is deep into a race.
  let low = 0
  let high = carDataPoints.length
  while (low < high) {
    const mid = (low + high) >> 1
    if (carDataPoints[mid].t < lo) low = mid + 1
    else high = mid
  }
  for (let i = low; i < carDataPoints.length; i++) {
    const p = carDataPoints[i]
    if (p.t > t) break
    const entries = indexedToArray(rec(p.d).Entries)
    for (const e of entries) {
      const car = rec(rec(rec(e).Cars)[key]).Channels
      if (!car) continue
      const ch = rec(car)
      const drs = num(ch[CAR_CHANNELS.drs])
      out.push({
        driverNumber,
        date: new Date(p.t * 1000).toISOString(),
        speed: num(ch[CAR_CHANNELS.speed]),
        throttle: num(ch[CAR_CHANNELS.throttle]),
        brake: num(ch[CAR_CHANNELS.brake]),
        gear: num(ch[CAR_CHANNELS.gear]),
        rpm: num(ch[CAR_CHANNELS.rpm]),
        drs,
        drsActive: drs != null && [10, 12, 14].includes(drs),
        aeroMode: ch45ToAeroMode(drs)
      })
    }
  }
  return out
}
