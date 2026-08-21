import { describe, expect, it } from 'vitest'
import {
  applyCurrentTyres,
  buildCurrentTyres,
  buildLapPositions,
  buildSessionBests,
  collectPitLaneTimes,
  collectTeamRadio,
  latestTrackMessage,
  mergeTopThreeDrivers
} from '@renderer/core/providers/f1normalize'
import type { F1StreamPoint } from '@shared/f1live'
import type { Driver, TimingEntry } from '@shared/models'

const pts = (...ds: unknown[]): F1StreamPoint[] => ds.map((d, i) => ({ t: i, d }))

describe('buildLapPositions', () => {
  it('reads the keyframe array shape', () => {
    const out = buildLapPositions(pts({ '1': { RacingNumber: '1', LapPosition: ['3', '2', '1'] } }), 99)
    expect(out).toEqual([{ driverNumber: 1, positions: [3, 2, 1] }])
  })

  it('survives deltas that patch LapPosition as an INDEXED OBJECT', () => {
    // The archive patches lap positions by index ({"2": "1"}), and the feed's
    // deep merge replaces the array with a plain object when it does. Treating
    // the merged value as an array-only shape silently lost every driver whose
    // positions were ever updated — i.e. all of them after lap one.
    const out = buildLapPositions(
      pts(
        { '44': { RacingNumber: '44', LapPosition: ['5'] } },
        { '44': { LapPosition: { '1': '4' } } },
        { '44': { LapPosition: { '2': '2' } } }
      ),
      99
    )
    expect(out).toEqual([{ driverNumber: 44, positions: [5, 4, 2] }])
  })

  it('nulls unclassified positions rather than inventing zeroes', () => {
    const out = buildLapPositions(pts({ '5': { RacingNumber: '5', LapPosition: ['1', '0', ''] } }), 99)
    expect(out[0].positions).toEqual([1, null, null])
  })

  it('ignores points beyond the requested clock', () => {
    const out = buildLapPositions(pts({ '1': { LapPosition: ['1'] } }, { '1': { LapPosition: ['1', '2'] } }), 0)
    expect(out[0].positions).toEqual([1])
  })
})

describe('buildSessionBests', () => {
  it('extracts best sectors and the four speed marks with field ranks', () => {
    const out = buildSessionBests(
      pts({
        Lines: {
          '1': {
            PersonalBestLapTime: { Value: '1:14.724', Position: 11 },
            BestSectors: [
              { Value: '24.957', Position: 1 },
              { Value: '26.220', Position: 8 },
              { Value: '22.772', Position: 18 }
            ],
            BestSpeeds: {
              I1: { Value: '292', Position: 14 },
              I2: { Value: '283', Position: 20 },
              FL: { Value: '318', Position: 16 },
              ST: { Value: '312', Position: 6 }
            }
          }
        }
      }),
      99
    )
    expect(out[0].bestLap).toEqual({ value: 74.724, rank: 11 })
    expect(out[0].bestSectors[0]).toEqual({ value: 24.957, rank: 1 })
    expect(out[0].speeds.st).toEqual({ value: 312, rank: 6 })
  })

  it('yields null marks for a driver with no times set yet', () => {
    const out = buildSessionBests(
      pts({ Lines: { '1': { PersonalBestLapTime: { Value: '' }, BestSpeeds: { ST: { Value: '' } } } } }),
      99
    )
    expect(out[0].bestLap.value).toBeNull()
    expect(out[0].speeds.st.value).toBeNull()
  })
})

describe('collectPitLaneTimes', () => {
  it('keeps entries the feed later deletes', () => {
    // Each pit time is published while the car is in the lane and `_deleted`
    // moments later. Merging would leave almost nothing; these must accumulate.
    const out = collectPitLaneTimes(
      pts(
        { PitTimes: { '6': { RacingNumber: '6', Duration: '22.9', Lap: '2' } } },
        { PitTimes: { _deleted: ['6'] } },
        { PitTimes: { '11': { RacingNumber: '11', Duration: '27.6', Lap: '12' } } }
      ),
      99
    )
    expect(out).toEqual([
      { driverNumber: 6, duration: 22.9, lap: 2 },
      { driverNumber: 11, duration: 27.6, lap: 12 }
    ])
  })

  it('collapses repeats of the same stop and skips unusable durations', () => {
    const out = collectPitLaneTimes(
      pts(
        { PitTimes: { '6': { Duration: '22.9', Lap: '2' } } },
        { PitTimes: { '6': { Duration: '22.9', Lap: '2' } } },
        { PitTimes: { '9': { Duration: '0', Lap: '3' } } }
      ),
      99
    )
    expect(out).toHaveLength(1)
  })
})

