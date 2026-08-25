import { describe, expect, it } from 'vitest'
import { createAnnotation, sanitizeAnnotations } from '@renderer/core/engines/UserAnnotations'

describe('createAnnotation', () => {
  it('trims text and an empty/whitespace tag becomes null', () => {
    const a = createAnnotation({
      sessionId: 's1',
      t: 42,
      driverNumber: 1,
      lapNumber: 3,
      tag: '   ',
      text: '  needs review  '
    })
    expect(a.tag).toBeNull()
    expect(a.text).toBe('needs review')
  })

  it('clamps a negative t to zero', () => {
    const a = createAnnotation({
      sessionId: 's1',
      t: -5,
      driverNumber: null,
      lapNumber: null,
      tag: null,
      text: 'x'
    })
    expect(a.t).toBe(0)
  })

  it('generates a unique id and an ISO createdAt', () => {
    const a = createAnnotation({
      sessionId: 's1',
      t: 0,
      driverNumber: null,
      lapNumber: null,
      tag: null,
      text: 'x'
    })
    const b = createAnnotation({
      sessionId: 's1',
      t: 0,
      driverNumber: null,
      lapNumber: null,
      tag: null,
      text: 'x'
    })
    expect(a.id).not.toBe(b.id)
    expect(new Date(a.createdAt).toString()).not.toBe('Invalid Date')
  })
})

describe('sanitizeAnnotations', () => {
  it('returns an empty array for non-array input', () => {
    expect(sanitizeAnnotations(null)).toEqual([])
    expect(sanitizeAnnotations({})).toEqual([])
  })

  it('drops malformed entries and keeps valid ones', () => {
    const valid = {
      id: 'a1',
      sessionId: 's1',
      t: 10,
      driverNumber: 1,
      lapNumber: 2,
      tag: 'note',
      text: 'ok',
      createdAt: '2026-01-01T00:00:00.000Z'
    }
    const out = sanitizeAnnotations([valid, { id: 'missing-fields' }, 'not-an-object', null])
    expect(out).toHaveLength(1)
    expect(out[0]).toEqual(valid)
  })

  it('sorts by t ascending', () => {
    const mk = (id: string, t: number) => ({
      id,
      sessionId: 's1',
      t,
      driverNumber: null,
      lapNumber: null,
      tag: null,
      text: 'x',
      createdAt: '2026-01-01T00:00:00.000Z'
    })
    const out = sanitizeAnnotations([mk('b', 20), mk('a', 5)])
    expect(out.map((a) => a.id)).toEqual(['a', 'b'])
  })
})
