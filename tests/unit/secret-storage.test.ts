import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PersistenceLayer } from '../../src/main/persistence'
import type { SecretCipher } from '../../src/main/secret-storage'

const KEY = 'sk-SECRET-1234567890-abcdef'

interface FakeCipher extends SecretCipher {
  available: boolean
  broken: boolean
  encryptCalls: number
}

/** Stand-in for Electron safeStorage. `profile` models a different Windows user: it changes the "DPAPI key". */
function fakeCipher(profile = 0x5a): FakeCipher {
  const cipher: FakeCipher = {
    available: true,
    broken: false,
    encryptCalls: 0,
    isEncryptionAvailable: () => cipher.available,
    encryptString: (plain) => {
      cipher.encryptCalls += 1
      if (cipher.broken) throw new Error('encrypt failed')
      const bytes = [...Buffer.from(plain, 'utf8')].map((b) => b ^ profile)
      return Buffer.from([profile, ...bytes])
    },
    decryptString: (buf) => {
      if (cipher.broken) throw new Error('decrypt failed')
      if (buf.length === 0 || buf[0] !== profile) throw new Error('Error while decrypting the ciphertext')
      return Buffer.from([...buf.subarray(1)].map((b) => b ^ profile)).toString('utf8')
    }
  }
  return cipher
}

const aiConfig = (apiKey: string) => ({
  provider: 'openai',
  apiKey,
  model: 'gpt-4o-mini',
  baseUrl: 'https://api.example.test/v1',
  enabled: true
})

let dir: string
let file: string

const rawFile = (): string => readFileSync(file, 'utf8')
const rawJson = (): { settings?: Record<string, Record<string, unknown>> } => JSON.parse(rawFile())
const rawAi = (): Record<string, unknown> => rawJson().settings!.ai
const seedFile = (body: unknown): void =>
  writeFileSync(file, typeof body === 'string' ? body : JSON.stringify(body))

let warn: ReturnType<typeof vi.spyOn>
let error: ReturnType<typeof vi.spyOn>

const logged = (spy: ReturnType<typeof vi.spyOn>): string =>
  spy.mock.calls.map((args: unknown[]) => args.map((a) => (a instanceof Error ? a.message : String(a))).join(' ')).join('\n')

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'racedeck-secret-'))
  file = join(dir, 'racedeck.json')
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  error = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  warn.mockRestore()
  error.mockRestore()
  rmSync(dir, { recursive: true, force: true })
})

describe('AI key encryption at rest', () => {
  it('writes only ciphertext to disk and hands the renderer the plaintext shape back', () => {
    const layer = new PersistenceLayer({ cwd: dir, safeStorage: fakeCipher() })

    layer.set('settings', 'ai', aiConfig(KEY))

    expect(rawFile()).not.toContain(KEY)
    expect(rawAi().apiKey).toBeUndefined()
    expect(typeof rawAi().apiKeyEnc).toBe('string')
    expect(rawAi()).toMatchObject({ provider: 'openai', model: 'gpt-4o-mini', enabled: true })
    expect(layer.get('settings', 'ai')).toEqual(aiConfig(KEY))
  })

  it('stores ciphertext as base64 of the encrypted bytes', () => {
    const cipher = fakeCipher()
    const layer = new PersistenceLayer({ cwd: dir, safeStorage: cipher })

    layer.set('settings', 'ai', aiConfig(KEY))

    const bytes = Buffer.from(rawAi().apiKeyEnc as string, 'base64')
    expect(cipher.decryptString(bytes)).toBe(KEY)
  })

  it('survives a restart: a new layer over the same file decrypts the key', () => {
    new PersistenceLayer({ cwd: dir, safeStorage: fakeCipher() }).set('settings', 'ai', aiConfig(KEY))

    const reopened = new PersistenceLayer({ cwd: dir, safeStorage: fakeCipher() })

    expect(reopened.get('settings', 'ai')).toEqual(aiConfig(KEY))
  })

  it('decrypts the ai entry in all(settings) and leaves other entries alone', () => {
    const layer = new PersistenceLayer({ cwd: dir, safeStorage: fakeCipher() })
    layer.set('settings', 'theme', 'dark')
    layer.set('settings', 'ai', aiConfig(KEY))

    expect(layer.all('settings')).toEqual({ theme: 'dark', ai: aiConfig(KEY) })
    expect(rawFile()).not.toContain(KEY)
  })

  it('stores no ciphertext for an empty key', () => {
    const layer = new PersistenceLayer({ cwd: dir, safeStorage: fakeCipher() })

    layer.set('settings', 'ai', aiConfig(''))

    expect(rawAi().apiKeyEnc).toBeUndefined()
    expect(layer.get('settings', 'ai')).toEqual(aiConfig(''))
  })

  it('replaces the ciphertext when the key changes and drops it when the key is cleared', () => {
    const layer = new PersistenceLayer({ cwd: dir, safeStorage: fakeCipher() })
    layer.set('settings', 'ai', aiConfig(KEY))
    const first = rawAi().apiKeyEnc

    layer.set('settings', 'ai', aiConfig('sk-other-key'))
    expect(rawAi().apiKeyEnc).not.toBe(first)
    expect(layer.get<{ apiKey: string }>('settings', 'ai')!.apiKey).toBe('sk-other-key')

    layer.set('settings', 'ai', aiConfig(''))
    expect(rawAi().apiKeyEnc).toBeUndefined()
    expect(layer.get<{ apiKey: string }>('settings', 'ai')!.apiKey).toBe('')
  })

  it('does not trust an apiKeyEnc field supplied by the caller', () => {
    const layer = new PersistenceLayer({ cwd: dir, safeStorage: fakeCipher() })

    layer.set('settings', 'ai', { ...aiConfig(''), apiKeyEnc: 'Zm9yZ2Vk' })

    expect(rawAi().apiKeyEnc).toBeUndefined()
  })

  it('only protects settings/ai; other values are stored verbatim', () => {
    const layer = new PersistenceLayer({ cwd: dir, safeStorage: fakeCipher() })

    layer.set('settings', 'theme', 'dark')
    layer.set('layouts', 'ai', aiConfig(KEY))

    expect(rawJson().settings!.theme).toBe('dark')
    expect((JSON.parse(rawFile()) as { layouts: { ai: unknown } }).layouts.ai).toEqual(aiConfig(KEY))
  })
})

