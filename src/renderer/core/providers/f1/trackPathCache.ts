import { rec } from './shared'

/**
 * The persisted circuit-outline cache: one entry per race weekend, so a later
 * session at the same circuit can seed its map before any car has closed a lap.
 * Moved verbatim from F1LiveProvider.ts; `F1LiveProvider` re-exports
 * `TRACK_PATH_CACHE_SCHEMA_VERSION` and `saveBoundedTrackPath`.
 *
 * Persistence is injected (`TrackPathCacheStorage`) so the data layer never imports
 * a store; the persist-backed implementation lives in `persistTrackPathStorage.ts`.
 */

/**
 * The key/value operations the cache needs, already scoped to the track-path
 * namespace. Keys are the flat meeting keys below plus the recency index.
 */
export interface TrackPathCacheStorage {
  get(key: string): Promise<unknown | null>
  set(key: string, value: unknown): Promise<void>
  remove(key: string): Promise<void>
  all(): Promise<Record<string, unknown>>
}

/**
 * Upper bound accepted from the persisted outline cache. Matches the tracer's
 * own point budget, so a trace of a long circuit is not rejected on read-back.
 */
const TRACK_PATH_CACHE_MAX = 700

/**
 * Bump when the shape of a cached track-path entry changes, OR when the
 * closure algorithm that PRODUCES it changes — a path cached by an older,
 * buggier closer is a stale-shaped entry too, even though it still parses.
 * Included in the cache key so it's treated as a miss (rebuilt from live
 * position data with the current algorithm) rather than silently misread.
 *
 * Bumped 1 -> 2: `buildClosedTrackPath` used to close only against `path[0]`
 * (wherever tracking happened to start), so anyone connecting mid-session
 * could get a false "closed" match on a short, wrong arc near that arbitrary
 * point (or never close at all) — either way, a wrong shape could get cached
 * and then permanently reused (`trackPathClosed` blocks recompute) even
 * after the closure algorithm itself was fixed to check every earlier point.
 *
 * Bumped 2 -> 3: `buildClosedTrackPath` used to return the FIRST valid
 * closure found (smallest search index), not the best one. A pit lane
 * commonly runs close to the main straight, so a reference car that pitted
 * early could close on that short loop before the true lap ever did — and a
 * wrong, incomplete outline (cars racing on the untraced rest of the
 * circuit rendering outside it) got cached exactly like a correct one.
 */
export const TRACK_PATH_CACHE_SCHEMA_VERSION = 3

/**
 * Most circuit outlines kept in the persisted meeting cache. One entry is written
 * per race weekend, so this is well over a season, while stopping the store file
 * growing for the life of the install.
 */
const TRACK_PATH_CACHE_MAX_ENTRIES = 40
/**
 * Key of the recency list (oldest first) that drives eviction; never a meeting key
 * (those always start with `v<schema>/`). It must survive the main process's
 * store-key validator, which reserves the `__` prefix — an earlier `'__index'`
 * was rejected there, silently disabling eviction.
 */
export const TRACK_PATH_INDEX_KEY = '~index'

/**
 * Meeting-scoped store key: same weekend ⇒ same physical circuit layout.
 *
 * A LIVE session's id is the literal "live", which yields no meeting and so
 * previously locked live sessions out of this cache in both directions — the
 * live map had to wait for a car to complete a whole lap before an outline
 * existed, even when the same circuit had just been replayed. `feedPath` is the
 * live feed's own archive path, so live now shares the weekend's cache entry.
 */
export function trackPathCacheKey(sessionId: string, feedPath?: string | null): string | null {
  const source = sessionId === 'live' ? (feedPath ?? '') : sessionId
  const segments = source.split('/').filter(Boolean)
  if (segments.length < 2) return null
  // electron-store paths split on dots; keep the key flat.
  const meetingKey = segments.slice(0, 2).join('/').replace(/\./g, '_')
  return `v${TRACK_PATH_CACHE_SCHEMA_VERSION}/${meetingKey}`
}

