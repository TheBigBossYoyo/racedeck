import { describe, expect, it } from 'vitest'
import { buildRaceBookmarks } from '@renderer/core/engines/RaceBookmarks'
import type { RaceSnapshot } from '@renderer/core/providers/types'
import { emptyAvailability } from '@renderer/core/providers/types'
import type {
  Driver,
  LapPositionSeries,
  LapSample,
  RaceControlMessage,
  TeamRadioClip
} from '@shared/models'

// APP_IMPROVEMENT_ROADMAP.md P1 item 13: race-state bookmarks built from a
// full-duration snapshot, independent of the current playhead.

function driver(number: number, code: string): Driver {
  return {
    number,
    code,
    firstName: null,
    lastName: null,
    fullName: code,
    broadcastName: null,
    teamName: null,
    teamColour: null,
    headshotUrl: null,
    countryCode: null
  }
}

function rc(over: Partial<RaceControlMessage>): RaceControlMessage {
  return {
    id: 'rc',
    date: '',
    sessionTime: 100,
    category: 'Other',
    message: '',
    flag: 'NONE',
    scope: null,
    sector: null,
    driverNumber: null,
    lapNumber: null,
    severity: 'info',
    ...over
  }
}

function lap(over: Partial<LapSample>): LapSample {
  return {
    driverNumber: 1,
    lapNumber: 1,
    lapTime: 90,
    sector1: null,
    sector2: null,
    sector3: null,
    speedI1: null,
    speedI2: null,
    speedST: null,
    isPitOutLap: false,
    isPitInLap: false,
    compound: 'MEDIUM',
    dateStart: null,
    sessionTime: 90,
    ...over
  }
}

function baseSnapshot(over: Partial<RaceSnapshot> = {}): RaceSnapshot {
  return {
    session: {
      id: 's',
      meetingId: null,
      name: 'Race',
      type: 'race',
      meetingName: 'Test GP',
      circuitName: null,
      circuitShortName: null,
      countryName: null,
      countryCode: null,
      location: null,
      dateStart: '2026-01-01T14:00:00Z',
      dateEnd: null,
      gmtOffset: null,
      year: 2026,
      totalLaps: 50,
      provider: 'test'
    },
    drivers: [driver(1, 'AAA'), driver(2, 'BBB')],
    timing: [],
    laps: [],
    stints: [],
    raceControl: [],
    weather: null,
    weatherHistory: [],
    positions: [],
    availability: emptyAvailability(),
    clock: 0,
    currentLap: 50,
    totalLaps: 50,
    trackStatus: 'CLEAR',
    ...over
  }
}

describe('buildRaceBookmarks', () => {
  it('includes the green-flag start when given', () => {
    const bookmarks = buildRaceBookmarks(baseSnapshot(), 12)
    expect(bookmarks.find((b) => b.kind === 'start')).toMatchObject({ t: 12, label: 'Lights out' })
  })

  it('omits the start bookmark when greenStart is unknown', () => {
    const bookmarks = buildRaceBookmarks(baseSnapshot(), null)
    expect(bookmarks.find((b) => b.kind === 'start')).toBeUndefined()
  })

  it('classifies safety car, VSC and red flag from race control text', () => {
    const snap = baseSnapshot({
      raceControl: [
        rc({ id: 'a', message: 'SAFETY CAR DEPLOYED', sessionTime: 100 }),
        rc({ id: 'b', message: 'VIRTUAL SAFETY CAR DEPLOYED', sessionTime: 200 }),
        rc({ id: 'c', message: 'RED FLAG', flag: 'RED', sessionTime: 300 })
      ]
    })
    const bookmarks = buildRaceBookmarks(snap, null)
    expect(bookmarks.map((b) => b.kind)).toEqual(['safety-car', 'vsc', 'red-flag'])
  })

  it('surfaces a penalty message as a bookmark tied to the driver', () => {
    const snap = baseSnapshot({
      raceControl: [
        rc({ id: 'p', message: 'CAR 1 (AAA) 5 SECOND PENALTY', driverNumber: 1, sessionTime: 400 })
      ]
    })
    const bookmarks = buildRaceBookmarks(snap, null)
    expect(bookmarks).toEqual([
      expect.objectContaining({ kind: 'penalty', t: 400, driverNumber: 1 })
    ])
  })

  it('derives a pit-stop bookmark from a pit in-lap', () => {
    const snap = baseSnapshot({
      laps: [lap({ driverNumber: 2, lapNumber: 20, isPitInLap: true, sessionTime: 1_800 })]
    })
    const bookmarks = buildRaceBookmarks(snap, null)
    expect(bookmarks).toEqual([
      expect.objectContaining({
        kind: 'pit-stop',
        t: 1_800,
        driverNumber: 2,
        label: 'BBB pits (lap 20)'
      })
    ])
  })

  it('marks a lead change when a different driver first reaches P1', () => {
    const lapPositions: LapPositionSeries[] = [
      { driverNumber: 1, positions: [1, 1, 2] },
      { driverNumber: 2, positions: [2, 2, 1] }
    ]
    const snap = baseSnapshot({
      lapPositions,
      // lapTime: null isolates this fixture from also being picked up as the
      // session's fastest lap — this test is only about the lead-change kind.
      laps: [lap({ driverNumber: 2, lapNumber: 3, lapTime: null, sessionTime: 270 })]
    })
    const bookmarks = buildRaceBookmarks(snap, null)
    expect(bookmarks).toEqual([
      expect.objectContaining({
        kind: 'lead-change',
        t: 270,
        driverNumber: 2,
        label: 'BBB takes the lead'
      })
    ])
  })

  it('reports only the single fastest clean lap of the session', () => {
    const snap = baseSnapshot({
      laps: [
        lap({ driverNumber: 1, lapNumber: 5, lapTime: 88, sessionTime: 450 }),
        lap({ driverNumber: 2, lapNumber: 6, lapTime: 86, sessionTime: 540 }),
        // Faster time, but a pit-out lap — must not win.
        lap({ driverNumber: 1, lapNumber: 6, lapTime: 80, isPitOutLap: true, sessionTime: 530 })
      ]
    })
    const bookmarks = buildRaceBookmarks(snap, null)
    const fastest = bookmarks.filter((b) => b.kind === 'fastest-lap')
    expect(fastest).toHaveLength(1)
    expect(fastest[0]).toMatchObject({ driverNumber: 2, t: 540 })
  })

  it('converts a team-radio UTC timestamp to session-relative seconds', () => {
    const clips: TeamRadioClip[] = [{ driverNumber: 1, utc: '2026-01-01T14:05:00Z', url: 'x.mp3' }]
    const snap = baseSnapshot({ teamRadio: clips })
    const bookmarks = buildRaceBookmarks(snap, null)
    expect(bookmarks).toEqual([expect.objectContaining({ kind: 'radio', t: 300, driverNumber: 1 })])
  })

  it('sorts every bookmark kind chronologically', () => {
    const snap = baseSnapshot({
      raceControl: [rc({ id: 'x', message: 'SAFETY CAR', sessionTime: 500 })],
      laps: [lap({ driverNumber: 1, lapNumber: 10, isPitInLap: true, sessionTime: 100 })]
    })
    const bookmarks = buildRaceBookmarks(snap, 10)
    expect(bookmarks.map((b) => b.t)).toEqual([10, 100, 500])
  })
})
