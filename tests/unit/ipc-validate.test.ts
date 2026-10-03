import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defaultAiConfig } from '@shared/ai'
import { STORE_NS } from '@shared/ipc-contract'
import {
  MAX_DEBRIEF_BYTES,
  MAX_STORE_VALUE_BYTES,
  toStorageKey,
  validateAiCompletionRequest,
  validateAiTranscriptionRequest,
  validateDebriefExport,
  validateF1LiveCursors,
  validateF1Year,
  validateSafeFileName,
  validateStoreNamespace,
  validateStoreValue,
  validateSurfaceBounds,
  validateVideoMode,
  validateVideoSetMode,
  validateVisible
} from '../../src/main/ipc/validate'
import { PersistenceLayer } from '../../src/main/persistence'

describe('validateStoreNamespace', () => {
  it.each(Object.values(STORE_NS))('accepts the known namespace %s', (ns) => {
    expect(validateStoreNamespace(ns)).toBe(ns)
  })

  it.each([
    ['an unknown namespace', 'hax'],
    ['the internal meta namespace', '__meta'],
    ['a dotted path into a known namespace', 'settings.ai'],
    ['an empty string', ''],
    ['a non-string', 42],
    ['null', null],
    ['an object', { toString: () => 'settings' }],
    ['a prototype key', 'constructor']
  ])('rejects %s', (_label, ns) => {
    expect(() => validateStoreNamespace(ns)).toThrow(/namespace/i)
  })
})

describe('toStorageKey', () => {
  it('passes every key shape the renderer really uses through unchanged', () => {
    const real = [
      'theme',
      'performanceMode',
      'follow-enabled',
      'offset:sky',
      'offset:sky:2024%2F2024-03-02_Bahrain_Grand_Prix%2F',
      'working:broadcast-data',
      'v3/2024/2024-03-02_Bahrain_Grand_Prix',
      '2024/2024-03-02_Bahrain_Grand_Prix/2024-03-02_Race/'
    ]
    for (const key of real) expect(toStorageKey(key)).toBe(key)
  })

  it('escapes dots so a key can never nest into another path', () => {
    const stored = toStorageKey('a.b.c')
    expect(stored).not.toContain('.')
    expect(stored).not.toBe('a.b.c')
  })

  it('maps distinct dotted keys to distinct storage keys', () => {
    expect(toStorageKey('a.b')).not.toBe(toStorageKey('a_b'))
    expect(toStorageKey('a.b')).not.toBe(toStorageKey('ab'))
  })

  it('escapes the dot in a key that ends with one', () => {
    expect(toStorageKey('layout.')).not.toContain('.')
  })

  it.each([
    ['an empty key', ''],
    ['the reserved __meta key', '__meta'],
    ['any __-prefixed key', '__proto__'],
    ['a non-string', 7],
    ['undefined', undefined],
    ['an over-long key', 'k'.repeat(2000)]
  ])('rejects %s', (_label, key) => {
    expect(() => toStorageKey(key)).toThrow(/key/i)
  })
})

describe('validateStoreValue', () => {
  it('accepts ordinary JSON values, including null and falsy ones', () => {
    for (const v of [null, 0, false, '', [], {}, { a: [1, 2, { b: 'c' }] }]) {
      expect(validateStoreValue(v)).toBe(v)
    }
  })

  it('rejects undefined, which electron-store would throw on', () => {
    expect(() => validateStoreValue(undefined)).toThrow(/undefined|delete/i)
  })

  it('rejects a value larger than the cap with a clear message', () => {
    const big = { blob: 'x'.repeat(MAX_STORE_VALUE_BYTES + 1) }
    expect(() => validateStoreValue(big)).toThrow(/too large|exceeds/i)
  })

  it('accepts a value comfortably under the cap', () => {
    const ok = { blob: 'x'.repeat(1024 * 1024) }
    expect(validateStoreValue(ok)).toBe(ok)
  })

  it('rejects a value that cannot be serialized (cycle)', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(() => validateStoreValue(cyclic)).toThrow(/serializ/i)
  })
})

