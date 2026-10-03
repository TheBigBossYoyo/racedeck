import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  TRACK_PATH_CACHE_SCHEMA_VERSION,
  TRACK_PATH_INDEX_KEY,
  saveBoundedTrackPathTo,
  trackPathCacheKey,
  type TrackPathCacheStorage
} from '@renderer/core/providers/f1/trackPathCache'
import { toStorageKey } from '../../src/main/ipc/validate'

/**
 * The storage fake here applies the REAL main-process key validator. A fake that
 * accepts any key is what hid the original bug: the recency index was written
 * under a `__`-prefixed key, which the IPC boundary rejects, so eviction never ran
 * in production while every test against a permissive fake passed.
 */

const outline = [{ x: 0, y: 0 }]
const key = (n: number): string => `v${TRACK_PATH_CACHE_SCHEMA_VERSION}/2026/Meeting_${n}`

function validatingStorage(): { storage: TrackPathCacheStorage; disk: Map<string, unknown> } {
  const disk = new Map<string, unknown>()
  const storage: TrackPathCacheStorage = {
    get: async (k) => disk.get(toStorageKey(k)) ?? null,
    set: async (k, v) => {
      disk.set(toStorageKey(k), v)
    },
    remove: async (k) => {
      disk.delete(toStorageKey(k))
    },
    all: async () => Object.fromEntries(disk)
  }
  return { storage, disk }
}

describe('track-path cache eviction against a storage that enforces the IPC key rules', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('uses an index key the IPC validator accepts', () => {
    expect(() => toStorageKey(TRACK_PATH_INDEX_KEY)).not.toThrow()
  })

  it('cannot collide with a real meeting key', () => {
    const real = trackPathCacheKey('2026/2026-07-05_Belgian_Grand_Prix/2026-07-05_Race/')
    expect(real).not.toBeNull()
    expect(real).not.toBe(TRACK_PATH_INDEX_KEY)
    expect(real!.startsWith(`v${TRACK_PATH_CACHE_SCHEMA_VERSION}/`)).toBe(true)
    expect(TRACK_PATH_INDEX_KEY.startsWith('v')).toBe(false)
  })

  it('60 saves leave at most 40 outlines plus the index (<= 41 entries)', async () => {
    const { storage, disk } = validatingStorage()
    for (let n = 0; n < 60; n++) await saveBoundedTrackPathTo(storage, key(n), outline)
    expect(disk.size).toBeLessThanOrEqual(41)
    expect(disk.has(key(0))).toBe(false)
    expect(disk.has(key(19))).toBe(false)
    expect(disk.has(key(20))).toBe(true)
    expect(disk.has(key(59))).toBe(true)
    expect(disk.has(TRACK_PATH_INDEX_KEY)).toBe(true)
    expect(console.error).not.toHaveBeenCalled()
  })

  it('drops entries from older cache schemas', async () => {
    const { storage, disk } = validatingStorage()
    disk.set('v1/2025/Older_Meeting', outline)
    await saveBoundedTrackPathTo(storage, key(1), outline)
    expect([...disk.keys()].sort()).toEqual([TRACK_PATH_INDEX_KEY, key(1)].sort())
  })

  it('logs a write failure once with context instead of swallowing it silently', async () => {
    const { storage } = validatingStorage()
    const failing: TrackPathCacheStorage = {
      ...storage,
      set: async () => {
        throw new Error('disk full')
      }
    }
    await expect(saveBoundedTrackPathTo(failing, key(1), outline)).resolves.toBeUndefined()
    expect(console.error).toHaveBeenCalledTimes(1)
    const [message, err] = (console.error as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(String(message)).toContain('track-path')
    expect(String(message)).toContain(key(1))
    expect((err as Error).message).toBe('disk full')
  })

  it('keeps later saves working after a failed one', async () => {
    const { storage, disk } = validatingStorage()
    const failing: TrackPathCacheStorage = {
      ...storage,
      set: async () => {
        throw new Error('disk full')
      }
    }
    await saveBoundedTrackPathTo(failing, key(1), outline)
    await saveBoundedTrackPathTo(storage, key(2), outline)
    expect(disk.has(key(2))).toBe(true)
  })
})
