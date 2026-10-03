import { describe, expect, it } from 'vitest'
import { normalizeCompound } from '@renderer/core/providers/normalize'

// The F1 feed is remote input that the normalizers read through `as string`
// casts, so a wrong-typed Compound must degrade to UNKNOWN, never throw.
describe('normalizeCompound with wrong-typed feed values', () => {
  it.each([[42], [0], [true], [{}], [['SOFT']], [Symbol.iterator], [() => 'SOFT']])(
    'returns UNKNOWN for a non-string (%s) instead of throwing',
    (value) => {
      expect(() => normalizeCompound(value as never)).not.toThrow()
      expect(normalizeCompound(value as never)).toBe('UNKNOWN')
    }
  )

  it('still maps real values and treats null/empty as UNKNOWN', () => {
    expect(normalizeCompound(' soft ')).toBe('SOFT')
    expect(normalizeCompound('H')).toBe('HARD')
    expect(normalizeCompound(null)).toBe('UNKNOWN')
    expect(normalizeCompound('')).toBe('UNKNOWN')
  })
})
