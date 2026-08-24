import { describe, expect, it } from 'vitest'
import type { WeatherSample } from '@shared/models'
import {
  weatherFieldTrend,
  rainTransition,
  dryingReadiness
} from '@renderer/core/engines/WeatherTrendEngine'

function sample(offsetSec: number, overrides: Partial<WeatherSample> = {}): WeatherSample {
  const base = Date.parse('2026-03-01T14:00:00Z')
  return {
    date: new Date(base + offsetSec * 1000).toISOString(),
    airTemp: 22,
    trackTemp: 34,
    humidity: 45,
    pressure: 1012,
    windSpeed: 2,
    windDirection: 180,
    rainfall: false,
    ...overrides
  }
}

describe('weatherFieldTrend', () => {
  it('reports stable with fewer than 3 samples', () => {
    expect(weatherFieldTrend([sample(0), sample(60)], 'airTemp').direction).toBe('stable')
  })

  it('reports rising when a field climbs steadily', () => {
    const history = [0, 60, 120, 180, 240].map((t, i) => sample(t, { airTemp: 20 + i * 2 }))
    const trend = weatherFieldTrend(history, 'airTemp')
    expect(trend.direction).toBe('rising')
    expect(trend.slopePerMin).toBeGreaterThan(0)
  })

  it('reports falling when a field drops steadily', () => {
    const history = [0, 60, 120, 180, 240].map((t, i) => sample(t, { trackTemp: 40 - i * 3 }))
    const trend = weatherFieldTrend(history, 'trackTemp')
    expect(trend.direction).toBe('falling')
    expect(trend.slopePerMin).toBeLessThan(0)
  })

  it('reports stable within the deadband', () => {
    const history = [0, 60, 120, 180].map((t) => sample(t, { windSpeed: 3 }))
    expect(weatherFieldTrend(history, 'windSpeed').direction).toBe('stable')
  })
})

describe('rainTransition', () => {
  it('finds an onset transition and its elapsed time', () => {
    const history = [
      sample(0, { rainfall: false }),
      sample(60, { rainfall: false }),
      sample(120, { rainfall: true }),
      sample(180, { rainfall: true })
    ]
    const t = rainTransition(history)
    expect(t.kind).toBe('onset')
    expect(t.elapsedSec).toBe(60)
  })

  it('finds a cessation transition', () => {
    const history = [
      sample(0, { rainfall: true }),
      sample(60, { rainfall: true }),
      sample(120, { rainfall: false }),
      sample(600, { rainfall: false })
    ]
    const t = rainTransition(history)
    expect(t.kind).toBe('cessation')
    expect(t.elapsedSec).toBe(480)
  })

  it('returns null when there is no transition', () => {
    const history = [sample(0), sample(60), sample(120)]
    expect(rainTransition(history).kind).toBeNull()
  })
})

describe('dryingReadiness', () => {
  it('reads raining when currently raining', () => {
    const current = sample(0, { rainfall: true })
    expect(dryingReadiness([current], current)).toBe('raining')
  })

  it('reads dry when it has never rained this session', () => {
    const history = [sample(0), sample(60), sample(120)]
    expect(dryingReadiness(history, history[history.length - 1])).toBe('dry')
  })

  it('reads raining just after rain stops (still wet)', () => {
    const history = [sample(0, { rainfall: true }), sample(60, { rainfall: false })]
    expect(dryingReadiness(history, history[history.length - 1])).toBe('raining')
  })

  it('reads drying once rain stopped a while ago and track temp is climbing', () => {
    const history = [
      sample(0, { rainfall: true, trackTemp: 25 }),
      sample(60, { rainfall: false, trackTemp: 26 }),
      sample(700, { rainfall: false, trackTemp: 29 }),
      sample(1400, { rainfall: false, trackTemp: 32 })
    ]
    expect(dryingReadiness(history, history[history.length - 1])).toBe('drying')
  })

  it('reads unknown with no current sample', () => {
    expect(dryingReadiness([], null)).toBe('unknown')
  })
})
