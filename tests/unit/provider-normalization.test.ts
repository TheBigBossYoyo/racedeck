import { describe, it, expect } from 'vitest'
import {
  normalizeCompound,
  normalizeFlag,
  normalizeGap,
  raceControlSeverity,
  nearestAtOrBefore,
  toMs
} from '@renderer/core/providers/normalize'
import { DemoProvider } from '@renderer/core/providers/DemoProvider'

describe('normalize helpers', () => {
  it('normalizes tyre compounds', () => {
    expect(normalizeCompound('SOFT')).toBe('SOFT')
    expect(normalizeCompound('m')).toBe('MEDIUM')
    expect(normalizeCompound('inter')).toBe('INTERMEDIATE')
    expect(normalizeCompound('full_wet')).toBe('WET')
    expect(normalizeCompound('unknown-thing')).toBe('UNKNOWN')
    expect(normalizeCompound(null)).toBe('UNKNOWN')
  })

  it('normalizes flags', () => {
    expect(normalizeFlag('DOUBLE YELLOW')).toBe('DOUBLE_YELLOW')
    expect(normalizeFlag('chequered')).toBe('CHEQUERED')
    expect(normalizeFlag('RED')).toBe('RED')
    expect(normalizeFlag(null)).toBe('NONE')
  })

  it('normalizes gaps including lapped strings', () => {
    expect(normalizeGap(1.5)).toBe(1.5)
    expect(normalizeGap('2.34')).toBe(2.34)
    expect(normalizeGap('+1 LAP')).toBe('+1 LAP')
    expect(normalizeGap('+2 LAPS')).toBe('+1 LAP')
    expect(normalizeGap(null)).toBeNull()
    expect(normalizeGap(Number.NaN)).toBeNull()
  })

  it('derives race-control severity', () => {
    expect(raceControlSeverity('SafetyCar', 'NONE', 'SAFETY CAR DEPLOYED')).toBe('critical')
    expect(raceControlSeverity('CarEvent', 'NONE', 'CAR 20 5S PENALTY')).toBe('warning')
    expect(raceControlSeverity('Drs', 'NONE', 'DRS ENABLED')).toBe('notice')
    expect(raceControlSeverity('Other', 'NONE', 'hello world')).toBe('info')
    expect(raceControlSeverity(null, 'RED', 'anything')).toBe('critical')
  })

  it('finds the nearest sample at or before a timestamp (binary search)', () => {
    const items = [{ t: 10 }, { t: 20 }, { t: 30 }, { t: 40 }]
    expect(nearestAtOrBefore(items, 25, (x) => x.t)?.t).toBe(20)
    expect(nearestAtOrBefore(items, 40, (x) => x.t)?.t).toBe(40)
    expect(nearestAtOrBefore(items, 5, (x) => x.t)).toBeNull()
    expect(nearestAtOrBefore([], 5, (x: { t: number }) => x.t)).toBeNull()
  })

  it('parses timestamps safely', () => {
    expect(toMs(null)).toBe(0)
    expect(toMs('not-a-date')).toBe(0)
    expect(toMs('2023-07-29T15:05:00+00:00')).toBe(Date.parse('2023-07-29T15:05:00+00:00'))
  })
})

describe('DemoProvider normalization → internal models', () => {
  it('produces a coherent 20-car snapshot', async () => {
    const p = new DemoProvider()
    await p.loadSession()
    expect(p.getDuration()).toBeGreaterThan(0)

    const snap = p.getSnapshotAt(p.getDuration() * 0.5)
    expect(snap.drivers).toHaveLength(20)
    expect(snap.timing).toHaveLength(20)
    expect(snap.positions).toHaveLength(20)

    // Leader is P1 with zero gap; positions are contiguous 1..20.
    const leader = snap.timing.find((t) => t.position === 1)
    expect(leader).toBeDefined()
    expect(leader!.gapToLeader).toBe(0)
    expect(snap.timing.map((t) => t.position).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual(
      Array.from({ length: 20 }, (_, i) => i + 1)
    )
  })

  it('declares honest availability (no fake live positions/telemetry-off flags)', async () => {
    const p = new DemoProvider()
    await p.loadSession()
    const snap = p.getSnapshotAt(100)
    expect(snap.availability.timing).toBe(true)
    expect(snap.availability.stints).toBe(true)
    expect(snap.availability.positions).toBe(false) // no real x/y — progress fallback only
    expect(snap.availability.positionProgress).toBe(true)
    expect(snap.availability.live).toBe(false)
    // progress-based positions must carry a lapProgress in 0..1
    for (const pos of snap.positions) {
      expect(pos.lapProgress).not.toBeNull()
      expect(pos.lapProgress!).toBeGreaterThanOrEqual(0)
      expect(pos.lapProgress!).toBeLessThanOrEqual(1)
    }
  })

  it('is deterministic across instances', async () => {
    const a = new DemoProvider()
    const b = new DemoProvider()
    await a.loadSession()
    await b.loadSession()
    expect(a.getDuration()).toBe(b.getDuration())
    const t = a.getDuration() * 0.4
    const la = a.getSnapshotAt(t).timing.find((x) => x.position === 1)!.driverNumber
    const lb = b.getSnapshotAt(t).timing.find((x) => x.position === 1)!.driverNumber
    expect(la).toBe(lb)
  })

  it('returns a full lap history for a driver', async () => {
    const p = new DemoProvider()
    await p.loadSession()
    const laps = p.getDriverLaps(1)
    expect(laps.length).toBeGreaterThan(0)
    expect(laps[0]).toMatchObject({ driverNumber: 1, lapNumber: 1 })
    expect(typeof laps[0].lapTime).toBe('number')
  })
})
