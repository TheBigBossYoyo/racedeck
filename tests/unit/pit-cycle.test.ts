import { describe, expect, it } from 'vitest'
import { StrategyEngine, planRemainingStrategy } from '@renderer/core/engines/StrategyEngine'
import { WinProbabilityEngine } from '@renderer/core/engines/WinProbabilityEngine'
import type { RaceSnapshot } from '@renderer/core/providers/types'
import type { Driver, LapSample, SectorTime, Stint, TimingEntry, TrackStatus, TyreCompound } from '@shared/models'

const NO_SECTOR: SectorTime = { seconds: null, state: 'none' }

type DriverFixture = {
  readonly number: number
  readonly code: string
  readonly position: number
  readonly gapToLeader: number
  readonly intervalAhead?: number | null
  readonly compound: TyreCompound
  readonly stintAge: number
  readonly pitStops: number | null
  readonly recentPace?: number | null
  readonly recentPaceSampleCount?: number
  readonly laps?: readonly number[]
  readonly stints?: readonly {
    compound: TyreCompound
    lapStart: number
    lapEnd: number | null
    ageAtStart?: number
  }[]
  readonly inPit?: boolean
  readonly retired?: boolean
  readonly status?: TimingEntry['status']
}

function buildSnapshot(
  fixtures: readonly DriverFixture[],
  opts: {
    readonly currentLap?: number
    readonly totalLaps?: number
    readonly trackStatus?: TrackStatus
    readonly weather?: RaceSnapshot['weather']
    readonly sessionType?: RaceSnapshot['session']['type']
    readonly year?: number
    readonly meetingName?: string
    readonly circuitName?: string
  } = {}
): RaceSnapshot {
  const currentLap = opts.currentLap ?? 43
  const totalLaps = opts.totalLaps ?? 72
  const sorted = [...fixtures].sort((a, b) => a.position - b.position)
  const drivers: Driver[] = sorted.map((fixture) => ({
    number: fixture.number,
    code: fixture.code,
    firstName: null,
    lastName: null,
    fullName: fixture.code,
    broadcastName: null,
    teamName: `${fixture.code} Team`,
    teamColour: null,
    headshotUrl: null,
    countryCode: null
  }))
  const timing: TimingEntry[] = sorted.map((fixture, index) => ({
    driverNumber: fixture.number,
    position: fixture.position,
    gapToLeader: index === 0 ? 0 : fixture.gapToLeader,
    intervalAhead:
      index === 0
        ? null
        : fixture.intervalAhead ?? fixture.gapToLeader - sorted[index - 1].gapToLeader,
    lastLap: fixture.recentPace ?? fixture.laps?.[fixture.laps.length - 1] ?? 91,
    bestLap: fixture.recentPace ?? fixture.laps?.[0] ?? 90.8,
    lapNumber: currentLap,
    stintAge: fixture.stintAge,
    lapsThisStint: fixture.stintAge,
    compound: fixture.compound,
    sector1: NO_SECTOR,
    sector2: NO_SECTOR,
    sector3: NO_SECTOR,
    status:
      fixture.status ?? (fixture.inPit ? 'IN_PIT' : fixture.retired ? 'RETIRED' : 'RUNNING'),
    inPit: fixture.inPit ?? false,
    pitStops: fixture.pitStops,
    isFastestLap: false,
    isPersonalBestLap: false,
    penalty: null,
    underInvestigation: false,
    retired: fixture.retired ?? false,
    energyPct: 60,
    deployMode: 'BALANCED'
  }))
  const laps: LapSample[] = sorted.flatMap((fixture) => {
    const times =
      fixture.laps ??
      (fixture.recentPace == null
        ? []
        : Array.from({ length: fixture.recentPaceSampleCount ?? 5 }, () => fixture.recentPace))
    return times.map((lapTime, index) => ({
      driverNumber: fixture.number,
      lapNumber: currentLap - times.length + index + 1,
      lapTime,
      sector1: null,
      sector2: null,
      sector3: null,
      speedI1: null,
      speedI2: null,
      speedST: null,
      isPitOutLap: false,
      isPitInLap: false,
      compound: fixture.compound,
      dateStart: null,
      sessionTime: (currentLap - times.length + index + 1) * 90
    }))
  })
  const stints: Stint[] = sorted.flatMap((fixture) => {
    const visibleStints =
      fixture.stints ?? [
        {
          compound: fixture.compound,
          lapStart: Math.max(1, currentLap - Math.max(1, fixture.stintAge) + 1),
          lapEnd: null,
          ageAtStart: 0
        }
      ]
    return visibleStints.map((stint, index) => ({
      driverNumber: fixture.number,
      stintNumber: index + 1,
      lapStart: stint.lapStart,
      lapEnd: stint.lapEnd,
      tyre: { compound: stint.compound, ageAtStart: stint.ageAtStart ?? 0, isNew: (stint.ageAtStart ?? 0) === 0 },
      degradationPerLap: null
    }))
  })

  return {
    session: {
      id: 'pit-cycle',
      meetingId: null,
      name: opts.sessionType === 'sprint' ? 'Sprint' : 'Race',
      type: opts.sessionType ?? 'race',
      meetingName: opts.meetingName ?? 'Dutch Grand Prix',
      circuitName: opts.circuitName ?? 'Zandvoort',
      circuitShortName: null,
      countryName: null,
      countryCode: null,
      location: null,
      dateStart: `${opts.year ?? 2026}-08-30T13:00:00Z`,
      dateEnd: null,
      gmtOffset: null,
      year: opts.year ?? 2026,
      totalLaps,
      provider: 'test'
    },
    drivers,
    timing,
    laps,
    stints,
    raceControl: [],
    weather: opts.weather ?? null,
    weatherHistory: opts.weather == null ? [] : [opts.weather],
    positions: [],
    availability: {
      timing: true,
      laps: true,
      stints: true,
      intervals: true,
      raceControl: true,
      weather: opts.weather != null,
      positions: false,
      positionProgress: true,
      telemetry: false,
      live: false
    },
    clock: currentLap * 90,
    currentLap,
    totalLaps,
    trackStatus: opts.trackStatus ?? 'CLEAR'
  }
}

