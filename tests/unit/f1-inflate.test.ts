import { deflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { inflateZPayload } from '../../src/main/f1-inflate'

const pack = (value: unknown): string =>
  deflateRawSync(Buffer.from(JSON.stringify(value), 'utf8')).toString('base64')

describe('inflateZPayload', () => {
  it('decodes base64 raw-deflated JSON', () => {
    const payload = { Entries: [{ Cars: { '1': { Channels: { '2': 301 } } } }] }
    expect(inflateZPayload(pack(payload))).toEqual(payload)
  })

  it.each([
    ['a non-string', 42],
    ['an empty string', ''],
    ['undefined', undefined],
    ['garbage that is not deflate data', 'bm90IGRlZmxhdGU='],
    ['deflated bytes that are not JSON', deflateRawSync(Buffer.from('not json')).toString('base64')]
  ])('returns null for %s', (_label, input) => {
    expect(inflateZPayload(input)).toBeNull()
  })
})
