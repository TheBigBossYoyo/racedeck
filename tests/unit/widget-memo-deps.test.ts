import { createElement } from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DemoProvider } from '@renderer/core/providers/DemoProvider'
import type { RaceSnapshot } from '@renderer/core/providers/types'

const engineCalls = vi.hoisted(() => ({ bestTyre: 0, compound: 0 }))
const chartOptions = vi.hoisted((): unknown[] => [])

vi.mock('@renderer/core/engines/AnalyticsEngine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@renderer/core/engines/AnalyticsEngine')>()
  return {
    ...actual,
    bestTyrePerTeam: (s: RaceSnapshot) => {
      engineCalls.bestTyre += 1
      return actual.bestTyrePerTeam(s)
    },
    compoundPerformance: (s: RaceSnapshot) => {
      engineCalls.compound += 1
      return actual.compoundPerformance(s)
    }
  }
})

vi.mock('@renderer/lib/echarts', () => ({
  Chart: ({ option }: { option: unknown }) => {
    chartOptions.push(option)
    return createElement('div', { 'data-testid': 'chart' })
  },
  gridBase: {},
  tooltipBase: {},
  cssVar: () => '#fff'
}))

// The widgets only read `snapshot`; a bare store keeps this test independent of the
// provider stack that the real session store constructs at import time.
vi.mock('@renderer/store/sessionStore', async () => {
  const { create } = await import('zustand')
  return { useSessionStore: create(() => ({ snapshot: null })) }
})

import { TyrePerformancePanel } from '@renderer/widgets/TyrePerformancePanel'
import { GapChart } from '@renderer/widgets/GapChart'
import { useSessionStore } from '@renderer/store/sessionStore'

const provider = new DemoProvider()
const base = provider.getSnapshotAt(provider.getDuration() * 0.6)

function setSnapshot(snapshot: RaceSnapshot): void {
  act(() => useSessionStore.setState({ snapshot }))
}

beforeEach(() => {
  engineCalls.bestTyre = 0
  engineCalls.compound = 0
  chartOptions.length = 0
  useSessionStore.setState({ snapshot: base })
})

afterEach(() => {
  cleanup()
  useSessionStore.setState({ snapshot: null })
})

describe('TyrePerformancePanel recomputation', () => {
  it('does not re-run the engines for a snapshot that only moved the clock or timing', () => {
    render(createElement(TyrePerformancePanel))
    expect(engineCalls.bestTyre).toBe(1)
    expect(engineCalls.compound).toBe(1)

    setSnapshot({ ...base, clock: base.clock + 1, timing: [...base.timing] })
    setSnapshot({ ...base, clock: base.clock + 2, raceControl: [...base.raceControl] })
    expect(engineCalls.bestTyre).toBe(1)
    expect(engineCalls.compound).toBe(1)
  })

  it.each([
    ['laps', { laps: [...base.laps] }],
    ['stints', { stints: [...base.stints] }],
    ['drivers', { drivers: [...base.drivers] }],
    ['currentLap', { currentLap: (base.currentLap ?? 0) + 1 }],
    ['totalLaps', { totalLaps: (base.totalLaps ?? 0) + 1 }],
    ['session type', { session: { ...base.session, type: 'sprint' as const } }]
  ])('re-runs when %s changes', (_name, over) => {
    render(createElement(TyrePerformancePanel))
    setSnapshot({ ...base, ...over })
    expect(engineCalls.bestTyre).toBe(2)
  })
})

describe('GapChart recomputation', () => {
  it('rebuilds the option only when timing or drivers change', () => {
    render(createElement(GapChart))
    const first = chartOptions[chartOptions.length - 1]
    expect(first).toBeTruthy()

    setSnapshot({ ...base, clock: base.clock + 1, laps: [...base.laps] })
    expect(chartOptions[chartOptions.length - 1]).toBe(first)

    setSnapshot({ ...base, timing: base.timing.map((t) => ({ ...t })) })
    expect(chartOptions[chartOptions.length - 1]).not.toBe(first)
  })
})
