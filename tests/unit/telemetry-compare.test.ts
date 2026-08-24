import { describe, expect, it } from 'vitest'
import type { TelemetrySample } from '@shared/models'
import { alignTelemetryByLapTime } from '@renderer/core/engines/TelemetryCompare'

const LAP_START_A = '2026-03-01T14:00:00.000Z'
const LAP_START_B = '2026-03-01T14:05:00.000Z'

function sample(lapStartIso: string, elapsedSec: number, speed: number): TelemetrySample {
  return {
    driverNumber: 1,
    date: new Date(Date.parse(lapStartIso) + elapsedSec * 1000).toISOString(),
    speed,
    throttle: null,
    brake: null,
    gear: null,
    rpm: null,
    drs: null,
    drsActive: false,
    aeroMode: null
  }
}

describe('alignTelemetryByLapTime', () => {
  it('returns empty for a non-positive duration', () => {
    expect(alignTelemetryByLapTime([], LAP_START_A, [], LAP_START_B, 0)).toEqual([])
  })

  it('returns empty for unparseable lap-start timestamps', () => {
    expect(alignTelemetryByLapTime([], 'not-a-date', [], LAP_START_B, 90)).toEqual([])
  })

  it('buckets both series onto a shared elapsed-time axis', () => {
    const samplesA = [sample(LAP_START_A, 0, 100), sample(LAP_START_A, 1, 150)]
    const samplesB = [sample(LAP_START_B, 0, 90), sample(LAP_START_B, 1, 140)]
    const points = alignTelemetryByLapTime(samplesA, LAP_START_A, samplesB, LAP_START_B, 1.2, 1)
    expect(points).toHaveLength(2)
    expect(points[0].a?.speed).toBe(100)
    expect(points[0].b?.speed).toBe(90)
    expect(points[1].a?.speed).toBe(150)
    expect(points[1].b?.speed).toBe(140)
  })

  it('leaves a bucket null when no sample falls within tolerance (a real decimation gap)', () => {
    const samplesA = [sample(LAP_START_A, 0, 100)]
    // B has no samples near t=0 at all.
    const points = alignTelemetryByLapTime(samplesA, LAP_START_A, [], LAP_START_B, 1, 0.5)
    expect(points[0].a?.speed).toBe(100)
    expect(points[0].b).toBeNull()
  })

  it('does not fabricate a value by picking a far-away sample outside tolerance', () => {
    const samplesA = [sample(LAP_START_A, 10, 200)]
    const points = alignTelemetryByLapTime(samplesA, LAP_START_A, [], LAP_START_B, 1, 0.2)
    expect(points[0].a).toBeNull()
  })
})
