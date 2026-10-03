import { describe, expect, it } from 'vitest'
import { errorMessage } from '@renderer/lib/errorMessage'

describe('errorMessage', () => {
  it('returns the message of an Error', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom')
  })

  it('returns the message of an Error subclass', () => {
    expect(errorMessage(new TypeError('bad type'))).toBe('bad type')
  })

  it('returns a thrown string as-is', () => {
    expect(errorMessage('plain string')).toBe('plain string')
  })

  it('reads a string `message` off an Error-like object (e.g. structured IPC errors)', () => {
    expect(errorMessage({ message: 'ipc failed', code: 7 })).toBe('ipc failed')
  })

  it('uses the fallback for values with no usable message (never yields undefined)', () => {
    expect(errorMessage(undefined, 'nope')).toBe('nope')
    expect(errorMessage(null, 'nope')).toBe('nope')
    expect(errorMessage(42, 'nope')).toBe('nope')
    expect(errorMessage({}, 'nope')).toBe('nope')
    expect(errorMessage({ message: 5 }, 'nope')).toBe('nope')
  })

  it('uses the fallback for an empty message', () => {
    expect(errorMessage(new Error(''), 'nope')).toBe('nope')
    expect(errorMessage('', 'nope')).toBe('nope')
  })

  it('has a sensible default fallback', () => {
    expect(errorMessage(undefined)).toBe('Unknown error')
  })
})
