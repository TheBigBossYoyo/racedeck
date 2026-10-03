import type { F1StreamPoint } from '@shared/f1live'
import type { DriverFeedFreshness, DriverFeedTopic } from './types'

/**
 * Remembers, per driver and per raw feed, when that driver's own data last
 * arrived — the per-driver counterpart of the provider's per-topic wall-clock
 * stamps (roadmap P0 item 5; IMPROVEMENT_OPPORTUNITIES.md item #12).
 *
 * It stores stream time (`point.t`), not wall-clock time. A driver's age is then
 * "how far behind the feed's newest point their newest point is", plus the
 * feed's own wall-clock age. That stays right when a poll delivers a whole
 * buffer at once (first poll, socket reconnect), where stamping "now" on every
 * driver would call a car that went quiet ten minutes ago fresh.
 *
 * Live only: the provider never feeds it archive data, since a replay's clock is
 * the scrub position and nothing can be stale against it.
 */

export const DRIVER_FEED_TOPICS: readonly DriverFeedTopic[] = ['TimingData', 'Position', 'CarData']

interface TopicState {
  /** Newest stream time each driver appeared at. */
  lastT: Map<number, number>
  /** Stream time of the feed's newest point, or null before any. */
  headT: number | null
}

const NUMERIC_KEY = /^\d+$/

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

/** Visit each numeric key of `value`'s object whose value is itself an object. */
function forEachDriver(value: unknown, visit: (driver: number) => void): void {
  const obj = record(value)
  if (!obj) return
  for (const key in obj) {
    if (NUMERIC_KEY.test(key) && record(obj[key])) visit(+key)
  }
}

/** Visit each element of an array, or numerically-keyed object, of batches. */
function forEachBatch(value: unknown, visit: (batch: unknown) => void): void {
  if (Array.isArray(value)) {
    for (const batch of value) visit(batch)
    return
  }
  const obj = record(value)
  if (!obj) return
  for (const key in obj) if (NUMERIC_KEY.test(key)) visit(obj[key])
}

/** Call `visit` with every driver number that has data in this point. */
function driversIn(topic: DriverFeedTopic, point: F1StreamPoint, visit: (n: number) => void): void {
  const payload = record(point.d)
  if (!payload) return
  if (topic === 'TimingData') {
    forEachDriver(payload.Lines, visit)
  } else if (topic === 'Position') {
    forEachBatch(payload.Position, (batch) => forEachDriver(record(batch)?.Entries, visit))
  } else {
    forEachBatch(payload.Entries, (entry) => forEachDriver(record(entry)?.Cars, visit))
  }
}

export class DriverFeedTracker {
  private topics = new Map<DriverFeedTopic, TopicState>()

  reset(): void {
    this.topics.clear()
  }

  /**
   * Fold points into a topic. `replace` means `points` is the feed's whole
   * current buffer (so earlier state is dropped); otherwise they are new points
   * appended after what was already observed.
   */
  observe(topic: DriverFeedTopic, points: readonly F1StreamPoint[], replace: boolean): void {
    if (points.length === 0) return
    let state = this.topics.get(topic)
    if (!state || replace) {
      state = { lastT: new Map(), headT: null }
      this.topics.set(topic, state)
    }
    const lastT = state.lastT
    for (const point of points) {
      driversIn(topic, point, (driver) => {
        const seen = lastT.get(driver)
        if (seen === undefined || point.t > seen) lastT.set(driver, point.t)
      })
      if (state.headT === null || point.t > state.headT) state.headT = point.t
    }
  }

  /**
   * Age in ms of each known driver's newest data per topic. `feedAgeMs` is each
   * topic's wall-clock age (`feedFreshness`); a topic without one is skipped,
   * because without it no wall-clock age can be stated honestly.
   */
  ages(feedAgeMs: Record<string, number>): Record<number, DriverFeedFreshness> {
    const out: Record<number, DriverFeedFreshness> = {}
    for (const [topic, state] of this.topics) {
      const feedAge = feedAgeMs[topic]
      if (feedAge === undefined || state.headT === null) continue
      for (const [driver, lastT] of state.lastT) {
        const entry = out[driver] ?? (out[driver] = {})
        entry[topic] = feedAge + Math.max(0, state.headT - lastT) * 1000
      }
    }
    return out
  }
}