describe('legacy plaintext migration', () => {
  it('returns a legacy plaintext key as-is and re-writes it encrypted on first read', () => {
    seedFile({ settings: { ai: aiConfig(KEY) } })
    expect(rawFile()).toContain(KEY)
    const layer = new PersistenceLayer({ cwd: dir, safeStorage: fakeCipher() })

    expect(layer.get('settings', 'ai')).toEqual(aiConfig(KEY))

    expect(rawFile()).not.toContain(KEY)
    expect(typeof rawAi().apiKeyEnc).toBe('string')
    expect(layer.get('settings', 'ai')).toEqual(aiConfig(KEY))
  })

  it('also migrates when the legacy entry is first read through all()', () => {
    seedFile({ settings: { theme: 'dark', ai: aiConfig(KEY) } })
    const layer = new PersistenceLayer({ cwd: dir, safeStorage: fakeCipher() })

    expect(layer.all('settings')).toEqual({ theme: 'dark', ai: aiConfig(KEY) })

    expect(rawFile()).not.toContain(KEY)
  })

  it('does not rewrite a legacy entry that has an empty key', () => {
    seedFile({ settings: { ai: aiConfig('') } })
    const cipher = fakeCipher()
    const layer = new PersistenceLayer({ cwd: dir, safeStorage: cipher })

    expect(layer.get('settings', 'ai')).toEqual(aiConfig(''))
    expect(cipher.encryptCalls).toBe(0)
  })

  it('prefers a non-empty plaintext key over stale ciphertext (written while encryption was unavailable)', () => {
    const cipher = fakeCipher()
    const layer = new PersistenceLayer({ cwd: dir, safeStorage: cipher })
    layer.set('settings', 'ai', aiConfig('sk-old'))
    const stale = rawAi().apiKeyEnc
    seedFile({ settings: { ai: { ...aiConfig(KEY), apiKeyEnc: stale } } })

    expect(layer.get<{ apiKey: string }>('settings', 'ai')!.apiKey).toBe(KEY)
    expect(rawFile()).not.toContain(KEY)
  })

  it('keeps the plaintext (no key lost) if migration encryption fails', () => {
    seedFile({ settings: { ai: aiConfig(KEY) } })
    const cipher = fakeCipher()
    cipher.broken = true
    const layer = new PersistenceLayer({ cwd: dir, safeStorage: cipher })

    expect(layer.get('settings', 'ai')).toEqual(aiConfig(KEY))

    expect(rawAi().apiKey).toBe(KEY)
    expect(error).toHaveBeenCalled()
    expect(logged(error)).not.toContain(KEY)
  })
})

