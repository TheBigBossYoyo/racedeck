import type { F1StreamPoint } from '@shared/f1live'

/**
 * Bookkeeping over the live socket's stream arrays and per-topic wall-clock
 * stamps. Moved from F1LiveProvider.ts; the provider owns the state passed in.
 */

/** Ms since each topic last received data, as of right now. */
export function computeFeedFreshness(
  feedLastWallClockMs: Record<string, number>
): Record<string, number> {
  const now = Date.now()
  const out: Record<string, number> = {}
  for (const [topic, lastMs] of Object.entries(feedLastWallClockMs)) {
    out[topic] = Math.max(0, now - lastMs)
  }
  return out
}

/** Record that these topics just received data, for stale-feed detection. */
export function stampFeedFreshness(
  feedLastWallClockMs: Record<string, number>,
  streams: Record<string, F1StreamPoint[]>
): void {
  const now = Date.now()
  for (const [topic, points] of Object.entries(streams)) {
    if (points.length > 0) feedLastWallClockMs[topic] = now
  }
}

/**
 * Add newly delivered points to the end of a topic's stream.
 *
 * This runs for every topic in every poll, so copying the whole array each time
 * made a poll cost O(session length). The first append to an array copies it
 * (it may belong to the socket payload or a caller); after that the copy is
 * the provider's alone (`ownedStreams`) and grows in place. Nothing keys on
 * array identity: cursors are indices into an append-only array, and FeedMemo
 * keys on the prefix length plus the last point object.
 */
export function appendToStream(
  ownedStreams: WeakSet<F1StreamPoint[]>,
  existing: F1StreamPoint[] | undefined,
  added: F1StreamPoint[]
): F1StreamPoint[] {
  if (existing && ownedStreams.has(existing)) {
    for (const point of added) existing.push(point)
    return existing
  }
  const owned = existing ? [...existing, ...added] : [...added]
  ownedStreams.add(owned)
  return owned
}
