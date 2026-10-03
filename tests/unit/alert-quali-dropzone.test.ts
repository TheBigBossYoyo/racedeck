import { describe, expect, it } from 'vitest'
import { DemoProvider } from '@renderer/core/providers/DemoProvider'
import { AlertEngine } from '@renderer/core/engines/AlertEngine'
import { buildQualifyingBoard } from '@renderer/core/engines/QualifyingEngine'
import type { RaceSnapshot } from '@renderer/core/providers/types'

/**
 * The qualifying drop zone is the QualifyingEngine cutline (grid- and stage-aware),
 * not a hardcoded P16. When the stage cannot be known the alert stays silent.
 */

const provider = new DemoProvider()
const base = provider.getSnapshotAt(provider.getDuration() * 0.4)

interface QualiOptions {
  grid: number
  part?: 1 | 2 | 3 | null
  name?: string
  type?: RaceSnapshot['session']['type']
}

/** A qualifying snapshot with `grid` classified cars; driver N sits in position N. */
function qualiSnapshot({ grid, part = null, name = 'Qualifying', type = 'qualifying' }: QualiOptions): RaceSnapshot {
  const template = base.timing[0]
  return {
    ...base,
    session: { ...base.session, type, name },
    qualifyingPart: part,
    timing: Array.from({ length: grid }, (_, i) => ({
      ...template,
      driverNumber: i + 1,
      position: i + 1,
      bestLap: 90 + i * 0.05
    }))
  }
}

function alertedDrivers(
  snapshot: RaceSnapshot,
  favorites: number[]
): number[] {
  const engine = new AlertEngine({ favorites })
  return engine
    .ingest(snapshot)
    .filter((event) => event.type === 'quali-elimination')
    .flatMap((event) => event.driverNumbers)
}

describe('AlertEngine qualifying drop zone', () => {
  it('keeps flagging P16 and below in Q1 of a 20-car grid (cut is P15)', () => {
    const snapshot = qualiSnapshot({ grid: 20, part: 1 })
    expect(alertedDrivers(snapshot, [15])).toEqual([])
    expect(alertedDrivers(snapshot, [16])).toEqual([16])
    expect(alertedDrivers(snapshot, [20])).toEqual([20])
  })

  it('does not flag P16 in Q1 of a 22-car grid, where P16 is the last safe place', () => {
    const snapshot = qualiSnapshot({ grid: 22, part: 1 })
    expect(alertedDrivers(snapshot, [16])).toEqual([])
    expect(alertedDrivers(snapshot, [17])).toEqual([17])
  })

  it('flags P11-P15 in Q2, where the cut is P10', () => {
    const snapshot = qualiSnapshot({ grid: 22, part: 2 })
    expect(alertedDrivers(snapshot, [10])).toEqual([])
    expect(alertedDrivers(snapshot, [11])).toEqual([11])
    expect(alertedDrivers(snapshot, [13])).toEqual([13])
  })

  it('never flags anyone in Q3, which eliminates nobody', () => {
    const snapshot = qualiSnapshot({ grid: 22, part: 3 })
    expect(alertedDrivers(snapshot, [1, 10, 15, 22])).toEqual([])
  })

  it('reads the stage from the session name when the feed carries no segment', () => {
    const snapshot = qualiSnapshot({ grid: 22, part: null, name: 'Qualifying Q2' })
    expect(alertedDrivers(snapshot, [11])).toEqual([11])
    expect(alertedDrivers(snapshot, [10])).toEqual([])
  })

  it('does not fire on a guessed cut when the stage is unknown', () => {
    const snapshot = qualiSnapshot({ grid: 22, part: null, name: 'Qualifying' })
    expect(alertedDrivers(snapshot, [11, 16, 17, 22])).toEqual([])
  })

  it('does not fire outside qualifying', () => {
    const snapshot = qualiSnapshot({ grid: 22, part: 1, type: 'race', name: 'Race' })
    expect(alertedDrivers(snapshot, [20, 22])).toEqual([])
  })

  it('still covers sprint qualifying with the same cutline', () => {
    const snapshot = qualiSnapshot({ grid: 22, part: 1, type: 'sprint-qualifying', name: 'Sprint Qualifying' })
    expect(alertedDrivers(snapshot, [16])).toEqual([])
    expect(alertedDrivers(snapshot, [17])).toEqual([17])
  })

  it('warns once per driver within a segment', () => {
    const engine = new AlertEngine({ favorites: [18] })
    const snapshot = qualiSnapshot({ grid: 22, part: 1 })
    expect(engine.ingest(snapshot).filter((e) => e.type === 'quali-elimination')).toHaveLength(1)
    expect(engine.ingest(snapshot).filter((e) => e.type === 'quali-elimination')).toHaveLength(0)
  })

  it('re-arms when the next segment moves the cut', () => {
    const engine = new AlertEngine({ favorites: [18] })
    const q1 = qualiSnapshot({ grid: 22, part: 1 })
    const q2 = qualiSnapshot({ grid: 22, part: 2 })
    expect(engine.ingest(q1).filter((e) => e.type === 'quali-elimination')).toHaveLength(1)
    expect(engine.ingest(q2).filter((e) => e.type === 'quali-elimination')).toHaveLength(1)
  })

  it('flags exactly the rows the qualifying board marks at risk', () => {
    for (const grid of [16, 20, 22]) {
      for (const part of [1, 2, 3] as const) {
        const snapshot = qualiSnapshot({ grid, part })
        const atRisk = buildQualifyingBoard(snapshot)
          .rows.filter((row) => row.atRisk)
          .map((row) => row.driverNumber)
        const everyone = snapshot.timing.map((entry) => entry.driverNumber)
        expect(alertedDrivers(snapshot, everyone).sort((a, b) => a - b)).toEqual(atRisk)
      }
    }
  })
})
