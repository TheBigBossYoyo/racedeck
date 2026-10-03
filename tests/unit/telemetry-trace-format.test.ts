import { describe, expect, it } from 'vitest'
import { formatTraceTime } from '@renderer/widgets/TelemetryTracePanel'

describe('formatTraceTime', () => {
  const stamps = [
    '2025-03-16T00:00:00.000Z',
    '2025-03-16T00:00:09.999Z',
    '2025-03-16T04:05:06.789Z',
    '2025-03-16T12:00:00.000Z',
    '2025-03-16T13:07:08.000Z',
    '2025-03-16T23:59:59.999Z',
    '2025-06-01T09:03:07+02:00',
    '2025-12-31T23:00:00-05:00'
  ]

  it('matches toLocaleTimeString("en-GB", { hour12: false }) exactly', () => {
    for (const iso of stamps) {
      expect(formatTraceTime(iso)).toBe(new Date(iso).toLocaleTimeString('en-GB', { hour12: false }))
    }
  })

  it('matches for every second of a sweep, including hour and midnight rollovers', () => {
    const start = Date.parse('2025-03-16T22:59:30.000Z')
    for (let i = 0; i < 4_000; i += 7) {
      const d = new Date(start + i * 1_000)
      expect(formatTraceTime(d)).toBe(d.toLocaleTimeString('en-GB', { hour12: false }))
    }
  })

  it('is a 24 h HH:MM:SS label', () => {
    expect(formatTraceTime('2025-03-16T13:07:08.000Z')).toMatch(/^\d{2}:\d{2}:\d{2}$/)
  })
})
