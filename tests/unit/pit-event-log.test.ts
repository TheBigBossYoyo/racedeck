import { describe, expect, it } from 'vitest'
import { buildPitEventLog } from '@renderer/core/engines/PitEventLog'
import { baseSnapshot, entry, lap, raceAt, stint } from './fixtures/pit-log-race'

describe('buildPitEventLog', () => {
  it('is empty when nothing has happened', () => {
    expect(buildPitEventLog(baseSnapshot())).toEqual([])
    expect(buildPitEventLog(raceAt(900))).toEqual([])
  })

  it('builds a measured stop with duration, in/out laps and compounds', () => {
    const [row, ...rest] = buildPitEventLog(raceAt(1100))
    expect(rest).toEqual([])
    expect(row).toMatchObject({
      driverNumber: 1,
      lapIn: 10,
      lapOut: 11,
      durationSec: 24.3,
      compoundBefore: 'SOFT',
      compoundAfter: 'HARD',
      ongoing: false
    })
  })

  it('never invents a pit-lane duration for an unmeasured stop', () => {
    const rows = buildPitEventLog(raceAt(2100))
    const d44 = rows.find((r) => r.driverNumber === 44)!
    expect(d44.durationSec).toBeNull()
    expect(d44).toMatchObject({
      lapIn: 20,
      lapOut: 21,
      compoundBefore: 'MEDIUM',
      compoundAfter: 'HARD'
    })
  })

  it('lists stops newest first across the whole field', () => {
    const rows = buildPitEventLog(raceAt(2100))
    expect(rows.map((r) => r.driverNumber)).toEqual([44, 1])
  })

  it('marks a car still in the pit lane as ongoing and withholds what is not known yet', () => {
    const rows = buildPitEventLog(raceAt(2010))
    expect(rows[0]).toMatchObject({
      driverNumber: 44,
      lapIn: 20,
      lapOut: null,
      durationSec: null,
      compoundBefore: 'MEDIUM',
      compoundAfter: null,
      ongoing: true
    })
    // Driver 1's stop is finished and stays below the live one.
    expect(rows[1]).toMatchObject({ driverNumber: 1, ongoing: false })
  })

  it('shows a placeholder for a car in the pits before its in-lap is recorded', () => {
    const snapshot = baseSnapshot({
      clock: 500,
      laps: [lap(1, 4)],
      timing: [entry(1, { inPit: true }), entry(44)]
    })
    expect(buildPitEventLog(snapshot)).toEqual([
      expect.objectContaining({
        driverNumber: 1,
        lapIn: null,
        lapOut: null,
        durationSec: null,
        compoundBefore: null,
        compoundAfter: null,
        ongoing: true
      })
    ])
  })

  it('ignores retired cars that are parked in the pit lane', () => {
    const snapshot = baseSnapshot({
      laps: [lap(1, 4)],
      timing: [entry(1, { inPit: true, retired: true })]
    })
    expect(buildPitEventLog(snapshot)).toEqual([])
  })

  it('appears as the clock passes a stop and disappears when scrubbing back', () => {
    const drivers = (clock: number) => buildPitEventLog(raceAt(clock)).map((r) => r.driverNumber)
    expect(drivers(900)).toEqual([])
    expect(drivers(1100)).toEqual([1])
    expect(drivers(2100)).toEqual([44, 1])
    expect(drivers(1100)).toEqual([1])
    expect(drivers(900)).toEqual([])
  })

  it('does not leak future stints from an unclipped stint list', () => {
    // Stints already describe driver 44's lap-20 stop, but the clock is at lap 15.
    expect(buildPitEventLog(raceAt(1500)).map((r) => r.driverNumber)).toEqual([1])
  })

  it('drops rows the clock has not reached even if the provider handed over later laps', () => {
    const snapshot = { ...raceAt(2100), clock: 1100 }
    expect(buildPitEventLog(snapshot).map((r) => r.driverNumber)).toEqual([1])
  })

  it('merges a measured time, an in-lap flag and a stint boundary into one row', () => {
    const rows = buildPitEventLog(raceAt(1100))
    expect(rows.filter((r) => r.driverNumber === 1)).toHaveLength(1)
  })

  it('does not double-count when the stint boundary drifts by one lap from the measured lap', () => {
    const snapshot = raceAt(1100)
    snapshot.stints = [stint(1, 1, 1, 9, 'SOFT'), stint(1, 2, 10, null, 'HARD')]
    const rows = buildPitEventLog(snapshot)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      lapIn: 10,
      durationSec: 24.3,
      compoundBefore: 'SOFT',
      compoundAfter: 'HARD'
    })
  })

  it('derives a stop from out-lap flags alone (OpenF1 never flags in-laps)', () => {
    const snapshot = baseSnapshot({
      clock: 1300,
      laps: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map((n) =>
        lap(44, n, { isPitOutLap: n === 8 })
      ),
      stints: []
    })
    const [row] = buildPitEventLog(snapshot)
    expect(row).toMatchObject({ driverNumber: 44, lapIn: 7, lapOut: 8, durationSec: null })
  })

  it('reads a null (not a compound) when the feed says UNKNOWN', () => {
    const snapshot = raceAt(1100)
    snapshot.stints = [stint(1, 1, 1, 10, 'UNKNOWN'), stint(1, 2, 11, null, 'HARD')]
    const [row] = buildPitEventLog(snapshot)
    expect(row.compoundBefore).toBeNull()
    expect(row.compoundAfter).toBe('HARD')
  })

  it('keeps a measured stop whose lap the feed did not report, with no lap numbers', () => {
    const snapshot = baseSnapshot({
      pitLaneTimes: [{ driverNumber: 44, duration: 31.2, lap: null }]
    })
    expect(buildPitEventLog(snapshot)).toEqual([
      expect.objectContaining({ driverNumber: 44, lapIn: null, lapOut: null, durationSec: 31.2 })
    ])
  })

  it('gives every row a unique key, even two unattributed stops for one driver', () => {
    const snapshot = baseSnapshot({
      pitLaneTimes: [
        { driverNumber: 44, duration: 31.2, lap: null },
        { driverNumber: 44, duration: 22.8, lap: null }
      ]
    })
    const keys = buildPitEventLog(snapshot).map((r) => r.key)
    expect(keys).toHaveLength(2)
    expect(new Set(keys).size).toBe(2)
  })

  it('reads both stops when one lap is the out-lap of a stop and the in-lap of the next', () => {
    const snapshot = baseSnapshot({
      clock: 1300,
      laps: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map((n) =>
        lap(44, n, { isPitOutLap: n === 8, isPitInLap: n === 8 })
      )
    })
    expect(buildPitEventLog(snapshot).map((r) => r.lapIn)).toEqual([8, 7])
  })

  describe('two stints starting on the same lap (red-flag tyre change)', () => {
    const redFlagStints = [
      stint(1, 1, 1, 10, 'SOFT'),
      stint(1, 2, 11, 11, 'MEDIUM'),
      stint(1, 3, 11, null, 'HARD')
    ]
    const laps = (flagged: boolean) =>
      [...Array(12).keys()].map((i) => lap(1, i + 1, { isPitInLap: flagged && i + 1 === 10 }))

    it('collapses boundary-only stops into one row with the compound before the first and after the last', () => {
      const rows = buildPitEventLog(
        baseSnapshot({ clock: 1300, laps: laps(false), stints: redFlagStints, timing: [entry(1)] })
      )
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        driverNumber: 1,
        lapIn: 10,
        lapOut: 11,
        compoundBefore: 'SOFT',
        compoundAfter: 'HARD'
      })
    })

    it('keeps one row when a flagged in-lap already exists, and never repeats a key', () => {
      const rows = buildPitEventLog(
        baseSnapshot({ clock: 1300, laps: laps(true), stints: redFlagStints, timing: [entry(1)] })
      )
      expect(rows).toHaveLength(1)
      expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length)
      expect(rows[0]).toMatchObject({ lapIn: 10, compoundBefore: 'SOFT', compoundAfter: 'HARD' })
    })

    it('still reads a genuine second stop on a later lap as its own row', () => {
      const rows = buildPitEventLog(
        baseSnapshot({
          clock: 2300,
          laps: [...Array(22).keys()].map((i) => lap(1, i + 1)),
          stints: [...redFlagStints.slice(0, 2), stint(1, 3, 11, 20, 'HARD'), stint(1, 4, 21, null, 'SOFT')],
          timing: [entry(1)]
        })
      )
      expect(rows.map((r) => r.lapIn)).toEqual([20, 10])
      expect(new Set(rows.map((r) => r.key)).size).toBe(2)
    })
  })

  it('does not mutate the snapshot', () => {
    const snapshot = raceAt(2100)
    const before = JSON.stringify(snapshot)
    buildPitEventLog(snapshot)
    expect(JSON.stringify(snapshot)).toBe(before)
  })
})