function lapsByDriver(snapshot: RaceSnapshot, driverNumber: number): LapSample[] {
  return snapshot.laps.filter((lap) => lap.driverNumber === driverNumber)
}

function chanceFor(model: ReturnType<typeof WinProbabilityEngine.compute>, code: string) {
  return model.chances.find((chance) => chance.code === code)
}

function hasDegradationInsight(snapshot: RaceSnapshot, driverNumber: number): boolean {
  return StrategyEngine.generateInsights(snapshot, (number) => lapsByDriver(snapshot, number), [driverNumber]).some(
    (insight) => insight.kind === 'degradation' && insight.driverNumbers.includes(driverNumber)
  )
}

describe('pit-cycle model integration', () => {
  it('infers a served dry-race stop from visible stints when timing pitStops is absent', () => {
    const snapshot = buildSnapshot([
      {
        number: 4,
        code: 'NOR',
        position: 1,
        gapToLeader: 0,
        compound: 'MEDIUM',
        stintAge: 22,
        pitStops: 0,
        recentPace: 90.6,
        stints: [{ compound: 'MEDIUM', lapStart: 1, lapEnd: null }]
      },
      {
        number: 12,
        code: 'ANT',
        position: 2,
        gapToLeader: 20.8,
        compound: 'HARD',
        stintAge: 2,
        pitStops: null,
        recentPace: 90.7,
        stints: [
          { compound: 'MEDIUM', lapStart: 1, lapEnd: 41 },
          { compound: 'HARD', lapStart: 42, lapEnd: null }
        ]
      }
    ])

    const plan = planRemainingStrategy(snapshot, 12)
    expect(plan.available).toBe(true)
    expect(plan.minimumTotalStops).toBe(1)
    expect(plan.minimumRemainingStops).toBe(0)
  })

  it('keeps one more required stop when a driver has repeated the same dry compound', () => {
    const snapshot = buildSnapshot([
      {
        number: 4,
        code: 'NOR',
        position: 1,
        gapToLeader: 0,
        compound: 'MEDIUM',
        stintAge: 22,
        pitStops: 0,
        recentPace: 90.6,
        stints: [{ compound: 'MEDIUM', lapStart: 1, lapEnd: null }]
      },
      {
        number: 1,
        code: 'VER',
        position: 2,
        gapToLeader: 5.4,
        compound: 'HARD',
        stintAge: 23,
        pitStops: 1,
        recentPace: 90.8,
        stints: [
          { compound: 'HARD', lapStart: 1, lapEnd: 20 },
          { compound: 'HARD', lapStart: 21, lapEnd: null }
        ]
      }
    ])

    const plan = planRemainingStrategy(snapshot, 1)
    expect(plan.available).toBe(true)
    expect(plan.minimumRemainingStops).toBe(1)
    expect(plan.recommended?.stops).toBeGreaterThanOrEqual(1)
  })

  it('makes unmatched stop debt visible in win probability and removes it once served', () => {
    const owed = buildSnapshot([
      { number: 4, code: 'NOR', position: 1, gapToLeader: 0, compound: 'MEDIUM', stintAge: 22, pitStops: 0, recentPace: 90.7 },
      { number: 81, code: 'PIA', position: 2, gapToLeader: 2.1, compound: 'HARD', stintAge: 16, pitStops: 0, recentPace: 90.7 },
      { number: 1, code: 'VER', position: 3, gapToLeader: 3.8, compound: 'HARD', stintAge: 14, pitStops: 0, recentPace: 90.7 },
      {
        number: 12,
        code: 'ANT',
        position: 4,
        gapToLeader: 6.4,
        compound: 'HARD',
        stintAge: 2,
        pitStops: null,
        recentPace: 90.7,
        stints: [
          { compound: 'MEDIUM', lapStart: 1, lapEnd: 41 },
          { compound: 'HARD', lapStart: 42, lapEnd: null }
        ]
      }
    ])
    const served = buildSnapshot([
      {
        number: 4,
        code: 'NOR',
        position: 1,
        gapToLeader: 0,
        compound: 'HARD',
        stintAge: 2,
        pitStops: 1,
        recentPace: 90.7,
        stints: [
          { compound: 'MEDIUM', lapStart: 1, lapEnd: 41 },
          { compound: 'HARD', lapStart: 42, lapEnd: null }
        ]
      },
      { number: 81, code: 'PIA', position: 2, gapToLeader: 2.1, compound: 'HARD', stintAge: 16, pitStops: 0, recentPace: 90.7 },
      { number: 1, code: 'VER', position: 3, gapToLeader: 3.8, compound: 'HARD', stintAge: 14, pitStops: 0, recentPace: 90.7 },
      {
        number: 12,
        code: 'ANT',
        position: 4,
        gapToLeader: 6.4,
        compound: 'HARD',
        stintAge: 2,
        pitStops: null,
        recentPace: 90.7,
        stints: [
          { compound: 'MEDIUM', lapStart: 1, lapEnd: 41 },
          { compound: 'HARD', lapStart: 42, lapEnd: null }
        ]
      }
    ])

    const owedModel = WinProbabilityEngine.compute(owed)
    const servedModel = WinProbabilityEngine.compute(served)
    const owedTopTwo = owedModel.chances.slice(0, 2).map((chance) => chance.code)
    const antOwed = chanceFor(owedModel, 'ANT')
    const norOwed = chanceFor(owedModel, 'NOR')
    const antServed = chanceFor(servedModel, 'ANT')

    expect(owedTopTwo).toContain('NOR')
    expect(owedTopTwo).toContain('ANT')
    expect(antOwed?.winPct).toBeGreaterThan(5)
    expect(norOwed?.factors.join(' ')).toMatch(/required stop/i)
    expect(antOwed?.factors.join(' ')).toMatch(/served/i)
    expect(servedModel.chances[0]?.code).toBe('NOR')
    expect(antServed?.winPct).toBeLessThan(antOwed?.winPct ?? Number.POSITIVE_INFINITY)
  })

  it('cancels equal stop debt for everyone while still naming the shared requirement', () => {
    const allOweOne = buildSnapshot([
      { number: 4, code: 'NOR', position: 1, gapToLeader: 0, compound: 'MEDIUM', stintAge: 22, pitStops: 0, recentPace: 90.7 },
      { number: 81, code: 'PIA', position: 2, gapToLeader: 2.1, compound: 'HARD', stintAge: 16, pitStops: 0, recentPace: 90.7 },
      { number: 1, code: 'VER', position: 3, gapToLeader: 3.8, compound: 'HARD', stintAge: 14, pitStops: 0, recentPace: 90.7 },
      { number: 12, code: 'ANT', position: 4, gapToLeader: 6.4, compound: 'MEDIUM', stintAge: 20, pitStops: 0, recentPace: 90.7 }
    ])
    const allServed = buildSnapshot([
      {
        number: 4,
        code: 'NOR',
        position: 1,
        gapToLeader: 0,
        compound: 'MEDIUM',
        stintAge: 22,
        pitStops: 1,
        recentPace: 90.7,
        stints: [{ compound: 'HARD', lapStart: 1, lapEnd: 20 }, { compound: 'MEDIUM', lapStart: 21, lapEnd: null }]
      },
      {
        number: 81,
        code: 'PIA',
        position: 2,
        gapToLeader: 2.1,
        compound: 'HARD',
        stintAge: 16,
        pitStops: 1,
        recentPace: 90.7,
        stints: [{ compound: 'MEDIUM', lapStart: 1, lapEnd: 26 }, { compound: 'HARD', lapStart: 27, lapEnd: null }]
      },
      {
        number: 1,
        code: 'VER',
        position: 3,
        gapToLeader: 3.8,
        compound: 'HARD',
        stintAge: 14,
        pitStops: 1,
        recentPace: 90.7,
        stints: [{ compound: 'MEDIUM', lapStart: 1, lapEnd: 28 }, { compound: 'HARD', lapStart: 29, lapEnd: null }]
      },
      {
        number: 12,
        code: 'ANT',
        position: 4,
        gapToLeader: 6.4,
        compound: 'MEDIUM',
        stintAge: 20,
        pitStops: 1,
        recentPace: 90.7,
        stints: [{ compound: 'HARD', lapStart: 1, lapEnd: 22 }, { compound: 'MEDIUM', lapStart: 23, lapEnd: null }]
      }
    ])

    const oweModel = WinProbabilityEngine.compute(allOweOne)
    const servedModel = WinProbabilityEngine.compute(allServed)

    for (const code of ['NOR', 'PIA', 'VER', 'ANT']) {
      expect(chanceFor(oweModel, code)?.winPct).toBeCloseTo(chanceFor(servedModel, code)?.winPct ?? 0, 6)
    }
    expect(chanceFor(oweModel, 'NOR')?.factors.join(' ')).toMatch(/required stop/i)
    expect(chanceFor(servedModel, 'NOR')?.factors.join(' ')).toMatch(/served/i)
  })

  it('returns a cycle position and a box call when the current leader still owes the stop', () => {
    const snapshot = buildSnapshot([
      { number: 4, code: 'NOR', position: 1, gapToLeader: 0, compound: 'MEDIUM', stintAge: 22, pitStops: 0, recentPace: 90.8 },
      {
        number: 81,
        code: 'PIA',
        position: 2,
        gapToLeader: 2.5,
        compound: 'HARD',
        stintAge: 16,
        pitStops: 1,
        recentPace: 90.9,
        stints: [
          { compound: 'MEDIUM', lapStart: 1, lapEnd: 26 },
          { compound: 'HARD', lapStart: 27, lapEnd: null }
        ]
      },
      {
        number: 12,
        code: 'ANT',
        position: 3,
        gapToLeader: 20.8,
        compound: 'HARD',
        stintAge: 2,
        pitStops: null,
        recentPace: 90.7,
        stints: [
          { compound: 'MEDIUM', lapStart: 1, lapEnd: 41 },
          { compound: 'HARD', lapStart: 42, lapEnd: null }
        ]
      },
      { number: 1, code: 'VER', position: 4, gapToLeader: 24.0, compound: 'HARD', stintAge: 14, pitStops: 0, recentPace: 91.0 }
    ])

    const prediction = StrategyEngine.predictPitStop(snapshot, 4, lapsByDriver(snapshot, 4), 21.5)

    expect(prediction).toMatchObject({
      available: true,
      projectedPosition: 3,
      requiredStopsRemaining: 1,
      cycleAdjustedPosition: 3,
      positionsLostVsCycle: 0
    })
    expect(['BOX NOW', 'BOX SOON']).toContain(prediction.verdict)
  })

  it('does not make the final legal stop optional just because the recovery-lap guard is late', () => {
    const snapshot = buildSnapshot(
      [
        { number: 4, code: 'NOR', position: 1, gapToLeader: 0, compound: 'MEDIUM', stintAge: 25, pitStops: 0, recentPace: 90.8 },
        { number: 81, code: 'PIA', position: 2, gapToLeader: 6.0, compound: 'HARD', stintAge: 12, pitStops: 0, recentPace: 90.9 },
        { number: 12, code: 'ANT', position: 3, gapToLeader: 18.0, compound: 'HARD', stintAge: 4, pitStops: 1, recentPace: 90.7, stints: [{ compound: 'MEDIUM', lapStart: 1, lapEnd: 63 }, { compound: 'HARD', lapStart: 64, lapEnd: null }] },
        { number: 1, code: 'VER', position: 4, gapToLeader: 25.0, compound: 'HARD', stintAge: 14, pitStops: 0, recentPace: 91.0 }
      ],
      { currentLap: 68, totalLaps: 72 }
    )

    const prediction = StrategyEngine.predictPitStop(snapshot, 4, lapsByDriver(snapshot, 4), 21.5)
    expect(['BOX NOW', 'BOX SOON']).toContain(prediction.verdict)
  })

  it('suppresses degradation in close traffic but restores it once the blocker is not a running adjacent car', () => {
    const hamLaps = [90.0, 90.2, 90.5, 90.9, 91.4, 92.0]
    const closeTraffic = buildSnapshot([
      { number: 16, code: 'LEC', position: 1, gapToLeader: 0, compound: 'MEDIUM', stintAge: 18, pitStops: 1, recentPace: 90.8 },
      {
        number: 44,
        code: 'HAM',
        position: 2,
        gapToLeader: 1.6,
        intervalAhead: 1.6,
        compound: 'MEDIUM',
        stintAge: 18,
        pitStops: 1,
        laps: hamLaps
      },
      { number: 55, code: 'SAI', position: 3, gapToLeader: 8.0, compound: 'HARD', stintAge: 12, pitStops: 1, recentPace: 91.4 }
    ])
    const openGap = buildSnapshot([
      { number: 16, code: 'LEC', position: 1, gapToLeader: 0, compound: 'MEDIUM', stintAge: 18, pitStops: 1, recentPace: 90.8 },
      {
        number: 44,
        code: 'HAM',
        position: 2,
        gapToLeader: 1.61,
        intervalAhead: 1.61,
        compound: 'MEDIUM',
        stintAge: 18,
        pitStops: 1,
        laps: hamLaps
      },
      { number: 55, code: 'SAI', position: 3, gapToLeader: 8.0, compound: 'HARD', stintAge: 12, pitStops: 1, recentPace: 91.4 }
    ])
    const aheadInPit = buildSnapshot([
      { number: 16, code: 'LEC', position: 1, gapToLeader: 0, compound: 'MEDIUM', stintAge: 18, pitStops: 1, recentPace: 90.8, inPit: true },
      {
        number: 44,
        code: 'HAM',
        position: 2,
        gapToLeader: 1.2,
        intervalAhead: 1.2,
        compound: 'MEDIUM',
        stintAge: 18,
        pitStops: 1,
        laps: hamLaps
      },
      { number: 55, code: 'SAI', position: 3, gapToLeader: 8.0, compound: 'HARD', stintAge: 12, pitStops: 1, recentPace: 91.4 }
    ])

    expect(StrategyEngine.predictPitStop(closeTraffic, 44, lapsByDriver(closeTraffic, 44), 21.5).degradationSlope).toBeNull()
    expect(hasDegradationInsight(closeTraffic, 44)).toBe(false)
    expect(StrategyEngine.predictPitStop(openGap, 44, lapsByDriver(openGap, 44), 21.5).degradationSlope).toBeGreaterThan(0.12)
    expect(hasDegradationInsight(openGap, 44)).toBe(true)
    expect(StrategyEngine.predictPitStop(aheadInPit, 44, lapsByDriver(aheadInPit, 44), 21.5).degradationSlope).toBeGreaterThan(0.12)
    expect(hasDegradationInsight(aheadInPit, 44)).toBe(true)
  })

  it('strongly discounts pace contaminated by close traffic in win probability', () => {
    const closeTraffic = buildSnapshot([
      { number: 16, code: 'LEC', position: 1, gapToLeader: 0, compound: 'MEDIUM', stintAge: 14, pitStops: 1, recentPace: 91.0 },
      { number: 44, code: 'HAM', position: 2, gapToLeader: 1.5, intervalAhead: 1.5, compound: 'SOFT', stintAge: 4, pitStops: 1, recentPace: 90.1 },
      { number: 55, code: 'SAI', position: 3, gapToLeader: 7.2, compound: 'HARD', stintAge: 12, pitStops: 1, recentPace: 91.2 },
      { number: 63, code: 'RUS', position: 4, gapToLeader: 10.5, compound: 'HARD', stintAge: 14, pitStops: 1, recentPace: 91.3 }
    ], { currentLap: 38, totalLaps: 60 })
    const openGap = buildSnapshot([
      { number: 16, code: 'LEC', position: 1, gapToLeader: 0, compound: 'MEDIUM', stintAge: 14, pitStops: 1, recentPace: 91.0 },
      { number: 44, code: 'HAM', position: 2, gapToLeader: 1.61, intervalAhead: 1.61, compound: 'SOFT', stintAge: 4, pitStops: 1, recentPace: 90.1 },
      { number: 55, code: 'SAI', position: 3, gapToLeader: 7.2, compound: 'HARD', stintAge: 12, pitStops: 1, recentPace: 91.2 },
      { number: 63, code: 'RUS', position: 4, gapToLeader: 10.5, compound: 'HARD', stintAge: 14, pitStops: 1, recentPace: 91.3 }
    ], { currentLap: 38, totalLaps: 60 })
    const aheadInPit = buildSnapshot([
      { number: 16, code: 'LEC', position: 1, gapToLeader: 0, compound: 'MEDIUM', stintAge: 14, pitStops: 1, recentPace: 91.0, inPit: true },
      { number: 44, code: 'HAM', position: 2, gapToLeader: 1.0, intervalAhead: 1.0, compound: 'SOFT', stintAge: 4, pitStops: 1, recentPace: 90.1 },
      { number: 55, code: 'SAI', position: 3, gapToLeader: 7.2, compound: 'HARD', stintAge: 12, pitStops: 1, recentPace: 91.2 },
      { number: 63, code: 'RUS', position: 4, gapToLeader: 10.5, compound: 'HARD', stintAge: 14, pitStops: 1, recentPace: 91.3 }
    ], { currentLap: 38, totalLaps: 60 })

    const hamInTraffic = chanceFor(WinProbabilityEngine.compute(closeTraffic), 'HAM')
    const hamOpenGap = chanceFor(WinProbabilityEngine.compute(openGap), 'HAM')
    const hamAheadInPit = chanceFor(WinProbabilityEngine.compute(aheadInPit), 'HAM')

    expect(hamOpenGap?.winPct).toBeGreaterThan((hamInTraffic?.winPct ?? 0) + 5)
    expect(hamAheadInPit?.winPct).toBeGreaterThan((hamInTraffic?.winPct ?? 0) + 5)
    expect(hamInTraffic?.factors.join(' ')).toMatch(/traffic/i)
  })
})
