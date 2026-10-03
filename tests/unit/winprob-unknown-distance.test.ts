import { describe, expect, it } from 'vitest'
import { DemoProvider } from '@renderer/core/providers/DemoProvider'
import { WinProbabilityEngine, winProbabilitySummary } from '@renderer/core/engines/WinProbabilityEngine'
import type { RaceSnapshot } from '@renderer/core/providers/types'

/**
 * With the race distance unknown the engine used to run on an invented 12 laps
 * remaining and 45 % progress. It must now say it cannot project, instead of
 * publishing win chances computed from a distance nobody measured.
 */

const provider = new DemoProvider()
const midRace = provider.getSnapshotAt(provider.getDuration() * 0.5)

function withDistance(overrides: Partial<Pick<RaceSnapshot, 'totalLaps' | 'currentLap'>>): RaceSnapshot {
  return { ...midRace, session: { ...midRace.session, type: 'race' }, ...overrides }
}

describe('WinProbabilityEngine with an unknown race distance', () => {
  it('is unavailable, with a reason and no chances, when the total laps are unknown', () => {
    const model = WinProbabilityEngine.compute(withDistance({ totalLaps: null }))
    expect(model.available).toBe(false)
    expect(model.reason).toMatch(/distance/i)
    expect(model.chances).toEqual([])
    expect(model.lapsRemaining).toBeNull()
    expect(model.raceProgress).toBeNull()
    expect(model.beta).toBeNull()
    expect(model.isEstimate).toBe(true)
  })

  it('is unavailable when the current lap is not reported', () => {
    const model = WinProbabilityEngine.compute(withDistance({ currentLap: null }))
    expect(model.available).toBe(false)
    expect(model.reason).toMatch(/lap/i)
    expect(model.chances).toEqual([])
    expect(model.beta).toBeNull()
  })

  it('treats a non-positive total as unknown rather than as a finished race', () => {
    const model = WinProbabilityEngine.compute(withDistance({ totalLaps: 0 }))
    expect(model.available).toBe(false)
    expect(model.lapsRemaining).toBeNull()
    expect(model.raceProgress).toBeNull()
  })

  it('adds nothing to the AI context', () => {
    expect(winProbabilitySummary(WinProbabilityEngine.compute(withDistance({ totalLaps: null })))).toBe('')
  })

  it('still reports a non-race session as not applicable, ahead of the distance reason', () => {
    const quali: RaceSnapshot = {
      ...midRace,
      session: { ...midRace.session, type: 'qualifying' },
      totalLaps: null
    }
    expect(WinProbabilityEngine.compute(quali).reason).toMatch(/races and sprints/i)
  })

  it('has no beta to report when the distance is unknown', () => {
    expect(WinProbabilityEngine.betaFor(withDistance({ totalLaps: null }), null)).toBeNull()
    expect(WinProbabilityEngine.betaFor(withDistance({ totalLaps: null }), 20)).toBeNull()
  })
})

describe('WinProbabilityEngine with a known race distance', () => {
  it('still projects, and reports the distance it used', () => {
    const snapshot = withDistance({})
    const model = WinProbabilityEngine.compute(snapshot)
    expect(model.available).toBe(true)
    expect(model.lapsRemaining).toBe((snapshot.totalLaps as number) - (snapshot.currentLap as number))
    expect(model.raceProgress).toBeCloseTo((snapshot.currentLap as number) / (snapshot.totalLaps as number), 10)
    expect(model.beta).toBeGreaterThan(0)
  })

  it('projects a sprint the same way', () => {
    const sprint: RaceSnapshot = { ...midRace, session: { ...midRace.session, type: 'sprint' } }
    expect(WinProbabilityEngine.compute(sprint).available).toBe(true)
  })
})
