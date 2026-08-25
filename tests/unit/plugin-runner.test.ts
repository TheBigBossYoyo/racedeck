import { describe, expect, it } from 'vitest'
import { runPlugin, sanitizePluginResult, withTimeout } from '@renderer/lib/pluginRunner'
import type { PluginSnapshot } from '@renderer/core/engines/PluginSnapshotApi'

describe('sanitizePluginResult', () => {
  it('accepts a plain object of number/string metrics', () => {
    expect(sanitizePluginResult({ avgLapTime: 91.234, note: 'ok' })).toEqual({
      avgLapTime: 91.234,
      note: 'ok'
    })
  })

  it('drops keys whose values are not number/string', () => {
    expect(sanitizePluginResult({ ok: 1, bad: () => 1, nested: { x: 1 }, arr: [1, 2] })).toEqual({
      ok: 1
    })
  })

  it('returns an error object when the plugin did not return an object', () => {
    expect(sanitizePluginResult(null)).toEqual({
      error: expect.stringContaining('must return an object')
    })
    expect(sanitizePluginResult('not an object')).toEqual({
      error: expect.stringContaining('must return an object')
    })
    expect(sanitizePluginResult(undefined)).toEqual({
      error: expect.stringContaining('must return an object')
    })
  })
})

describe('withTimeout', () => {
  it('resolves with the task result when it finishes before the timeout', async () => {
    const result = await withTimeout(Promise.resolve('done'), 50, () => 'timed-out')
    expect(result).toBe('done')
  })

  it('resolves with onTimeout() when the task never finishes (the timeout path)', async () => {
    const neverResolves = new Promise<string>(() => {})
    const result = await withTimeout(neverResolves, 20, () => 'timed-out')
    expect(result).toBe('timed-out')
  })

  it('ignores a late task resolution after the timeout already fired', async () => {
    let resolveLate: (v: string) => void = () => {}
    const late = new Promise<string>((resolve) => {
      resolveLate = resolve
    })
    const result = await withTimeout(late, 10, () => 'timed-out')
    expect(result).toBe('timed-out')
    // Resolving after the fact must not throw or change anything observable.
    resolveLate('too-late')
  })
})

describe('runPlugin (no-Worker environment)', () => {
  it('resolves to an error rather than throwing when Worker is unavailable', async () => {
    // This project's unit-test environment (jsdom) has no Worker global —
    // confirmed directly. runPlugin must degrade gracefully here, exactly
    // as it would in any other non-Worker-capable context.
    expect(typeof (globalThis as { Worker?: unknown }).Worker).toBe('undefined')
    const snapshot: PluginSnapshot = { clock: 0, currentLap: null, trackStatus: 'CLEAR' }
    const result = await runPlugin('function compute(s) { return {} }', snapshot)
    expect(result).toHaveProperty('error')
  })
})
