import type { DriverFeedFreshness, DriverFeedTopic } from '@renderer/core/model/snapshot'

/**
 * Per-driver stale-data thresholds (IMPROVEMENT_OPPORTUNITIES.md item #12).
 *
 * Each equals the threshold the corresponding WHOLE-feed indicator already uses,
 * so a driver is called stale by the same standard the feed is: TimingData in
 * TimingTower (a lower-rate feed), Position in TrackMap, CarData in ErsGauge.
 */
export const DRIVER_STALE_MS: Readonly<Record<DriverFeedTopic, number>> = {
  TimingData: 15_000,
  Position: 5_000,
  CarData: 5_000
}

const TOPICS: readonly DriverFeedTopic[] = ['TimingData', 'Position', 'CarData']

export const DRIVER_FEED_LABEL: Readonly<Record<DriverFeedTopic, string>> = {
  TimingData: 'timing',
  Position: 'position',
  CarData: 'telemetry'
}

export interface StaleDriverFeed {
  feed: DriverFeedTopic
  ageMs: number
}

/**
 * The feeds on which this driver's own data has gone stale, or null if none.
 *
 * Only reported while the feed as a whole is still fresh: when the whole feed
 * has stopped, every driver is old, and the feed-level stale badge (or the
 * per-row telemetry one) already says so — repeating it on every row would bury
 * the case this exists to reveal, one car quiet while the rest are live.
 */
export function staleDriverFeeds(
  driver: DriverFeedFreshness | undefined,
  feedFreshness: Record<string, number> | undefined
): StaleDriverFeed[] | null {
  if (!driver || !feedFreshness) return null
  let stale: StaleDriverFeed[] | null = null
  for (const feed of TOPICS) {
    const ageMs = driver[feed]
    const feedAge = feedFreshness[feed]
    if (ageMs === undefined || feedAge === undefined) continue
    const threshold = DRIVER_STALE_MS[feed]
    if (ageMs < threshold || feedAge >= threshold) continue
    ;(stale ??= []).push({ feed, ageMs })
  }
  return stale
}
