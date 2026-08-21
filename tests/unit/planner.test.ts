import { describe, it, expect } from 'vitest'
import { DemoProvider } from '@renderer/core/providers/DemoProvider'
import { planRemainingStrategy, paceComparison } from '@renderer/core/engines/StrategyEngine'
import { compoundModel, driverRecentPace } from '@renderer/core/engines/AnalyticsEngine'
import type { RaceSnapshot } from '@renderer/core/providers/types'
import type { Driver, LapSample, SectorTime, TimingEntry, TyreCompound } from '@shared/models'

const provider = new DemoProvider()
const midRace = provider.getSnapshotAt(provider.getDuration() * 0.45)
const lateRace = provider.getSnapshotAt(provider.getDuration() * 0.99)
const NO_SECTOR: SectorTime = { seconds: null, state: 'none' }

function leaderNumber(snap = midRace): number {
  return [...snap.timing].sort((a, b) => (a.position ?? 99) - (b.position ?? 99))[0].driverNumber
}

function openingDriver(number: number, code: string): Driver {
  return {
    number,
    code,
    firstName: null,
    lastName: null,
    fullName: code,
    broadcastName: null,
    teamName: `Team ${number}`,
    teamColour: null,
    headshotUrl: null,
    countryCode: null
  }
}

function openingTimingEntry(
  driverNumber: number,
  position: number,
  gapToLeader: number,
  currentLap: number,
  stintAge: number,
  compound: TyreCompound = 'SOFT'
): TimingEntry {
  return {
    driverNumber,
    position,
    gapToLeader,
    intervalAhead: position === 1 ? null : gapToLeader,
    lastLap: 90,
    bestLap: 89.8,
    lapNumber: currentLap,
    stintAge,
    compound,
    sector1: NO_SECTOR,
    sector2: NO_SECTOR,
    sector3: NO_SECTOR,
    status: 'RUNNING',
    inPit: false,
    pitStops: 0,
    isFastestLap: false,
    isPersonalBestLap: false,
    penalty: null,
    underInvestigation: false,
    retired: false,
    energyPct: 60,
    deployMode: 'BALANCED'
  }
}

function openingLap(
  driverNumber: number,
  lapNumber: number,
  lapTime: number,
  compound: TyreCompound,
  sessionTime: number
): LapSample {
  return {
    driverNumber,
    lapNumber,
    lapTime,
    sector1: null,
    sector2: null,
    sector3: null,
    speedI1: null,
    speedI2: null,
    speedST: null,
    isPitOutLap: false,
    isPitInLap: false,
    compound,
    dateStart: null,
    sessionTime
  }
}

function makeOpeningStintSnapshot(opts: { currentLap: number; stintAge: number; clock: number; laps: LapSample[] }): RaceSnapshot {
  const totalLaps = 20
  return {
    session: {
      id: 'opening-race',
      meetingId: null,
      name: 'Race',
      type: 'race',
      meetingName: 'Test GP',
      circuitName: 'Test',
      circuitShortName: null,
      countryName: null,
      countryCode: null,
      location: null,
      dateStart: '2024-01-01T00:00:00Z',
      dateEnd: null,
      gmtOffset: null,
      year: 2024,
      totalLaps,
      provider: 'test'
    },
    drivers: [openingDriver(1, 'D1'), openingDriver(2, 'D2')],
    timing: [
      openingTimingEntry(1, 1, 0, opts.currentLap, opts.stintAge),
      openingTimingEntry(2, 2, 2.2, opts.currentLap, opts.stintAge)
    ],
    laps: opts.laps,
    stints: [
      {
        driverNumber: 1,
        stintNumber: 1,
        lapStart: 1,
        lapEnd: null,
        tyre: { compound: 'SOFT', ageAtStart: 0, isNew: true },
        degradationPerLap: null
      },
      {
        driverNumber: 2,
        stintNumber: 1,
        lapStart: 1,
        lapEnd: null,
        tyre: { compound: 'SOFT', ageAtStart: 0, isNew: true },
        degradationPerLap: null
      }
    ],
    raceControl: [],
    weather: null,
    weatherHistory: [],
    positions: [],
    availability: {
      timing: true,
      laps: true,
      stints: true,
      intervals: true,
      raceControl: true,
      weather: false,
      positions: false,
      positionProgress: true,
      telemetry: false,
      live: false
    },
    clock: opts.clock,
    currentLap: opts.currentLap,
    totalLaps,
    trackStatus: 'CLEAR'
  }
}

