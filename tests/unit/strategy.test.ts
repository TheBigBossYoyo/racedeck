import { describe, it, expect } from 'vitest'
import {
  StrategyEngine,
  analysePitLane,
  servedTimePenalties
} from '@renderer/core/engines/StrategyEngine'
import type { RaceSnapshot } from '@renderer/core/providers/types'
import type {
  Driver,
  LapSample,
  TimingEntry,
  TrackStatus,
  SectorTime
} from '@shared/models'

// ── Tiny snapshot builder for precise, deterministic assertions ────────────────

const NO_SECTOR: SectorTime = { seconds: null, state: 'none' }

function te(
  driverNumber: number,
  position: number,
  gapToLeader: number | '+1 LAP' | null,
  opts: Partial<Pick<TimingEntry, 'lapNumber' | 'stintAge' | 'compound'>> = {}
): TimingEntry {
  return {
    driverNumber,
    position,
    gapToLeader,
    intervalAhead: null,
    lastLap: 92,
    bestLap: 91,
    lapNumber: opts.lapNumber ?? 30,
    stintAge: opts.stintAge ?? 14,
    compound: opts.compound ?? 'MEDIUM',
    sector1: NO_SECTOR,
    sector2: NO_SECTOR,
    sector3: NO_SECTOR,
    status: 'RUNNING',
    inPit: false,
    pitStops: 1,
    isFastestLap: false,
    isPersonalBestLap: false,
    penalty: null,
    underInvestigation: false,
    retired: false,
    energyPct: 60,
    deployMode: 'BALANCED'
  }
}

function makeSnapshot(
  gaps: number[],
  trackStatus: TrackStatus = 'CLEAR',
  opts: {
    clock?: number
    currentLap?: number
    totalLaps?: number
    lapNumber?: number
    stintAge?: number
    compound?: TimingEntry['compound']
  } = {}
): RaceSnapshot {
  const currentLap = opts.currentLap ?? 30
  const lapNumber = opts.lapNumber ?? currentLap
  const drivers: Driver[] = gaps.map((_, i) => ({
    number: i + 1,
    code: `D${i + 1}`,
    firstName: null,
    lastName: null,
    fullName: `Driver ${i + 1}`,
    broadcastName: null,
    teamName: `Team ${Math.floor(i / 2) + 1}`,
    teamColour: null,
    headshotUrl: null,
    countryCode: null
  }))
  const timing = gaps.map((g, i) =>
    te(i + 1, i + 1, i === 0 ? 0 : g, {
      lapNumber,
      stintAge: opts.stintAge,
      compound: opts.compound
    })
  )
  return {
    session: {
      id: 's',
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
      totalLaps: opts.totalLaps ?? 57,
      provider: 'test'
    },
    drivers,
    timing,
    laps: [],
    stints: [],
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
    clock: opts.clock ?? 1800,
    currentLap,
    totalLaps: opts.totalLaps ?? 57,
    trackStatus
  }
}

// Increasing lap times → clear positive degradation slope.
function degradingLaps(n = 6, start = 90, step = 0.3): LapSample[] {
  return Array.from({ length: n }, (_, i) => ({
    driverNumber: 2,
    lapNumber: i + 1,
    lapTime: start + i * step,
    sector1: null,
    sector2: null,
    sector3: null,
    speedI1: null,
    speedI2: null,
    speedST: null,
    isPitOutLap: false,
    isPitInLap: false,
    compound: 'MEDIUM',
    dateStart: null
  }))
}

function timedLaps(times: number[], sessionTimes: number[]): LapSample[] {
  return times.map((lapTime, i) => ({
    driverNumber: 2,
    lapNumber: i + 1,
    lapTime,
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
    sessionTime: sessionTimes[i]
  }))
}

describe('StrategyEngine.undercutDelta', () => {
  it('is viable inside DRS range and short outside it', () => {
    expect(StrategyEngine.undercutDelta(1)).toBeGreaterThan(0) // 0.85*1.6 - 1 ≈ 0.36
    expect(StrategyEngine.undercutDelta(2)).toBeLessThan(0) // 1.36 - 2 < 0
  })
})

