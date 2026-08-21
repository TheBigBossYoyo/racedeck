import { describe, it, expect } from 'vitest'
import {
  buildTimeline,
  inferRaceGreenStart,
  phaseAt,
  phaseLabel,
  qualifyingPhaseClockAt,
  type PhaseInput
} from '@renderer/core/engines/SessionPhaseEngine'
import type { TrackStatus } from '@shared/models'

/** A race whose feed spans 0..1000s: 200s of prep, green, SC 500-560, finish 900. */
function raceInput(): PhaseInput {
  const trackStatus: { t: number; status: TrackStatus }[] = [
    { t: 0, status: 'CLEAR' }, // pit/grid — still "clear" but pre-race
    { t: 500, status: 'SAFETY_CAR' },
    { t: 560, status: 'CLEAR' }
  ]
  const lapCount: { t: number; current: number | null; total: number | null }[] = []
  // Racing starts at 200s (lap 1), ~14s/lap, 52 laps.
  for (let lap = 1; lap <= 52; lap++) {
    lapCount.push({ t: 200 + (lap - 1) * 13.5, current: lap, total: 52 })
  }
  return { duration: 1000, type: 'race', trackStatus, lapCount, chequeredHint: 900 }
}

describe('buildTimeline — race', () => {
  const tl = buildTimeline(raceInput())

  it('detects green start from first lap under way (not pit-lane clear)', () => {
    expect(tl.greenStart).toBe(200)
  })

  it('uses the race-control chequered hint for the end', () => {
    expect(tl.chequered).toBe(900)
  })

  it('reads total laps from the lap-count series', () => {
    expect(tl.totalLaps).toBe(52)
  })

  it('brackets racing with a pre segment and a post segment', () => {
    const first = tl.segments[0]
    const last = tl.segments[tl.segments.length - 1]
    expect(first.kind).toBe('pre')
    expect(first.tStart).toBe(0)
    expect(first.tEnd).toBe(200)
    expect(last.kind).toBe('post')
    expect(last.tStart).toBe(900)
    expect(last.tEnd).toBe(1000)
  })

  it('marks the safety-car window inside the racing phase', () => {
    const sc = tl.segments.find((s) => s.kind === 'sc')
    expect(sc).toBeTruthy()
    expect(sc!.tStart).toBe(500)
    expect(sc!.tEnd).toBe(560)
  })

  it('segments are contiguous and cover the whole duration', () => {
    let cursor = 0
    for (const s of tl.segments) {
      expect(s.tStart).toBeCloseTo(cursor, 5)
      cursor = s.tEnd
    }
    expect(cursor).toBe(1000)
  })
})

describe('buildTimeline — archive race-start artifacts', () => {
  it('filters the false opening yellow from the 2024 British GP archive', () => {
    const lapCount = [
      { t: 3.991, current: 1, total: 52 },
      { t: 3590.929, current: 2, total: 52 },
      { t: 3682.363, current: 3, total: 52 },
      { t: 3773.677, current: 4, total: 52 },
      { t: 3865.455, current: 5, total: 52 }
    ]
    expect(inferRaceGreenStart(lapCount)).toBeCloseTo(3499.5, 0)
    const timeline = buildTimeline({
      duration: 8500,
      type: 'race',
      trackStatus: [
        { t: 30, status: 'YELLOW' },
        { t: 387, status: 'CLEAR' }
      ],
      lapCount
    })
    expect(timeline.segments[0]).toMatchObject({ kind: 'pre', tStart: 0 })
    expect(timeline.segments[1].kind).toBe('green')
  })

  it('preserves the real opening-lap yellow and VSC from the 2025 British GP', () => {
    const timeline = buildTimeline({
      duration: 9500,
      type: 'race',
      trackStatus: [
        { t: 0, status: 'YELLOW' },
        { t: 390.062, status: 'CLEAR' },
        { t: 3402.108, status: 'YELLOW' },
        { t: 3418.107, status: 'CLEAR' },
        { t: 3422.7, status: 'YELLOW' },
        { t: 3487.014, status: 'VSC' },
        { t: 3757.206, status: 'VSC_ENDING' },
        { t: 3770.16, status: 'CLEAR' }
      ],
      lapCount: [
        { t: 54.864, current: 1, total: 52 },
        { t: 3475.023, current: 2, total: 52 },
        { t: 3610.73, current: 3, total: 52 },
        { t: 3748.242, current: 4, total: 52 },
        { t: 3853.781, current: 5, total: 52 },
        { t: 3959.71, current: 6, total: 52 },
        { t: 4098.251, current: 7, total: 52 },
        { t: 4220.666, current: 8, total: 52 },
        { t: 4325.552, current: 9, total: 52 }
      ]
    })
    expect(timeline.greenStart).toBeCloseTo(3352.608, 2)
    expect(timeline.segments.find((segment) => segment.kind === 'yellow')).toMatchObject({
      tStart: 3402.108,
      tEnd: 3418.107
    })
    expect(timeline.segments.find((segment) => segment.kind === 'vsc')).toMatchObject({
      tStart: 3487.014
    })
  })

  it('preserves a genuine yellow that begins after lights out', () => {
    const timeline = buildTimeline({
      duration: 600,
      type: 'race',
      trackStatus: [
        { t: 0, status: 'CLEAR' },
        { t: 250, status: 'YELLOW' },
        { t: 280, status: 'CLEAR' }
      ],
      lapCount: [
        { t: 0, current: 1, total: 5 },
        { t: 100, current: 2, total: 5 },
        { t: 200, current: 3, total: 5 }
      ]
    })
    expect(timeline.segments.find((segment) => segment.kind === 'yellow')).toMatchObject({
      tStart: 250,
      tEnd: 280
    })
  })
})