describe('compoundModel', () => {
  it('models compounds with positive pace and non-negative degradation', () => {
    const model = compoundModel(midRace)
    expect(model.size).toBeGreaterThan(0)
    for (const [, m] of model) {
      expect(m.pace).toBeGreaterThan(0)
      expect(m.deg).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('planRemainingStrategy', () => {
  const plan = planRemainingStrategy(midRace, leaderNumber())

  it('produces a ranked plan whose recommended option is the best', () => {
    expect(plan.available).toBe(true)
    expect(plan.recommended).not.toBeNull()
    expect(plan.recommended!.deltaSec).toBeCloseTo(0, 5)
    // Alternatives are slower-or-equal and sorted.
    for (const alt of plan.alternatives) expect(alt.deltaSec).toBeGreaterThanOrEqual(0)
    const deltas = plan.alternatives.map((a) => a.deltaSec)
    expect(deltas).toEqual([...deltas].sort((a, b) => a - b))
  })

  it('covers exactly the remaining laps and respects the two-compound rule', () => {
    const rec = plan.recommended!
    const laps = rec.segments.reduce((a, s) => a + s.laps, 0)
    expect(laps).toBe(plan.lapsRemaining)
    expect(rec.usesTwoCompounds).toBe(true)
    // Pit laps fall inside the remaining window.
    for (const seg of rec.segments.slice(1)) {
      expect(seg.startLap).toBeGreaterThan(midRace.currentLap ?? 0)
      expect(seg.startLap).toBeLessThanOrEqual(midRace.totalLaps ?? 0)
    }
  })

  it('declines to plan when the race is almost over', () => {
    const p = planRemainingStrategy(lateRace, leaderNumber(lateRace))
    expect(p.available).toBe(false)
    expect(p.reason).toBeTruthy()
  })

  it('declines in wet conditions', () => {
    const wet = provider.getSnapshotAt(provider.getDuration() * 0.45)
    if (wet.weather) wet.weather = { ...wet.weather, rainfall: true }
    const p = planRemainingStrategy(wet, leaderNumber(wet))
    expect(p.available).toBe(false)
    expect(p.reason).toMatch(/[Ww]et/)
  })

  it('makes an opening-stint planner state explicit instead of using future laps', () => {
    const early = makeOpeningStintSnapshot({
      currentLap: 1,
      stintAge: 1,
      clock: 85,
      laps: [
        openingLap(1, 1, 90.2, 'SOFT', 80),
        openingLap(1, 2, 90.8, 'SOFT', 170),
        openingLap(1, 3, 91.4, 'SOFT', 260),
        openingLap(2, 1, 90.4, 'SOFT', 82),
        openingLap(2, 2, 91.1, 'SOFT', 172),
        openingLap(2, 3, 91.8, 'SOFT', 262)
      ]
    })
    const plan = planRemainingStrategy(early, 1)

    expect(plan.available).toBe(false)
    expect(plan.recommended).toBeNull()
    expect(plan.reason).toMatch(/opening stint|fresh/i)
  })

  it('does not generate an immediate stop on a fresh first stint', () => {
    const early = makeOpeningStintSnapshot({
      currentLap: 4,
      stintAge: 4,
      clock: 359,
      laps: [
        openingLap(1, 1, 90.1, 'SOFT', 80),
        openingLap(1, 2, 90.2, 'SOFT', 170),
        openingLap(1, 3, 90.3, 'SOFT', 260),
        openingLap(1, 4, 90.4, 'SOFT', 350),
        openingLap(2, 1, 90.5, 'SOFT', 82),
        openingLap(2, 2, 90.6, 'SOFT', 172),
        openingLap(2, 3, 90.7, 'SOFT', 262),
        openingLap(2, 4, 90.8, 'SOFT', 352)
      ]
    })
    const plan = planRemainingStrategy(early, 1)

    expect(plan.available).toBe(true)
    for (const option of [plan.recommended, ...plan.alternatives].filter((p): p is NonNullable<typeof plan.recommended> => p != null)) {
      if (option.stops === 0) continue
      expect(option.segments[1].startLap - 1).toBeGreaterThanOrEqual(8)
    }
  })

  it('excludes zero-stop plans until the normal dry-race compound rule is served', () => {
    const driver = leaderNumber()
    const entry = midRace.timing.find((timing) => timing.driverNumber === driver)!
    const dry = {
      ...midRace,
      timing: midRace.timing.map((timing) =>
        timing.driverNumber === driver ? { ...timing, pitStops: 0, stintAge: Math.max(8, timing.stintAge ?? 0) } : timing
      ),
      stints: [
        ...midRace.stints.filter((stint) => stint.driverNumber !== driver),
        {
          driverNumber: driver,
          stintNumber: 1,
          lapStart: 1,
          lapEnd: null,
          tyre: { compound: entry.compound ?? 'MEDIUM', ageAtStart: 0, isNew: true },
          degradationPerLap: null
        }
      ]
    } satisfies RaceSnapshot

    const result = planRemainingStrategy(dry, driver)
    expect(result.available).toBe(true)
    expect(result.minimumTotalStops).toBe(1)
    expect(result.minimumRemainingStops).toBe(1)
    expect(result.recommended!.stops).toBeGreaterThanOrEqual(1)
    expect(result.recommended!.usesTwoCompounds).toBe(true)
  })

  it('enforces Monaco 2025 two mandatory stops', () => {
    const driver = leaderNumber()
    const entry = midRace.timing.find((timing) => timing.driverNumber === driver)!
    const monaco = {
      ...midRace,
      session: {
        ...midRace.session,
        meetingName: 'Monaco Grand Prix',
        circuitName: 'Circuit de Monaco',
        year: 2025,
        dateStart: '2025-05-25T13:00:00Z'
      },
      timing: midRace.timing.map((timing) =>
        timing.driverNumber === driver ? { ...timing, pitStops: 0, stintAge: Math.max(8, timing.stintAge ?? 0) } : timing
      ),
      stints: [
        ...midRace.stints.filter((stint) => stint.driverNumber !== driver),
        {
          driverNumber: driver,
          stintNumber: 1,
          lapStart: 1,
          lapEnd: null,
          tyre: { compound: entry.compound ?? 'MEDIUM', ageAtStart: 0, isNew: true },
          degradationPerLap: null
        }
      ]
    } satisfies RaceSnapshot

    const result = planRemainingStrategy(monaco, driver)
    expect(result.available).toBe(true)
    expect(result.minimumTotalStops).toBe(2)
    expect(result.minimumRemainingStops).toBe(2)
    expect(result.ruleLabel).toMatch(/Monaco 2025/i)
    expect(result.recommended!.stops).toBe(2)
  })

  it('waives the normal dry-compound stop requirement after wet-weather tyre use', () => {
    const driver = leaderNumber()
    const current = midRace.timing.find((timing) => timing.driverNumber === driver)!
    const mixed = {
      ...midRace,
      timing: midRace.timing.map((timing) =>
        timing.driverNumber === driver ? { ...timing, pitStops: 1 } : timing
      ),
      stints: [
        ...midRace.stints.filter((stint) => stint.driverNumber !== driver),
        {
          driverNumber: driver,
          stintNumber: 1,
          lapStart: 1,
          lapEnd: 8,
          tyre: { compound: 'INTERMEDIATE' as const, ageAtStart: 0, isNew: true },
          degradationPerLap: null
        },
        {
          driverNumber: driver,
          stintNumber: 2,
          lapStart: 9,
          lapEnd: null,
          tyre: { compound: current.compound ?? 'MEDIUM', ageAtStart: 0, isNew: true },
          degradationPerLap: null
        }
      ]
    } satisfies RaceSnapshot

    const result = planRemainingStrategy(mixed, driver)
    expect(result.available).toBe(true)
    expect(result.minimumTotalStops).toBe(0)
    expect(result.minimumRemainingStops).toBe(0)
    expect(result.ruleLabel).toMatch(/waived/i)
  })
})

describe('paceComparison', () => {
  it('gives the leader no car ahead and the last runner no car behind', () => {
    const ordered = [...midRace.timing].sort((a, b) => (a.position ?? 99) - (b.position ?? 99))
    const leader = ordered[0].driverNumber
    const last = ordered[ordered.length - 1].driverNumber
    expect(paceComparison(midRace, leader).ahead).toBeNull()
    expect(paceComparison(midRace, last).behind).toBeNull()
  })

  it('sandwiches a midfield driver between two rivals with gaps', () => {
    const ordered = [...midRace.timing].sort((a, b) => (a.position ?? 99) - (b.position ?? 99))
    const mid = ordered[Math.floor(ordered.length / 2)].driverNumber
    const battle = paceComparison(midRace, mid)
    expect(battle.available).toBe(true)
    expect(battle.ahead).not.toBeNull()
    expect(battle.behind).not.toBeNull()
    expect(battle.driverPace).toBe(driverRecentPace(midRace, mid))
  })
})
