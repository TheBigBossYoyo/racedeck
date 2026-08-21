import { describe, it, expect } from 'vitest'
import {
  parseDriverStandings,
  parseConstructorStandings,
  parseSchedule,
  resolveRound
} from '@shared/standings'

const driverJson = {
  MRData: {
    StandingsTable: {
      StandingsLists: [
        {
          round: '12',
          DriverStandings: [
            {
              position: '1', points: '250', wins: '7',
              Driver: { driverId: 'max_verstappen', permanentNumber: '1', code: 'VER', givenName: 'Max', familyName: 'Verstappen' },
              Constructors: [{ name: 'Red Bull' }]
            },
            {
              position: '2', points: '210', wins: '3',
              Driver: { driverId: 'norris', permanentNumber: '4', code: 'NOR', givenName: 'Lando', familyName: 'Norris' },
              Constructors: [{ name: 'McLaren' }]
            }
          ]
        }
      ]
    }
  }
}

const constructorJson = {
  MRData: {
    StandingsTable: {
      StandingsLists: [
        {
          ConstructorStandings: [
            { position: '1', points: '400', wins: '9', Constructor: { constructorId: 'mclaren', name: 'McLaren' } },
            { position: '2', points: '360', wins: '6', Constructor: { constructorId: 'red_bull', name: 'Red Bull' } }
          ]
        }
      ]
    }
  }
}

const scheduleJson = {
  MRData: {
    RaceTable: {
      Races: [
        { round: '11', raceName: 'Austrian Grand Prix', date: '2026-06-28', Circuit: { circuitId: 'red_bull_ring' } },
        { round: '12', raceName: 'British Grand Prix', date: '2026-07-05', Circuit: { circuitId: 'silverstone' }, Sprint: { date: '2026-07-04' } },
        { round: '13', raceName: 'Hungarian Grand Prix', date: '2026-07-19', Circuit: { circuitId: 'hungaroring' } }
      ]
    }
  }
}

describe('parseDriverStandings', () => {
  it('reads position, points, wins, driver identity and current team', () => {
    const rows = parseDriverStandings(driverJson)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      driverId: 'max_verstappen', code: 'VER', permanentNumber: 1,
      familyName: 'Verstappen', position: 1, points: 250, wins: 7, constructorName: 'Red Bull'
    })
    expect(rows[1].points).toBe(210)
  })

  it('tolerates a malformed / empty payload', () => {
    expect(parseDriverStandings({})).toEqual([])
    expect(parseDriverStandings(null)).toEqual([])
    expect(parseDriverStandings({ MRData: { StandingsTable: { StandingsLists: [] } } })).toEqual([])
  })
})

describe('parseConstructorStandings', () => {
  it('reads constructor rows with points and position', () => {
    const rows = parseConstructorStandings(constructorJson)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ constructorId: 'mclaren', name: 'McLaren', points: 400, position: 1 })
  })
})

describe('parseSchedule', () => {
  it('reads rounds ascending and flags sprint weekends', () => {
    const rounds = parseSchedule(scheduleJson)
    expect(rounds.map((r) => r.round)).toEqual([11, 12, 13])
    expect(rounds.find((r) => r.round === 12)?.hasSprint).toBe(true)
    expect(rounds.find((r) => r.round === 11)?.hasSprint).toBe(false)
  })
})

describe('resolveRound', () => {
  const schedule = parseSchedule(scheduleJson)

  it('matches a session on the exact race day', () => {
    expect(resolveRound(schedule, '2026-07-05')).toBe(12)
    expect(resolveRound(schedule, '2026-07-05T14:00:00Z')).toBe(12)
  })

  it('falls back to the most recent round on or before the date', () => {
    expect(resolveRound(schedule, '2026-07-10')).toBe(12)
    expect(resolveRound(schedule, '2026-06-30')).toBe(11)
  })

  it('returns null before the season or with no date', () => {
    expect(resolveRound(schedule, '2026-01-01')).toBeNull()
    expect(resolveRound(schedule, null)).toBeNull()
  })
})