describe('collectTeamRadio', () => {
  it('builds absolute mp3 URLs beneath the session path, newest first', () => {
    const out = collectTeamRadio(
      pts({
        Captures: [
          { Utc: '2026-08-21T10:26:44Z', RacingNumber: '81', Path: 'TeamRadio/PIA_81.mp3' },
          { Utc: '2026-08-21T10:32:19Z', RacingNumber: '27', Path: 'TeamRadio/HUL_27.mp3' }
        ]
      }),
      99,
      '2026/2026-08-23_Dutch_Grand_Prix/2026-08-21_Practice_1/'
    )
    expect(out[0].driverNumber).toBe(27)
    expect(out[0].url).toBe(
      'https://livetiming.formula1.com/static/2026/2026-08-23_Dutch_Grand_Prix/2026-08-21_Practice_1/TeamRadio/HUL_27.mp3'
    )
  })

  it('returns nothing without a session path to resolve against', () => {
    const captures = pts({ Captures: [{ Utc: '', RacingNumber: '1', Path: 'TeamRadio/a.mp3' }] })
    expect(collectTeamRadio(captures, 99, null)).toEqual([])
  })
})

describe('currentTyres', () => {
  it('reads compound and whether the set is new', () => {
    const out = buildCurrentTyres(
      pts({ Tyres: { '1': { Compound: 'MEDIUM', New: true }, '3': { Compound: 'HARD', New: false } } }),
      99
    )
    expect(out).toEqual([
      { driverNumber: 1, compound: 'MEDIUM', isNew: true },
      { driverNumber: 3, compound: 'HARD', isNew: false }
    ])
  })

  it('fills a missing compound but never overwrites a reconstructed stint', () => {
    // The stint reconstruction carries tyre AGE, which this feed does not — so
    // it may only fill gaps, never replace a known stint.
    const entries = [
      { driverNumber: 1, compound: null },
      { driverNumber: 3, compound: 'SOFT' }
    ] as TimingEntry[]
    applyCurrentTyres(entries, [
      { driverNumber: 1, compound: 'MEDIUM', isNew: true },
      { driverNumber: 3, compound: 'HARD', isNew: false }
    ])
    expect(entries[0].compound).toBe('MEDIUM')
    expect(entries[1].compound).toBe('SOFT')
  })
})

describe('latestTrackMessage', () => {
  it('returns the most recent ticker line at or before the clock', () => {
    const points = pts({ Message: 'YELLOW IN TRACK SECTOR 5' }, { Message: 'CLEAR IN TRACK SECTOR 5' })
    expect(latestTrackMessage(points, 99)).toBe('CLEAR IN TRACK SECTOR 5')
    expect(latestTrackMessage(points, 0)).toBe('YELLOW IN TRACK SECTOR 5')
  })
})

describe('mergeTopThreeDrivers', () => {
  const existing: Driver[] = [
    { number: 1, code: 'VER', firstName: null, lastName: null, fullName: 'Max Verstappen', broadcastName: null, teamName: 'Red Bull', teamColour: '3671C6', headshotUrl: null, countryCode: null }
  ]

  it('adds a driver the DriverList has not described', () => {
    const out = mergeTopThreeDrivers(
      existing,
      pts({ Lines: [{ RacingNumber: '44', Tla: 'HAM', FullName: 'Lewis HAMILTON', Team: 'Ferrari', TeamColour: 'ED1131' }] }),
      99
    )
    expect(out).toHaveLength(2)
    expect(out[1]).toMatchObject({ number: 44, code: 'HAM', teamColour: 'ED1131' })
  })

  it('never overrides an existing DriverList entry', () => {
    const out = mergeTopThreeDrivers(
      existing,
      pts({ Lines: [{ RacingNumber: '1', Tla: 'WRONG', Team: 'Nope' }] }),
      99
    )
    expect(out).toHaveLength(1)
    expect(out[0].code).toBe('VER')
  })
})