describe('phaseAt — race', () => {
  const tl = buildTimeline(raceInput())

  it('labels the pre-race stretch', () => {
    expect(phaseAt(tl, 50).kind).toBe('pre')
    expect(phaseAt(tl, 50).label).toMatch(/pre|grid|formation/i)
  })

  it('labels a green-flag racing moment with lap number', () => {
    const p = phaseAt(tl, 300) // ~lap 8
    expect(p.kind).toBe('green')
    expect(p.label).toMatch(/Lap \d+\/52/)
  })

  it('labels the safety-car window', () => {
    const p = phaseAt(tl, 530)
    expect(p.kind).toBe('sc')
    expect(p.label).toMatch(/Safety Car/i)
  })

  it('labels the post-race cool-down', () => {
    const p = phaseAt(tl, 950)
    expect(p.kind).toBe('post')
    expect(p.label).toMatch(/finished/i)
  })
})

describe('buildTimeline — non-race and edge cases', () => {
  it('qualifying (no lap count) is all green from the first clear, no pre/post', () => {
    const tl = buildTimeline({
      duration: 600,
      type: 'qualifying',
      trackStatus: [{ t: 0, status: 'CLEAR' }],
      lapCount: []
    })
    expect(tl.greenStart).toBe(0)
    expect(tl.chequered).toBeNull()
    expect(tl.segments).toHaveLength(1)
    expect(tl.segments[0].kind).toBe('green')
    expect(phaseLabel('green', tl, null)).toBe('Running')
  })

  it('segments qualifying into Q1, Q2 and Q3 through the final chequered flag', () => {
    const tl = buildTimeline({
      duration: 4200,
      type: 'qualifying',
      trackStatus: [{ t: 0, status: 'CLEAR' }],
      lapCount: [],
      qualifyingParts: [
        { t: 120, part: 1 },
        { t: 1500, part: 2 },
        { t: 2700, part: 3 }
      ],
      qualifyingPhaseEnds: [
        { t: 1320, part: 1 },
        { t: 2520, part: 2 },
        { t: 3900, part: 3 }
      ],
      chequeredHint: 3900
    })
    expect(tl.segments.map((segment) => segment.kind)).toEqual(['pre', 'q1', 'break', 'q2', 'break', 'q3', 'post'])
    expect(tl.segments.find((segment) => segment.kind === 'q2')).toMatchObject({ tStart: 1500, tEnd: 2520 })
    expect(tl.segments.find((segment) => segment.kind === 'break')).toMatchObject({ tStart: 1320, tEnd: 1500 })
    expect(phaseAt(tl, 3000).label).toMatch(/Q3|pole/i)
    expect(qualifyingPhaseClockAt(tl, 2500)).toEqual({ kind: 'q2', remaining: 20, isPhase: true })
    expect(qualifyingPhaseClockAt(tl, 2600)).toEqual({ kind: 'break', remaining: 100, isPhase: false })
  })

  it('shows a red flag inside a qualifying segment without losing its Q stage', () => {
    const tl = buildTimeline({
      duration: 1800,
      type: 'qualifying',
      trackStatus: [
        { t: 0, status: 'CLEAR' },
        { t: 600, status: 'RED' },
        { t: 720, status: 'CLEAR' }
      ],
      lapCount: [],
      qualifyingParts: [{ t: 0, part: 1 }]
    })
    expect(tl.segments.map((segment) => segment.kind)).toEqual(['q1', 'red', 'q1'])
  })

  it('a race with racing from t=0 (demo-style) has no pre segment', () => {
    const lapCount = Array.from({ length: 10 }, (_, i) => ({
      t: i * 90,
      current: i + 1,
      total: 10
    }))
    const tl = buildTimeline({
      duration: 900,
      type: 'race',
      trackStatus: [{ t: 0, status: 'CLEAR' }],
      lapCount
    })
    expect(tl.greenStart).toBe(0)
    expect(tl.segments.some((s) => s.kind === 'pre')).toBe(false)
  })

  it('empty input degrades gracefully', () => {
    const tl = buildTimeline({ duration: 0, type: 'unknown', trackStatus: [], lapCount: [] })
    expect(tl.segments.length).toBeGreaterThanOrEqual(0)
    expect(() => phaseAt(tl, 0)).not.toThrow()
  })
})