describe('validateAiCompletionRequest', () => {
  const valid = () => ({
    config: { ...defaultAiConfig(), apiKey: 'k', enabled: true },
    messages: [
      { role: 'system', content: 'be brief' },
      { role: 'user', content: 'pit?' }
    ],
    temperature: 0.4,
    maxTokens: 900
  })

  it('accepts a well-formed request and returns only known fields', () => {
    const out = validateAiCompletionRequest({ ...valid(), extra: 'ignored' })
    expect(out.config.provider).toBe('gemini')
    expect(out.messages).toHaveLength(2)
    expect(out).not.toHaveProperty('extra')
  })

  it('does not require temperature or maxTokens', () => {
    const { temperature: _t, maxTokens: _m, ...rest } = valid()
    const out = validateAiCompletionRequest(rest)
    expect(out.temperature).toBeUndefined()
    expect(out.maxTokens).toBeUndefined()
  })

  it.each([
    ['null', null],
    ['no config', { messages: [] }],
    ['an unknown provider', { ...valid(), config: { ...valid().config, provider: 'evil' } }],
    [
      'an inherited provider name',
      { ...valid(), config: { ...valid().config, provider: 'constructor' } }
    ],
    ['a non-string apiKey', { ...valid(), config: { ...valid().config, apiKey: 5 } }],
    ['a non-string model', { ...valid(), config: { ...valid().config, model: {} } }],
    ['no messages array', { ...valid(), messages: 'hi' }],
    ['an empty messages array', { ...valid(), messages: [] }],
    ['an unknown role', { ...valid(), messages: [{ role: 'tool', content: 'x' }] }],
    ['non-string content', { ...valid(), messages: [{ role: 'user', content: 3 }] }],
    [
      'too many messages',
      { ...valid(), messages: Array.from({ length: 500 }, () => ({ role: 'user', content: 'x' })) }
    ],
    [
      'an oversized message',
      { ...valid(), messages: [{ role: 'user', content: 'x'.repeat(1_000_000) }] }
    ],
    ['NaN temperature', { ...valid(), temperature: Number.NaN }],
    ['a huge maxTokens', { ...valid(), maxTokens: 1e9 }],
    ['a fractional maxTokens', { ...valid(), maxTokens: 1.5 }]
  ])('rejects %s', (_label, req) => {
    expect(() => validateAiCompletionRequest(req)).toThrow()
  })
})

describe('validateAiTranscriptionRequest', () => {
  const config = { ...defaultAiConfig(), provider: 'groq' as const, apiKey: 'k' }

  it('accepts a config and an audio URL string', () => {
    const out = validateAiTranscriptionRequest({ config, audioUrl: 'https://x.test/a.mp3' })
    expect(out.audioUrl).toBe('https://x.test/a.mp3')
    expect(out.config.provider).toBe('groq')
  })

  it.each([
    ['a non-string url', { config, audioUrl: 5 }],
    ['an over-long url', { config, audioUrl: `https://x.test/${'a'.repeat(5000)}` }],
    ['a bad provider', { config: { ...config, provider: 'nope' }, audioUrl: 'https://x.test/a' }],
    ['null', null]
  ])('rejects %s', (_label, req) => {
    expect(() => validateAiTranscriptionRequest(req)).toThrow()
  })
})

describe('video argument validation', () => {
  it('accepts every real video mode and rejects anything else', () => {
    for (const m of ['embedded', 'companion', 'external', 'none']) {
      expect(validateVideoMode(m)).toBe(m)
    }
    for (const bad of ['fullscreen', '', null, 3, undefined]) {
      expect(() => validateVideoMode(bad)).toThrow(/mode/i)
    }
  })

  it('accepts finite bounds, including negative offsets and zero size', () => {
    expect(validateSurfaceBounds({ x: -4.5, y: 10, width: 0, height: 720.25 })).toEqual({
      x: -4.5,
      y: 10,
      width: 0,
      height: 720.25
    })
  })

  it.each([
    ['NaN', { x: Number.NaN, y: 0, width: 1, height: 1 }],
    ['Infinity', { x: 0, y: 0, width: Number.POSITIVE_INFINITY, height: 1 }],
    ['a string coordinate', { x: '0', y: 0, width: 1, height: 1 }],
    ['a missing field', { x: 0, y: 0, width: 1 }],
    ['negative width', { x: 0, y: 0, width: -1, height: 1 }],
    ['absurd magnitude', { x: 1e12, y: 0, width: 1, height: 1 }],
    ['null', null],
    ['an array', [0, 0, 1, 1]]
  ])('rejects bounds with %s', (_label, bounds) => {
    expect(() => validateSurfaceBounds(bounds)).toThrow(/bounds/i)
  })

  it('validates set-mode requests and keeps only known fields', () => {
    const out = validateVideoSetMode({
      mode: 'embedded',
      url: 'https://tod.example/',
      bounds: { x: 1, y: 2, width: 3, height: 4 },
      autoFallback: true,
      junk: 1
    })
    expect(out).toEqual({
      mode: 'embedded',
      url: 'https://tod.example/',
      bounds: { x: 1, y: 2, width: 3, height: 4 },
      autoFallback: true
    })
    expect(validateVideoSetMode({ mode: 'none' })).toEqual({ mode: 'none' })
  })

  it.each([
    ['a bad mode', { mode: 'pip' }],
    ['a non-string url', { mode: 'embedded', url: 5 }],
    ['bad bounds', { mode: 'embedded', bounds: { x: 'a' } }],
    ['a non-boolean autoFallback', { mode: 'embedded', autoFallback: 'yes' }],
    ['null', null]
  ])('rejects a set-mode request with %s', (_label, req) => {
    expect(() => validateVideoSetMode(req)).toThrow()
  })

  it('only accepts real booleans for visibility', () => {
    expect(validateVisible(true)).toBe(true)
    expect(validateVisible(false)).toBe(false)
    expect(() => validateVisible('true')).toThrow()
    expect(() => validateVisible(undefined)).toThrow()
  })
})

