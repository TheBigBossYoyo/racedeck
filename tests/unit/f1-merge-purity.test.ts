import { describe, expect, it } from 'vitest'
import { deepMergeF1 } from '@shared/f1live'

/**
 * `deepMergeF1` mutates its BASE, never its PATCH. It used to store the patch's
 * own sub-objects in the base, so the next patch merged straight into a stored
 * stream point and rewrote it — the first point of a feed silently became the
 * final state and any replay from the start saw the future.
 */
describe('deepMergeF1 stream-point immutability', () => {
  it('does not let a later patch rewrite an earlier patch that seeded the base', () => {
    const first = { Lines: { '1': { Position: '1', NumberOfLaps: 1 } } }
    const second = { Lines: { '1': { Position: '2', NumberOfLaps: 2 } } }
    const frozenFirst = structuredClone(first)

    let state: unknown = {}
    state = deepMergeF1(state, first)
    state = deepMergeF1(state, second)

    expect(state).toEqual({ Lines: { '1': { Position: '2', NumberOfLaps: 2 } } })
    expect(first).toEqual(frozenFirst)
  })

  it('does not alias array patches that replace a non-array base', () => {
    const patch = { Sectors: [{ Value: '1' }, { Value: '2' }] }
    const state = deepMergeF1({}, patch) as { Sectors: { Value: string }[] }
    deepMergeF1(state, { Sectors: { '0': { Value: 'x' } } })
    expect(patch.Sectors[0].Value).toBe('1')
    expect(state.Sectors[0].Value).toBe('x')
  })

  it('does not alias values stored through an indexed patch', () => {
    const stints: unknown[] = []
    const patch = { '0': { Compound: 'SOFT', Laps: 1 } }
    deepMergeF1(stints, patch)
    deepMergeF1(stints, { '0': { Laps: 9 } })
    expect(patch['0'].Laps).toBe(1)
    expect(stints).toEqual([{ Compound: 'SOFT', Laps: 9 }])
  })

  it('keeps holes in sparse arrays it copies', () => {
    const sparse: unknown[] = []
    sparse[2] = { v: 1 }
    const state = deepMergeF1({}, { Lines: sparse }) as { Lines: unknown[] }
    expect(state.Lines.length).toBe(3)
    expect(0 in state.Lines).toBe(false)
    expect(state.Lines[2]).toEqual({ v: 1 })
  })

  it('never re-parents a copy through a JSON-parsed __proto__ key', () => {
    const patch = JSON.parse('{"Lines":{"__proto__":{"polluted":true},"1":{"a":1}}}') as unknown
    const state = deepMergeF1({}, patch) as { Lines: Record<string, unknown> }
    expect(Object.getPrototypeOf(state.Lines)).toBe(Object.prototype)
    expect((state.Lines as { polluted?: boolean }).polluted).toBeUndefined()
    expect(state.Lines['1']).toEqual({ a: 1 })
  })
})