export async function loadCachedTrackPath(
  storage: TrackPathCacheStorage,
  sessionId: string,
  feedPath?: string | null
): Promise<{ x: number; y: number }[] | null> {
  try {
    const key = trackPathCacheKey(sessionId, feedPath)
    if (!key) return null
    const value = await storage.get(key)
    if (!Array.isArray(value) || value.length < 20 || value.length > TRACK_PATH_CACHE_MAX)
      return null
    const path: { x: number; y: number }[] = []
    for (const raw of value) {
      const point = rec(raw)
      const x = point.x
      const y = point.y
      if (typeof x !== 'number' || typeof y !== 'number' || !isFinite(x) || !isFinite(y))
        return null
      path.push({ x, y })
    }
    const first = path[0]
    const last = path[path.length - 1]
    if (!first || !last || first.x !== last.x || first.y !== last.y) return null
    return path
  } catch {
    return null
  }
}

/** The cache bound to one storage — what `F1LiveProvider` holds. */
export class TrackPathCache {
  private readonly storage: TrackPathCacheStorage

  constructor(storage: TrackPathCacheStorage) {
    this.storage = storage
  }

  load(sessionId: string, feedPath?: string | null): Promise<{ x: number; y: number }[] | null> {
    return loadCachedTrackPath(this.storage, sessionId, feedPath)
  }

  save(sessionId: string | undefined, feedPath: string | null, path: { x: number; y: number }[]): void {
    if (!sessionId || path.length < 20) return
    // Live sessions may now SAVE too (keyed by the feed's own path), so the
    // outline traced during FP1 is instantly available to FP2 and the race.
    const key = trackPathCacheKey(sessionId, feedPath)
    if (!key) return
    void saveBoundedTrackPathTo(this.storage, key, path)
  }
}

/** Serializes cache writes so two closures finishing together can't interleave read-modify-write. */
let trackPathWrites: Promise<void> = Promise.resolve()

/**
 * Persist a circuit outline under its meeting key and evict beyond
 * TRACK_PATH_CACHE_MAX_ENTRIES, oldest first. Entries written under an older
 * cache schema are unreadable (the version is part of the key), so they always go.
 * Exported for tests.
 */
export function saveBoundedTrackPathTo(
  storage: TrackPathCacheStorage,
  key: string,
  path: { x: number; y: number }[]
): Promise<void> {
  trackPathWrites = trackPathWrites
    .then(() => writeTrackPath(storage, key, path))
    .catch((err: unknown) => {
      console.error(`[track-path-cache] could not persist/evict outline ${key}:`, err)
    })
  return trackPathWrites
}

async function writeTrackPath(
  storage: TrackPathCacheStorage,
  key: string,
  path: { x: number; y: number }[]
): Promise<void> {
  await storage.set(key, path)
  const recency = [...(await readTrackPathIndex(storage)).filter((k) => k !== key), key]
  const currentPrefix = `v${TRACK_PATH_CACHE_SCHEMA_VERSION}/`
  const stale = recency.filter((k) => !k.startsWith(currentPrefix))
  const current = recency.filter((k) => k.startsWith(currentPrefix))
  const overflow = Math.max(0, current.length - TRACK_PATH_CACHE_MAX_ENTRIES)
  const evicted = [...stale, ...current.slice(0, overflow)]
  await Promise.all(evicted.map((k) => storage.remove(k)))
  await storage.set(TRACK_PATH_INDEX_KEY, current.slice(overflow))
}

async function readTrackPathIndex(storage: TrackPathCacheStorage): Promise<string[]> {
  const stored = await storage.get(TRACK_PATH_INDEX_KEY)
  if (Array.isArray(stored) && stored.every((k) => typeof k === 'string')) return stored
  // No index yet (first write since eviction existed): adopt what is on disk,
  // in the store's own key order, oldest first.
  const onDisk = await storage.all()
  return Object.keys(onDisk).filter((k) => k !== TRACK_PATH_INDEX_KEY)
}