describe('encryption unavailable', () => {
  it('falls back to plaintext exactly as before and warns exactly once', () => {
    const cipher = fakeCipher()
    cipher.available = false
    const layer = new PersistenceLayer({ cwd: dir, safeStorage: cipher })

    layer.set('settings', 'ai', aiConfig(KEY))
    layer.set('settings', 'ai', aiConfig(KEY))
    layer.get('settings', 'ai')
    layer.all('settings')

    expect(rawAi()).toEqual(aiConfig(KEY))
    expect(layer.get('settings', 'ai')).toEqual(aiConfig(KEY))
    expect(warn).toHaveBeenCalledTimes(1)
    expect(logged(warn)).not.toContain(KEY)
  })

  it('leaves a legacy plaintext key in place when nothing can encrypt it', () => {
    seedFile({ settings: { ai: aiConfig(KEY) } })
    const cipher = fakeCipher()
    cipher.available = false
    const layer = new PersistenceLayer({ cwd: dir, safeStorage: cipher })

    expect(layer.get('settings', 'ai')).toEqual(aiConfig(KEY))
    expect(rawAi()).toEqual(aiConfig(KEY))
  })

  it('encrypts a plaintext key once encryption becomes available later', () => {
    const cipher = fakeCipher()
    cipher.available = false
    const layer = new PersistenceLayer({ cwd: dir, safeStorage: cipher })
    layer.set('settings', 'ai', aiConfig(KEY))
    expect(rawFile()).toContain(KEY)

    cipher.available = true

    expect(layer.get('settings', 'ai')).toEqual(aiConfig(KEY))
    expect(rawFile()).not.toContain(KEY)
  })

  it('does not warn when there is no key to protect', () => {
    const cipher = fakeCipher()
    cipher.available = false
    const layer = new PersistenceLayer({ cwd: dir, safeStorage: cipher })

    layer.set('settings', 'ai', aiConfig(''))
    layer.get('settings', 'ai')

    expect(warn).not.toHaveBeenCalled()
  })

  it('falls back to plaintext (and logs) if encrypting throws, rather than losing the key', () => {
    const cipher = fakeCipher()
    cipher.broken = true
    const layer = new PersistenceLayer({ cwd: dir, safeStorage: cipher })

    layer.set('settings', 'ai', aiConfig(KEY))

    expect(layer.get('settings', 'ai')).toEqual(aiConfig(KEY))
    expect(error).toHaveBeenCalled()
    expect(logged(error)).not.toContain(KEY)
  })

  it('treats a missing or throwing availability probe as unavailable', () => {
    const throwing: SecretCipher = {
      isEncryptionAvailable: () => {
        throw new Error('not ready')
      },
      encryptString: () => Buffer.alloc(0),
      decryptString: () => ''
    }
    const layer = new PersistenceLayer({ cwd: dir, safeStorage: throwing })

    layer.set('settings', 'ai', aiConfig(KEY))

    expect(layer.get('settings', 'ai')).toEqual(aiConfig(KEY))
  })

  it('does not touch Electron safeStorage at import or construction (plain-string electron under vitest)', () => {
    const layer = new PersistenceLayer({ cwd: dir })

    layer.set('settings', 'ai', aiConfig(KEY))

    expect(layer.get('settings', 'ai')).toEqual(aiConfig(KEY))
    expect(warn).toHaveBeenCalledTimes(1)
  })
})

