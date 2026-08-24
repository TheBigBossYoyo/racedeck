import { describe, expect, it } from 'vitest'
import { formatStaleness } from '@renderer/lib/utils'

// APP_IMPROVEMENT_ROADMAP.md P0 item 5: prevent stale-feed conclusions.
describe('formatStaleness', () => {
  it('returns null below the threshold', () => {
    expect(formatStaleness(1_000, 5_000)).toBeNull()
    expect(formatStaleness(4_999, 5_000)).toBeNull()
  })

  it('returns null for an unknown (undefined/null) freshness reading', () => {
    // Undefined outside a live session — replay's clock isn't wall-clock time,
    // so there is nothing to be stale against.
    expect(formatStaleness(undefined, 5_000)).toBeNull()
    expect(formatStaleness(null, 5_000)).toBeNull()
  })

  it('formats a stale reading as "STALE <seconds>s" once at/over the threshold', () => {
    expect(formatStaleness(5_000, 5_000)).toBe('STALE 5.0s')
    expect(formatStaleness(3_200, 3_000)).toBe('STALE 3.2s')
    expect(formatStaleness(15_400, 15_000)).toBe('STALE 15.4s')
  })
})