describe('validateDebriefExport', () => {
  it('accepts markdown and json payloads', () => {
    expect(validateDebriefExport('# Debrief', 'md', 'a.md')).toEqual({
      content: '# Debrief',
      format: 'md',
      defaultName: 'a.md'
    })
    expect(validateDebriefExport('{}', 'json', undefined)).toEqual({
      content: '{}',
      format: 'json',
      defaultName: undefined
    })
  })

  it.each([
    ['non-string content', 5, 'md'],
    ['an unknown format', 'x', 'exe'],
    ['a missing format', 'x', undefined]
  ])('rejects %s', (_label, content, format) => {
    expect(() => validateDebriefExport(content, format, undefined)).toThrow()
  })

  it('rejects an oversized payload', () => {
    expect(() => validateDebriefExport('x'.repeat(MAX_DEBRIEF_BYTES + 1), 'md', undefined)).toThrow(
      /too large|exceeds/i
    )
  })
})

describe('validateSafeFileName', () => {
  it('passes undefined and plain names through', () => {
    expect(validateSafeFileName(undefined)).toBeUndefined()
    expect(validateSafeFileName('racedeck-debrief-1.md')).toBe('racedeck-debrief-1.md')
  })

  it('strips path separators and reserved characters instead of trusting them', () => {
    const cleaned = validateSafeFileName('..\\..\\Windows\\evil:name?.md') as string
    expect(cleaned).not.toMatch(/[\\/:*?"<>|]/)
    expect(cleaned.endsWith('.md')).toBe(true)
  })

  it('rejects a non-string and falls back to undefined for a name that sanitizes to nothing', () => {
    expect(() => validateSafeFileName(5)).toThrow()
    expect(validateSafeFileName('///')).toBeUndefined()
  })
})

describe('F1 argument validation', () => {
  it('accepts plausible seasons only', () => {
    expect(validateF1Year(2024)).toBe(2024)
    for (const bad of ['2024', 2024.5, Number.NaN, 1800, 3000, null]) {
      expect(() => validateF1Year(bad)).toThrow(/year/i)
    }
  })

  it('accepts undefined or finite-number cursor maps and a numeric generation', () => {
    expect(validateF1LiveCursors(undefined, undefined)).toEqual({
      cursors: undefined,
      generation: undefined
    })
    expect(validateF1LiveCursors({ CarData: 4 }, 2)).toEqual({
      cursors: { CarData: 4 },
      generation: 2
    })
  })

  it.each([
    ['a non-object cursors', 'x', 1],
    ['a non-finite cursor', { A: Number.NaN }, 1],
    ['a string cursor', { A: '1' }, 1],
    ['a non-numeric generation', { A: 1 }, 'g']
  ])('rejects %s', (_label, cursors, generation) => {
    expect(() => validateF1LiveCursors(cursors, generation)).toThrow()
  })
})

describe('escaped keys against the real PersistenceLayer', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'racedeck-ipc-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('keeps a dotted key as one flat entry that reads back, instead of nesting', () => {
    const store = new PersistenceLayer({ cwd: dir })

    store.set('annotations', toStorageKey('2024.race.a'), [1])
    store.set('annotations', toStorageKey('plain'), [2])

    expect(store.get('annotations', toStorageKey('2024.race.a'))).toEqual([1])
    expect(Object.keys(store.all('annotations')).sort()).toEqual(
      [toStorageKey('2024.race.a'), 'plain'].sort()
    )
  })

  it('cannot reach the internal meta entry through any validated key', () => {
    const store = new PersistenceLayer({ cwd: dir })

    for (const attempt of ['__meta', '__meta.version']) {
      expect(() => toStorageKey(attempt)).toThrow()
    }
    expect(store.get('__meta', 'version')).toBe(1)
  })
})