describe('StrategyEngine.pitLossFor', () => {
  it('discounts the pit loss under neutralization', () => {
    const green = makeSnapshot([0, 2], 'CLEAR')
    const sc = makeSnapshot([0, 2], 'SAFETY_CAR')
    expect(StrategyEngine.pitLossFor(green)).toBeCloseTo(21.5, 5)
    expect(StrategyEngine.pitLossFor(sc)).toBeCloseTo(10.75, 5)
  })
})

describe('StrategyEngine.degradationTrend', () => {
  it('detects a rising slope and needs ≥3 clean laps', () => {
    expect(StrategyEngine.degradationTrend(degradingLaps())).toBeCloseTo(0.3, 5)
    expect(StrategyEngine.degradationTrend(degradingLaps(2))).toBeNull()
  })
})

describe('StrategyEngine.predictPitStop', () => {
  it('projects the rejoin position, positions lost and rejoin neighbours', () => {
    // Gaps to leader: P1=0, P2=2, P3=5, P4=25, P5=28, P6=40
    const snap = makeSnapshot([0, 2, 5, 25, 28, 40])
    const p = StrategyEngine.predictPitStop(snap, 2, [], 21.5)

    expect(p.available).toBe(true)
    expect(p.currentPosition).toBe(2)
    expect(p.pitLossSec).toBeCloseTo(21.5, 5)
    // rejoin gap = 2 + 21.5 = 23.5 → cars ahead: P1(0), P3(5) → rejoin P3
    expect(p.rejoinGapToLeaderSec).toBeCloseTo(23.5, 5)
    expect(p.projectedPosition).toBe(3)
    expect(p.positionsLost).toBe(1)
    expect(p.rejoinAhead?.driverNumber).toBe(3)
    expect(p.rejoinBehind?.driverNumber).toBe(4)
    expect(p.gapToChaseAheadSec).toBeCloseTo(18.5, 5)
    expect(p.clearAirBehindSec).toBeCloseTo(1.5, 5)
  })

  it('flags a cheap stop under Safety Car with a BOX NOW verdict', () => {
    const snap = makeSnapshot([0, 2, 5, 25, 28, 40], 'SAFETY_CAR')
    const p = StrategyEngine.predictPitStop(snap, 3, [], 21.5)
    expect(p.underNeutralization).toBe(true)
    expect(p.pitLossSec).toBeCloseTo(10.75, 5)
    expect(p.verdict).toBe('BOX NOW')
    expect(p.confidence).toBe('high')
  })

  it('does not tell the whole field to pit on fresh lap-one tyres under VSC', () => {
    const snap = makeSnapshot([0, 1, 2.2, 3.4], 'VSC')
    snap.currentLap = 1
    snap.timing = snap.timing.map((entry) => ({
      ...entry,
      lapNumber: 1,
      stintAge: 1,
      pitStops: 0
    }))
    const prediction = StrategyEngine.predictPitStop(snap, 2, [])
    expect(prediction.verdict).toBe('STAY OUT')
    expect(prediction.undercutViable).toBe(false)
    expect(prediction.rationale.join(' ')).toMatch(/too fresh|rejoin cost/i)
  })

  it('returns an unavailable projection when the driver has no numeric gap', () => {
    const snap = makeSnapshot([0, 2, 5])
    // A lapped car (gap '+1 LAP') can't be projected on the road.
    snap.timing[2].gapToLeader = '+1 LAP'
    const p = StrategyEngine.predictPitStop(snap, 3, [], 21.5)
    expect(p.available).toBe(false)
    expect(p.reason).toBeTruthy()
  })

  it('recommends BOX NOW on heavy degradation with an acceptable rejoin cost', () => {
    const snap = makeSnapshot([0, 2, 5, 25])
    // slope ~0.5s/lap → above the 0.2 heavy threshold.
    const p = StrategyEngine.predictPitStop(snap, 2, degradingLaps(6, 90, 0.5), 21.5)
    expect(p.degradationSlope).toBeGreaterThan(0.2)
    expect(p.verdict).toBe('BOX NOW')
  })

  it('recommends BOX SOON on meaningful but non-critical degradation', () => {
    const snap = makeSnapshot([0, 2, 5, 25])
    const p = StrategyEngine.predictPitStop(snap, 2, degradingLaps(6, 90, 0.16), 21.5)
    expect(p.degradationSlope).toBeGreaterThanOrEqual(0.14)
    expect(p.degradationSlope).toBeLessThan(0.28)
    expect(p.verdict).toBe('BOX SOON')
  })

  it('recommends switching off dry tyres when rain is reported', () => {
    const snap = makeSnapshot([0, 2, 5, 25], 'CLEAR', { currentLap: 20, stintAge: 8, compound: 'MEDIUM' })
    snap.weather = {
      date: '2024-01-01T00:30:00Z',
      airTemp: 20,
      trackTemp: 25,
      humidity: 90,
      pressure: 1000,
      windSpeed: 2,
      windDirection: 180,
      rainfall: true
    }
    const p = StrategyEngine.predictPitStop(snap, 2, [])
    expect(p.verdict).toBe('BOX NOW')
    expect(p.rationale.join(' ')).toMatch(/rain|wet-weather/i)
  })

  it('stays out on lap one clear track even when bunching makes the raw undercut positive', () => {
    const snap = makeSnapshot([0, 0.45, 1.1, 9], 'CLEAR', { currentLap: 1, lapNumber: 1, stintAge: 1, clock: 80 })
    const p = StrategyEngine.predictPitStop(snap, 2, [], 21.5)

    expect(p.undercutNetSec).toBeGreaterThan(0)
    expect(p.verdict).toBe('STAY OUT')
    expect(p.rationale.join(' ')).toMatch(/too young|too fresh/i)
  })

  it('ignores future laps when estimating degradation in replay', () => {
    const snap = makeSnapshot([0, 2, 5, 25], 'CLEAR', { currentLap: 4, lapNumber: 4, stintAge: 4, clock: 359 })
    const replayLaps = timedLaps([90, 90, 90, 90, 95, 96], [80, 170, 260, 350, 440, 530])
    const p = StrategyEngine.predictPitStop(snap, 2, replayLaps, 21.5)

    expect(p.degradationSlope).toBeCloseTo(0, 5)
    expect(p.verdict).toBe('STAY OUT')
  })
})

