import { describe, expect, it } from 'vitest'
import {
  validateMarketHistoryRequest,
  validateMarketSearchQuery,
  validateMarketWinnerRequest
} from '../../src/main/ipc/validate'

describe('validateMarketSearchQuery', () => {
  it('passes a plain query through unchanged', () => {
    expect(validateMarketSearchQuery('British Grand Prix')).toBe('British Grand Prix')
  })

  it.each([[undefined], [null], [42], [{}], [['a']]])('rejects a non-string (%j)', (bad) => {
    expect(() => validateMarketSearchQuery(bad)).toThrow(/query/)
  })

  it('rejects an absurdly long query', () => {
    expect(() => validateMarketSearchQuery('x'.repeat(5_000))).toThrow(/too long/)
  })
})

describe('validateMarketWinnerRequest', () => {
  it('accepts the full request shape', () => {
    const req = { query: 'Monaco', slug: 'f1-monaco-gp', targetDateMs: 1_700_000_000_000 }
    expect(validateMarketWinnerRequest(req)).toEqual(req)
  })

  it('accepts an empty request and drops unknown fields', () => {
    expect(validateMarketWinnerRequest({ extra: 'nope' })).toEqual({})
  })

  it.each([[null], ['str'], [[]], [undefined]])('rejects a non-object (%j)', (bad) => {
    expect(() => validateMarketWinnerRequest(bad)).toThrow(/object/)
  })

  it.each([
    [{ query: 5 }, /query/],
    [{ slug: {} }, /slug/],
    [{ targetDateMs: 'soon' }, /targetDateMs/],
    [{ targetDateMs: Number.NaN }, /targetDateMs/]
  ])('rejects a wrongly typed field %j', (bad, message) => {
    expect(() => validateMarketWinnerRequest(bad)).toThrow(message)
  })
})

describe('validateMarketHistoryRequest', () => {
  it('accepts a request with a token id only', () => {
    expect(validateMarketHistoryRequest({ yesTokenId: '123456789' })).toEqual({
      yesTokenId: '123456789'
    })
  })

  it('keeps the optional range hints', () => {
    const req = { yesTokenId: 'abc', interval: '1d', fidelity: 30, startTs: 100, endTs: 200 }
    expect(validateMarketHistoryRequest(req)).toEqual(req)
  })

  it.each([
    [undefined, /object/],
    [{}, /yesTokenId/],
    [{ yesTokenId: 7 }, /yesTokenId/],
    [{ yesTokenId: 'x'.repeat(1_000) }, /too long/],
    [{ yesTokenId: 'abc', interval: 3 }, /interval/],
    [{ yesTokenId: 'abc', fidelity: Number.POSITIVE_INFINITY }, /fidelity/],
    [{ yesTokenId: 'abc', startTs: 'yesterday' }, /startTs/]
  ])('rejects %j', (bad, message) => {
    expect(() => validateMarketHistoryRequest(bad)).toThrow(message)
  })
})
