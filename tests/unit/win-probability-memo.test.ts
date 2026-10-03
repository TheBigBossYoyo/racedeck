import { createElement } from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Driver } from '@shared/models'
import type { MarketWinnerResult } from '@shared/market'
import type { RaceSnapshot } from '@renderer/core/providers/types'
import { emptyAvailability } from '@renderer/core/providers/types'
import { useSessionStore } from '@renderer/store/sessionStore'
import { useSettingsStore, defaultMarketConfig } from '@renderer/store/settingsStore'
import { useMarketStore } from '@renderer/store/marketStore'
import { WinProbabilityPanel } from '@renderer/widgets/WinProbabilityPanel'

function driver(number: number, code: string, lastName: string): Driver {
  return {
    number,
    code,
    firstName: 'X',
    lastName,
    fullName: `X ${lastName}`,
    broadcastName: null,
    teamName: null,
    teamColour: null,
    headshotUrl: null,
    countryCode: null
  } as unknown as Driver
}

function snapshot(drivers: Driver[], clock: number): RaceSnapshot {
  return {
    session: { id: 's', type: 'race', year: 2026, provider: 'test', dateStart: '2026-03-01T14:00:00Z' },
    drivers,
    timing: [],
    laps: [],
    stints: [],
    raceControl: [],
    weather: null,
    weatherHistory: [],
    positions: [],
    availability: emptyAvailability(),
    clock,
    currentLap: 1,
    totalLaps: 50,
    trackStatus: 'CLEAR'
  } as unknown as RaceSnapshot
}

function result(names: string[]): MarketWinnerResult {
  return {
    ok: true,
    error: null,
    event: { slug: 'gp', title: 'GP', closed: true, active: false, endDate: null, volume: null },
    outcomes: names.map((name) => ({
      name,
      probability: 0.1,
      fairProbability: 0.1,
      yesTokenId: `tok-${name}`,
      resolved: false
    })),
    fetchedAt: '2026-03-01T15:00:00Z',
    latencyMs: 1
  }
}

const AAA = driver(1, 'AAA', 'Alderman')
const BBB = driver(2, 'BBB', 'Bickerton')
const CCC = driver(3, 'CCC', 'Cartwright')

const loadHistory = vi.fn(async () => undefined)

beforeEach(() => {
  loadHistory.mockClear()
  useSettingsStore.setState({ market: { ...defaultMarketConfig(), enabled: true, autoRefresh: false } })
  useMarketStore.setState({
    result: result(['Alderman', 'Bickerton']),
    loadHistory,
    refresh: vi.fn(async () => undefined)
  })
})

afterEach(() => {
  cleanup()
  useMarketStore.getState().clear()
})

const publish = (drivers: Driver[], clock: number) =>
  act(() => {
    useSessionStore.setState({ duration: 100, clock, snapshot: snapshot(drivers, clock) })
  })

describe('WinProbabilityPanel market-history effect', () => {
  it('requests each driver token once across many same-driver publishes', () => {
    const drivers = [AAA, BBB]
    publish(drivers, 0)
    render(createElement(WinProbabilityPanel))
    const afterMount = loadHistory.mock.calls.length
    expect(afterMount).toBe(2)

    // 30 publishes: a new snapshot object every time, same drivers identity, a moving clock.
    for (let i = 1; i <= 30; i++) publish(drivers, i)

    expect(loadHistory.mock.calls.length).toBe(afterMount)
  })

  it('does not go stale when the driver list genuinely changes', () => {
    const drivers = [AAA, BBB]
    publish(drivers, 0)
    useMarketStore.setState({ result: result(['Alderman', 'Bickerton', 'Cartwright']) })
    render(createElement(WinProbabilityPanel))
    expect(loadHistory.mock.calls.map((c) => (c as unknown as [string])[0]).sort()).toEqual([
      'tok-Alderman',
      'tok-Bickerton'
    ])

    publish([AAA, BBB, CCC], 1)

    const tokens = loadHistory.mock.calls.map((c) => (c as unknown as [string])[0])
    expect(tokens).toContain('tok-Cartwright')
  })

  it('re-matches when the market result changes', () => {
    const drivers = [AAA, BBB, CCC]
    publish(drivers, 0)
    render(createElement(WinProbabilityPanel))
    expect(loadHistory).toHaveBeenCalledTimes(2)

    act(() => {
      useMarketStore.setState({ result: result(['Alderman', 'Bickerton', 'Cartwright']) })
    })

    expect(loadHistory.mock.calls.map((c) => (c as unknown as [string])[0])).toContain('tok-Cartwright')
  })
})
