import { persist } from '@renderer/store/persist'
import { STORE_NS } from '@shared/ipc-contract'
import { saveBoundedTrackPathTo, type TrackPathCacheStorage } from './trackPathCache'

/**
 * The ONE place the provider layer touches the persistence store: the
 * `persist`-backed implementation of `TrackPathCacheStorage`. `DataProviderManager`
 * injects it into `F1LiveProvider`; it is also the constructor's default so a bare
 * `new F1LiveProvider()` (what the unit tests do, with `persist` mocked) still caches.
 * tests/unit/layering.test.ts allowlists exactly this file — drop the default and the
 * allowlist entry together once every caller injects explicitly.
 */
export const persistTrackPathStorage: TrackPathCacheStorage = {
  get: (key) => persist.get<unknown>(STORE_NS.TRACK_PATHS, key),
  set: (key, value) => persist.set(STORE_NS.TRACK_PATHS, key, value),
  remove: (key) => persist.remove(STORE_NS.TRACK_PATHS, key),
  all: () => persist.all<Record<string, unknown>>(STORE_NS.TRACK_PATHS)
}

/** `saveBoundedTrackPathTo` against the persisted store (re-exported by `F1LiveProvider`). */
export function saveBoundedTrackPath(key: string, path: { x: number; y: number }[]): Promise<void> {
  return saveBoundedTrackPathTo(persistTrackPathStorage, key, path)
}
