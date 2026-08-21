import { describe, expect, it } from 'vitest'
import { DemoProvider } from '@renderer/core/providers/DemoProvider'
import {
  buildQualifyingBoard,
  buildQualifyingFocusProjection,
  classifyQualifyingRunState,
  estimateTrackEvolution,
  qualifyingCutoff
} from '@renderer/core/engines/QualifyingEngine'
import type { RaceSnapshot } from '@renderer/core/providers/types'

async function qualifyingSnapshot(part: 1 | 2 | 3): Promise<RaceSnapshot> {
  const provider = new DemoProvider()
  await provider.loadSession('demo-2024-gp')
  const snapshot = provider.getSnapshotAt(provider.getDuration() * 0.4)
  return {
    ...snapshot,
    session: { ...snapshot.session, type: 'qualifying', name: 'Qualifying' },
    qualifyingPart: part
  }
}

describe('QualifyingEngine', () => {
  it('uses grid-aware Q1 and Q2 cutlines', () => {
    expect(qualifyingCutoff(1, 20)).toBe(15)
    expect(qualifyingCutoff(1, 22)).toBe(16)
    expect(qualifyingCutoff(2, 22)).toBe(10)
    expect(qualifyingCutoff(3, 22)).toBeNull()
  })

  it('marks the bubble, at-risk rows and fastest driver', async () => {
    const board = buildQualifyingBoard(await qualifyingSnapshot(1))
    expect(board.cutoffPosition).toBe(15)
    expect(board.rows.find((row) => row.position === 15)?.bubble).toBe(true)
    expect(board.rows.find((row) => row.position === 16)?.atRisk).toBe(true)
    expect(board.rows.filter((row) => row.fastest)).toHaveLength(1)
  })

  it('removes the elimination cutline in Q3', async () => {
    const board = buildQualifyingBoard(await qualifyingSnapshot(3))
    expect(board.stage).toBe(3)
    expect(board.cutoffPosition).toBeNull()
    expect(board.rows.every((row) => !row.atRisk)).toBe(true)
  })

  it('uses direct pit and out-lap feed states', async () => {
    const snapshot = await qualifyingSnapshot(1)
    const entry = snapshot.timing[0]
    expect(classifyQualifyingRunState(snapshot, { ...entry, inPit: true, status: 'IN_PIT' })).toEqual({
      state: 'IN PITS',
      stateIsEstimate: false
    })
    expect(classifyQualifyingRunState(snapshot, { ...entry, inPit: false, status: 'OUT_LAP' })).toEqual({
      state: 'OUT LAP',
      stateIsEstimate: false
    })
  })

  it('distinguishes a hot lap from inferred cooldown and preparation laps', async () => {
    const snapshot = await qualifyingSnapshot(1)
    const entry = snapshot.timing[0]
    const quiet = {
      ...entry,
      inPit: false,
      status: 'RUNNING' as const,
      sector1: { seconds: null, state: 'none' as const },
      sector2: { seconds: null, state: 'none' as const },
      sector3: { seconds: null, state: 'none' as const },
      bestLap: 90
    }
    expect(classifyQualifyingRunState(snapshot, {
      ...quiet,
      sector1: { seconds: 29.1, state: 'personal-best' }
    })).toEqual({ state: 'HOT LAP', stateIsEstimate: false })
    expect(classifyQualifyingRunState(snapshot, { ...quiet, lastLap: 91 })).toEqual({
      state: 'COOLDOWN',
      stateIsEstimate: true
    })
    expect(classifyQualifyingRunState(snapshot, { ...quiet, lastLap: 101 })).toEqual({
      state: 'PREP LAP',
      stateIsEstimate: true
    })
  })

  it('projects missing hot-lap sectors and the resulting classification position', async () => {
    const base = await qualifyingSnapshot(1)
    const focused = base.timing[0]
    const rivals = base.timing.slice(1, 3)
    const snapshot: RaceSnapshot = {
      ...base,
      timing: [
        {
          ...focused,
          position: 2,
          bestLap: 97,
          status: 'RUNNING',
          sector1: { seconds: 28, state: 'personal-best' },
          sector2: { seconds: null, state: 'none' },
          sector3: { seconds: null, state: 'none' }
        },
        { ...rivals[0], position: 1, bestLap: 95 },
        { ...rivals[1], position: 3, bestLap: 98 }
      ],
      laps: [
        {
          driverNumber: focused.driverNumber,
          lapNumber: 1,
          lapTime: 100,
          sector1: 30,
          sector2: 40,
          sector3: 30,
          speedI1: null,
          speedI2: null,
          speedST: null,
          isPitOutLap: false,
          isPitInLap: false,
          compound: 'SOFT',
          dateStart: null
        },
        {
          driverNumber: focused.driverNumber,
          lapNumber: 2,
          lapTime: 97,
          sector1: 29,
          sector2: 39,
          sector3: 29,
          speedI1: null,
          speedI2: null,
          speedST: null,
          isPitOutLap: false,
          isPitInLap: false,
          compound: 'SOFT',
          dateStart: null
        }
      ]
    }
    const projection = buildQualifyingFocusProjection(snapshot, focused.driverNumber)
    expect(projection).not.toBeNull()
    expect(projection?.bestSectors).toEqual([29, 39, 29])
    expect(projection?.projectedSectors[0]).toBe(28)
    expect(projection?.projectedSectors[1]).toBeCloseTo(38.315, 3)
    expect(projection?.projectedLap).toBeCloseTo(94.93, 2)
    expect(projection?.projectedPosition).toBe(1)
    expect(projection?.confidence).toBe('medium')
  })

  it('estimates track evolution from timestamped paired driver laps, independent of array order', () => {
    const lap = (driverNumber: number, lapNumber: number, lapTime: number, sessionTime: number) => ({
      driverNumber,
      lapNumber,
      lapTime,
      sector1: lapTime * 0.3,
      sector2: lapTime * 0.4,
      sector3: lapTime * 0.3,
      speedI1: null,
      speedI2: null,
      speedST: null,
      isPitOutLap: false,
      isPitInLap: false,
      compound: 'SOFT' as const,
      dateStart: null,
      sessionTime
    })
    const estimate = estimateTrackEvolution([
      lap(1, 1, 100, 10), lap(1, 2, 99, 110),
      lap(4, 1, 101, 20), lap(4, 2, 100, 120),
      lap(16, 1, 102, 30), lap(16, 3, 120, 115), lap(16, 2, 101, 130)
    ])
    expect(estimate).toEqual({ deltaSeconds: -1, pairedDrivers: 3 })
  })
})
