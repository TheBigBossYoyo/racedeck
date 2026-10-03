import { describe, expect, it } from 'vitest'
import { isLayoutId, LAYOUT_PRESETS, deserializeSavedLayout } from '@renderer/core/engines/LayoutManager'

describe('isLayoutId', () => {
  it('accepts every real preset id', () => {
    for (const id of Object.keys(LAYOUT_PRESETS)) expect(isLayoutId(id)).toBe(true)
  })

  it.each(['constructor', 'toString', 'hasOwnProperty', '__proto__', 'valueOf', 'nope', ''])(
    'rejects %j (inherited or unknown key)',
    (id) => {
      expect(isLayoutId(id)).toBe(false)
    }
  )

  it.each([null, undefined, 1, {}, []])('rejects the non-string %j', (v) => {
    expect(isLayoutId(v)).toBe(false)
  })

  it('makes deserializeSavedLayout drop a layout based on an inherited key', () => {
    const grid = [{ i: 'timing-tower', x: 0, y: 0, w: 4, h: 8 }]
    expect(deserializeSavedLayout({ id: 'a', name: 'n', base: 'constructor', grid })).toBeNull()
    const base = Object.keys(LAYOUT_PRESETS)[0]
    expect(deserializeSavedLayout({ id: 'a', name: 'n', base, grid })).not.toBeNull()
  })
})
