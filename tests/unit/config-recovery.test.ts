import {
  copyFileSync,
  mkdtempSync,
  existsSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { backupIfCorrupt } from '../../src/main/config-recovery'
import { PersistenceLayer } from '../../src/main/persistence'

let dir: string
let file: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'racedeck-config-'))
  file = join(dir, 'racedeck.json')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('backupIfCorrupt', () => {
  it('does nothing when there is no config file yet (first launch)', () => {
    expect(backupIfCorrupt(file)).toBeNull()
    expect(readdirSync(dir)).toEqual([])
  })

  it('leaves a healthy config untouched', () => {
    const healthy = JSON.stringify({ settings: { theme: 'dark' } })
    writeFileSync(file, healthy)

    expect(backupIfCorrupt(file)).toBeNull()
    expect(readFileSync(file, 'utf8')).toBe(healthy)
  })

  it('treats an empty file as nothing to recover', () => {
    writeFileSync(file, '  \n')

    expect(backupIfCorrupt(file)).toBeNull()
    expect(existsSync(file)).toBe(true)
  })

  it('moves a config that is not valid JSON aside, byte for byte', () => {
    const broken = '{"settings": {"theme": "dark"'
    writeFileSync(file, broken)

    const recovery = backupIfCorrupt(file, () => 1_700_000_000_000)

    expect(recovery?.backupPath).toBe(join(dir, 'racedeck.corrupt-1700000000000.json'))
    expect(existsSync(file)).toBe(false)
    expect(readFileSync(recovery!.backupPath, 'utf8')).toBe(broken)
  })

  it.each([
    ['an array', '[1, 2, 3]'],
    ['a string', '"hello"'],
    ['null', 'null']
  ])('treats valid JSON that is %s as corrupt, since the store needs an object', (_l, body) => {
    writeFileSync(file, body)

    expect(backupIfCorrupt(file)).not.toBeNull()
    expect(existsSync(file)).toBe(false)
  })

  it('never overwrites an earlier backup made in the same millisecond', () => {
    writeFileSync(file, '{ first')
    const first = backupIfCorrupt(file, () => 42)
    writeFileSync(file, '{ second')
    const second = backupIfCorrupt(file, () => 42)

    expect(second?.backupPath).not.toBe(first?.backupPath)
    expect(readFileSync(first!.backupPath, 'utf8')).toBe('{ first')
    expect(readFileSync(second!.backupPath, 'utf8')).toBe('{ second')
  })
})

describe('backupIfCorrupt when the rename is blocked', () => {
  const broken = '{"layouts": {"saved": [1,2'
  const busy = (): never => {
    throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' })
  }

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // Windows AV / backup software commonly holds a just-written file open, which
  // fails a rename. Giving up there made the store reset the file: the only copy
  // of the user's layouts, sync offsets and AI settings was destroyed.
  it('falls back to copying the file aside, leaving the original in place', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    writeFileSync(file, broken)

    const recovery = backupIfCorrupt(file, () => 7, { renameSync: busy, copyFileSync })

    expect(recovery?.backupPath).toBe(join(dir, 'racedeck.corrupt-7.json'))
    expect(readFileSync(recovery!.backupPath, 'utf8')).toBe(broken)
    expect(readFileSync(file, 'utf8')).toBe(broken)
  })

  it('reports null and logs when the copy fails as well', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    writeFileSync(file, broken)

    const recovery = backupIfCorrupt(file, () => 7, { renameSync: busy, copyFileSync: busy })

    expect(recovery).toBeNull()
    expect(error).toHaveBeenCalledTimes(1)
    expect(String(error.mock.calls[0][0])).toContain(file)
    expect(readdirSync(dir)).toEqual(['racedeck.json'])
  })

  it('does not leave a half-written backup behind when the copy fails', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    writeFileSync(file, broken)
    const failingCopy = (_src: string, dest: string): void => {
      writeFileSync(dest, 'partial')
      busy()
    }

    expect(backupIfCorrupt(file, () => 7, { renameSync: busy, copyFileSync: failingCopy })).toBeNull()
    expect(readdirSync(dir)).toEqual(['racedeck.json'])
  })

  it('does not use the copy fallback when the rename succeeds', () => {
    writeFileSync(file, broken)
    const copy = vi.fn()

    const recovery = backupIfCorrupt(file, () => 7, { renameSync, copyFileSync: copy })

    expect(recovery).not.toBeNull()
    expect(copy).not.toHaveBeenCalled()
    expect(existsSync(file)).toBe(false)
  })
})

describe('PersistenceLayer recovery', () => {
  it('starts clean and reports no recovery when the file is healthy', () => {
    const layer = new PersistenceLayer({ cwd: dir })

    expect(layer.recovery).toBeNull()
    layer.set('settings', 'theme', 'dark')
    expect(layer.get('settings', 'theme')).toBe('dark')
  })

  it('keeps a copy of a corrupt file, boots with defaults, and reports where the copy went', () => {
    const broken = '{"layouts": {"saved": [1,2'
    writeFileSync(file, broken)

    const layer = new PersistenceLayer({ cwd: dir })

    expect(layer.recovery).not.toBeNull()
    expect(readFileSync(layer.recovery!.backupPath, 'utf8')).toBe(broken)
    expect(layer.get('layouts', 'saved')).toBeNull()
    layer.set('layouts', 'saved', ['ok'])
    expect(layer.get('layouts', 'saved')).toEqual(['ok'])
    expect(JSON.parse(readFileSync(file, 'utf8')).layouts.saved).toEqual(['ok'])
  })
})
