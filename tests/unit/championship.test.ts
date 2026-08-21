import { describe, it, expect } from 'vitest'
import { projectChampionship } from '@renderer/core/engines/ChampionshipEngine'
import type { RaceSnapshot } from '@renderer/core/providers/types'
import type { SeasonChampionship, DriverStanding } from '@shared/standings'
import type { Driver, TimingEntry } from '@shared/models'

function driverStanding(over: Partial<DriverStanding> & { familyName: string; position: number; points: number }): DriverStanding {
  return {
    driverId: over.familyName.toLowerCase(),
    code: over.code ?? over.familyName.slice(0, 3).toUpperCase(),
    permanentNumber: over.permanentNumber ?? null,
    givenName: over.givenName ?? '',
    familyName: over.familyName,
    position: over.position,
    points: over.points,
    wins: over.wins ?? 0,
    constructorName: over.constructorName ?? null
  }
}

function driver(number: number, code: string, lastName: string, teamName: string): Driver {
  return {
    number, code, firstName: null, lastName, fullName: `${lastName}`,
    teamName, teamColour: '2293d1', countryCode: null, headshotUrl: null
  } as unknown as Driver
}

function timing(driverNumber: number, position: number): TimingEntry {
  return { driverNumber, position } as unknown as TimingEntry
}

function snapshot(over: Partial<RaceSnapshot>): RaceSnapshot {
  return {
    session: { type: 'race' },
    drivers: [],
    timing: [],
    ...over
  } as unknown as RaceSnapshot
}

const drivers = [
  driver(1, 'VER', 'Verstappen', 'Red Bull'),
  driver(4, 'NOR', 'Norris', 'McLaren'),
  driver(16, 'LEC', 'Leclerc', 'Ferrari')
]

function championship(over: Partial<SeasonChampionship>): SeasonChampionship {
  return {
    year: 2026, round: 20, roundResolved: true, raceName: 'Test Grand Prix',
    totalRounds: 24, remainingRounds: 4, remainingSprints: 0,
    driverStandings: [], constructorStandings: [],
    ...over
  }
}

describe('projectChampionship', () => {
  it('applies provisional race points onto the baseline and re-ranks', () => {
    const champ = championship({
      driverStandings: [
        driverStanding({ familyName: 'Verstappen', code: 'VER', permanentNumber: 1, position: 1, points: 100, constructorName: 'Red Bull' }),
        driverStanding({ familyName: 'Norris', code: 'NOR', permanentNumber: 4, position: 2, points: 95, constructorName: 'McLaren' })
      ]
    })
    // Norris wins this race (25), Verstappen only 5th (10) → Norris overtakes.
    const snap = snapshot({ drivers, timing: [timing(4, 1), timing(1, 5)] })
    const projection = projectChampionship(champ, snap)

    expect(projection.ok).toBe(true)
    expect(projection.live).toBe(true)
    const nor = projection.drivers.find((d) => d.code === 'NOR')!
    const ver = projection.drivers.find((d) => d.code === 'VER')!
    expect(nor.projectedPoints).toBe(120)
    expect(ver.projectedPoints).toBe(110)
    expect(nor.projectedPosition).toBe(1)
    expect(ver.projectedPosition).toBe(2)
    // Norris climbs from P2 to P1, Verstappen drops.
    expect(nor.positionDelta).toBe(1)
    expect(ver.positionDelta).toBe(-1)
    expect(nor.status).toBe('leader')
  })

  it('does not apply points outside a race/sprint session', () => {
    const champ = championship({
      driverStandings: [
        driverStanding({ familyName: 'Verstappen', permanentNumber: 1, position: 1, points: 100 }),
        driverStanding({ familyName: 'Norris', permanentNumber: 4, position: 2, points: 95 })
      ]
    })
    const snap = snapshot({ session: { type: 'qualifying' } as RaceSnapshot['session'], drivers, timing: [timing(4, 1), timing(1, 2)] })
    const projection = projectChampionship(champ, snap)

    expect(projection.live).toBe(false)
    expect(projection.drivers.every((d) => d.racePoints === 0)).toBe(true)
    expect(projection.drivers[0].projectedPoints).toBe(100)
  })

  it('flags a clinched title when no one can catch the leader', () => {
    const champ = championship({
      remainingRounds: 0, remainingSprints: 0,
      driverStandings: [
        driverStanding({ familyName: 'Verstappen', permanentNumber: 1, position: 1, points: 300 }),
        driverStanding({ familyName: 'Norris', permanentNumber: 4, position: 2, points: 250 })
      ]
    })
    // Final round, Verstappen wins → uncatchable.
    const snap = snapshot({ drivers, timing: [timing(1, 1), timing(4, 2)] })
    const projection = projectChampionship(champ, snap)
    expect(projection.leaderClinched).toBe(true)
  })

  it('marks a driver eliminated when their ceiling is below the leader', () => {
    const champ = championship({
      remainingRounds: 1, remainingSprints: 0,
      driverStandings: [
        driverStanding({ familyName: 'Verstappen', permanentNumber: 1, position: 1, points: 300 }),
        driverStanding({ familyName: 'Norris', permanentNumber: 4, position: 2, points: 290 }),
        driverStanding({ familyName: 'Leclerc', permanentNumber: 16, position: 3, points: 200 })
      ]
    })
    const snap = snapshot({ drivers, timing: [timing(1, 1), timing(4, 2), timing(16, 3)] })
    const projection = projectChampionship(champ, snap)

    // maxRemaining = 25. Leader (VER) projected 325.
    expect(projection.maxRemaining).toBe(25)
    const nor = projection.drivers.find((d) => d.code === 'NOR')!
    const lec = projection.drivers.find((d) => d.code === 'LEC')!
    expect(nor.status).toBe('alive') // 308 + 25 = 333 ≥ 325
    expect(lec.status).toBe('eliminated') // 215 + 25 = 240 < 325
    expect(projection.leaderClinched).toBe(false)
  })

  it('projects constructor points by summing each team\'s drivers', () => {
    const champ = championship({
      driverStandings: [
        driverStanding({ familyName: 'Verstappen', permanentNumber: 1, position: 1, points: 100, constructorName: 'Red Bull' }),
        driverStanding({ familyName: 'Norris', permanentNumber: 4, position: 2, points: 95, constructorName: 'McLaren' })
      ],
      constructorStandings: [
        { constructorId: 'mclaren', name: 'McLaren', position: 1, points: 300, wins: 5 },
        { constructorId: 'red_bull', name: 'Red Bull', position: 2, points: 260, wins: 3 }
      ]
    })
    const snap = snapshot({ drivers, timing: [timing(4, 1), timing(1, 2)] })
    const projection = projectChampionship(champ, snap)

    const mclaren = projection.constructors.find((c) => c.name === 'McLaren')!
    const redbull = projection.constructors.find((c) => c.name === 'Red Bull')!
    expect(mclaren.racePoints).toBe(25)
    expect(mclaren.projectedPoints).toBe(325)
    expect(redbull.racePoints).toBe(18)
    expect(redbull.projectedPoints).toBe(278)
  })

  it('returns a not-ok projection without a championship', () => {
    expect(projectChampionship(null, snapshot({ drivers })).ok).toBe(false)
  })
})