describe('analysePitLane', () => {
  const stop = (driverNumber: number, duration: number, lap: number | null = 10) => ({
    driverNumber,
    duration,
    lap
  })
  /** A tight, realistic pit lane: median 25.0s, sub-second spread. */
  const clean = [
    stop(1, 24.6), stop(3, 24.9), stop(5, 25.0), stop(10, 25.1),
    stop(11, 25.3), stop(16, 24.8), stop(44, 25.2)
  ]

  it('reports the pit lane median from measured stops', () => {
    expect(analysePitLane(clean)?.medianSec).toBe(25.0)
  })

  it('needs a real sample before comparing anything', () => {
    expect(analysePitLane([stop(1, 24.6), stop(3, 40.0)])).toBeNull()
  })

  it('flags a genuinely slow stop and quantifies the loss', () => {
    const out = analysePitLane([...clean, stop(63, 38.4, 22)])
    expect(out?.slow).toHaveLength(1)
    expect(out?.slow[0]).toMatchObject({ driverNumber: 63, lap: 22 })
    // Median of the eight durations is 25.1s, so 38.4s is 13.3s adrift.
    expect(out?.slow[0].lostSec).toBeCloseTo(13.3, 1)
  })

  it('does not flag ordinary variation in a very consistent pit lane', () => {
    // Austria/Hungary run a MAD near 0.3s; without a floor, a 1s-slower stop
    // would clear a purely dispersion-scaled threshold and read as a failure.
    expect(analysePitLane([...clean, stop(63, 26.5)])?.slow).toHaveLength(0)
  })

  it('ignores red-flag stoppages, which park the whole field in the pit lane', () => {
    // The 2026 Monaco race records 16 transits near 2150s. Treated as stops they
    // would both dominate the statistics and produce a "+2133s slow stop".
    const redFlag = Array.from({ length: 8 }, (_, i) => stop(i + 20, 2150 + i))
    const out = analysePitLane([...clean, ...redFlag])
    expect(out?.sampleSize).toBe(clean.length)
    expect(out?.medianSec).toBe(25.0)
    expect(out?.slow).toHaveLength(0)
  })

  it('ignores a retirement that ends in the garage', () => {
    expect(analysePitLane([...clean, stop(87, 1081.5)])?.slow).toHaveLength(0)
  })

  it('deducts a time penalty served at the stop', () => {
    // A 10s penalty is served stationary in the box before work begins, so it
    // lands in the measured time and would otherwise read as a slow stop.
    const rc = [
      {
        id: 'p1', date: '', category: 'Other', flag: 'NONE', scope: null, sector: null,
        driverNumber: 27, lapNumber: 12, severity: 'info',
        message: 'FIA STEWARDS: 10 SECOND TIME PENALTY FOR CAR 27 (HUL) - CAUSING A COLLISION'
      }
    ] as unknown as Parameters<typeof analysePitLane>[1]
    const withPenalty = [...clean, stop(27, 35.0, 12)]
    expect(analysePitLane(withPenalty)?.slow).toHaveLength(1)
    expect(analysePitLane(withPenalty, rc)?.slow).toHaveLength(0)
  })

  it('still flags a slow stop that a penalty alone cannot explain', () => {
    const rc = [
      {
        id: 'p1', date: '', category: 'Other', flag: 'NONE', scope: null, sector: null,
        driverNumber: 27, lapNumber: 12, severity: 'info',
        message: 'FIA STEWARDS: 5 SECOND TIME PENALTY FOR CAR 27 (HUL) - SPEEDING IN THE PIT LANE'
      }
    ] as unknown as Parameters<typeof analysePitLane>[1]
    const out = analysePitLane([...clean, stop(27, 48.0, 12)], rc)
    expect(out?.slow).toHaveLength(1)
    expect(out?.slow[0].penaltySec).toBe(5)
    // 48.0s less the 5s penalty, against a 25.1s median.
    expect(out?.slow[0].lostSec).toBeCloseTo(17.9, 1)
  })
})

describe('servedTimePenalties', () => {
  it('parses the stewards message format', () => {
    const msgs = [
      { message: 'FIA STEWARDS: 5 SECOND TIME PENALTY FOR CAR 10 (GAS) - SPEEDING IN THE PIT LANE' },
      { message: 'FIA STEWARDS: 10 SECOND TIME PENALTY FOR CAR 27 (HUL) - CAUSING A COLLISION' },
      { message: 'CHEQUERED FLAG' }
    ] as unknown as Parameters<typeof servedTimePenalties>[0]
    const out = servedTimePenalties(msgs)
    expect(out.get(10)).toBe(5)
    expect(out.get(27)).toBe(10)
    expect(out.size).toBe(2)
  })

  it('keeps the largest penalty when a driver collects several', () => {
    const msgs = [
      { message: 'FIA STEWARDS: 5 SECOND TIME PENALTY FOR CAR 10 (GAS) - TRACK LIMITS' },
      { message: 'FIA STEWARDS: 10 SECOND TIME PENALTY FOR CAR 10 (GAS) - CAUSING A COLLISION' }
    ] as unknown as Parameters<typeof servedTimePenalties>[0]
    expect(servedTimePenalties(msgs).get(10)).toBe(10)
  })
})