describe('decryption failure', () => {
  it('returns an empty key for another profile, keeps the ciphertext, logs no secrets', () => {
    new PersistenceLayer({ cwd: dir, safeStorage: fakeCipher(0x11) }).set('settings', 'ai', aiConfig(KEY))
    const ciphertext = rawAi().apiKeyEnc as string
    const other = new PersistenceLayer({ cwd: dir, safeStorage: fakeCipher(0x22) })

    expect(other.get('settings', 'ai')).toEqual(aiConfig(''))
    other.get('settings', 'ai')
    other.all('settings')

    expect(rawAi().apiKeyEnc).toBe(ciphertext)
    expect(error).toHaveBeenCalledTimes(1)
    expect(logged(error)).toContain('settings/ai')
    expect(logged(error)).not.toContain(KEY)
    expect(logged(error)).not.toContain(ciphertext)
  })

  it('becomes readable again when the original profile returns', () => {
    new PersistenceLayer({ cwd: dir, safeStorage: fakeCipher(0x11) }).set('settings', 'ai', aiConfig(KEY))
    new PersistenceLayer({ cwd: dir, safeStorage: fakeCipher(0x22) }).get('settings', 'ai')

    const back = new PersistenceLayer({ cwd: dir, safeStorage: fakeCipher(0x11) })

    expect(back.get('settings', 'ai')).toEqual(aiConfig(KEY))
  })

  it('does not destroy undecryptable ciphertext when the renderer saves other settings with the empty key', () => {
    new PersistenceLayer({ cwd: dir, safeStorage: fakeCipher(0x11) }).set('settings', 'ai', aiConfig(KEY))
    const ciphertext = rawAi().apiKeyEnc
    const other = new PersistenceLayer({ cwd: dir, safeStorage: fakeCipher(0x22) })

    other.set('settings', 'ai', { ...aiConfig(''), model: 'other-model' })

    expect(rawAi().apiKeyEnc).toBe(ciphertext)
    expect(rawAi().model).toBe('other-model')
    expect(new PersistenceLayer({ cwd: dir, safeStorage: fakeCipher(0x11) }).get('settings', 'ai')).toEqual({
      ...aiConfig(KEY),
      model: 'other-model'
    })
  })

  it('lets the user replace an undecryptable key by entering a new one', () => {
    new PersistenceLayer({ cwd: dir, safeStorage: fakeCipher(0x11) }).set('settings', 'ai', aiConfig(KEY))
    const other = new PersistenceLayer({ cwd: dir, safeStorage: fakeCipher(0x22) })

    other.set('settings', 'ai', aiConfig('sk-new-key'))

    expect(other.get('settings', 'ai')).toEqual(aiConfig('sk-new-key'))
    expect(rawFile()).not.toContain('sk-new-key')
  })

  it('returns an empty key for corrupted ciphertext instead of throwing', () => {
    seedFile({ settings: { ai: { ...aiConfig(''), apiKey: undefined, apiKeyEnc: '!!!not-base64-or-valid!!!' } } })
    const layer = new PersistenceLayer({ cwd: dir, safeStorage: fakeCipher() })

    expect(layer.get('settings', 'ai')).toEqual(aiConfig(''))
    expect(error).toHaveBeenCalled()
    expect(logged(error)).not.toContain('!!!not-base64-or-valid!!!')
  })

  it('returns an empty key when ciphertext exists but encryption is unavailable, without erasing it', () => {
    new PersistenceLayer({ cwd: dir, safeStorage: fakeCipher() }).set('settings', 'ai', aiConfig(KEY))
    const ciphertext = rawAi().apiKeyEnc
    const cipher = fakeCipher()
    cipher.available = false
    const layer = new PersistenceLayer({ cwd: dir, safeStorage: cipher })

    expect(layer.get('settings', 'ai')).toEqual(aiConfig(''))
    expect(rawAi().apiKeyEnc).toBe(ciphertext)
  })
})

describe('malformed stored values', () => {
  it.each([
    ['a string', 'oops'],
    ['a number', 7],
    ['null', null],
    ['an array', [1, 2]]
  ])('does not throw when settings/ai is %s', (_label, stored) => {
    seedFile({ settings: { ai: stored } })
    const layer = new PersistenceLayer({ cwd: dir, safeStorage: fakeCipher() })

    expect(() => layer.get('settings', 'ai')).not.toThrow()
    expect(() => layer.all('settings')).not.toThrow()
    expect(layer.get('settings', 'ai')).toEqual(stored)
  })

  it.each([
    ['a number', 42],
    ['an object', { x: 1 }],
    ['an empty string', '']
  ])('treats a non-usable apiKeyEnc (%s) as no key', (_label, enc) => {
    seedFile({ settings: { ai: { ...aiConfig(''), apiKeyEnc: enc } } })
    const layer = new PersistenceLayer({ cwd: dir, safeStorage: fakeCipher() })

    expect(layer.get('settings', 'ai')).toEqual(aiConfig(''))
  })

  it('treats a non-string apiKey as no key and never migrates it', () => {
    seedFile({ settings: { ai: { ...aiConfig(''), apiKey: 12345 } } })
    const cipher = fakeCipher()
    const layer = new PersistenceLayer({ cwd: dir, safeStorage: cipher })

    expect(layer.get<{ apiKey: string }>('settings', 'ai')!.apiKey).toBe('')
    expect(cipher.encryptCalls).toBe(0)
  })

  it('stores a non-object settings/ai value verbatim', () => {
    const layer = new PersistenceLayer({ cwd: dir, safeStorage: fakeCipher() })

    layer.set('settings', 'ai', 'not-an-object')

    expect(layer.get('settings', 'ai')).toBe('not-an-object')
  })

  it('returns null when settings/ai was never stored, and {} for an empty namespace', () => {
    const layer = new PersistenceLayer({ cwd: dir, safeStorage: fakeCipher() })

    expect(layer.get('settings', 'ai')).toBeNull()
    expect(layer.all('settings')).toEqual({})
  })
})
