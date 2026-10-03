import type { F1StreamPoint } from '@shared/f1live'
import type { FeedAnomalies, FeedAnomalyReason, FeedQualityReport } from '../types'
import { CHECK_IDS, checkFeed, checkProblem, type CheckId, type FeedSink } from './feedChecks'
import { FEED_VALIDATORS } from './feedValidators'

/** Shared by every clean tracker: nothing to report, nothing to allocate. */
export const EMPTY_FEED_QUALITY: FeedQualityReport = Object.freeze({
  totalAnomalies: 0,
  feeds: Object.freeze([]) as unknown as FeedAnomalies[]
})

interface Counter {
  seen: number
  bad: number
  /** First anomaly of this check, kept so the report can show what it looked like. */
  example: string | null
}

const EXAMPLE_VALUE_MAX = 24

/** A short, safe rendering of a remote value: never the raw payload, never a throw. */
function describeValue(value: unknown): string {
  if (value === undefined) return 'missing'
  if (typeof value === 'string') {
    const text = value.length > EXAMPLE_VALUE_MAX ? `${value.slice(0, EXAMPLE_VALUE_MAX)}…` : value
    return JSON.stringify(text)
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return 'a list'
  return value === null ? 'null' : 'an object'
}

function describeExample(key: string, field: string | undefined, value: unknown): string {
  const where = [key && `#${key}`, field].filter(Boolean).join(' ')
  return `${where ? `${where}: ` : ''}${describeValue(value)}`
}

function newCounters(): Record<CheckId, Counter> {
  const counters = {} as Record<CheckId, Counter>
  for (const id of CHECK_IDS) counters[id] = { seen: 0, bad: 0, example: null }
  return counters
}

/**
 * Counts shape anomalies in the F1 feeds as points arrive at the provider.
 *
 * Diagnostic only. It reads each point once, never mutates it, and holds nothing
 * per entry: memory is one small counter per check id, so it is bounded whatever
 * the session length. A validator fault is contained here rather than being
 * allowed to break a session load.
 */
export class FeedQualityTracker implements FeedSink {
  private counters = newCounters()
  private cached: FeedQualityReport | null = EMPTY_FEED_QUALITY
  private faults = 0

  check(id: CheckId, bad: boolean, key: string, value: unknown, field?: string): void {
    const counter = this.counters[id]
    counter.seen++
    if (!bad) return
    counter.bad++
    counter.example ??= describeExample(key, field, value)
  }

  /** Validate newly arrived points of one topic. Topics without a validator are ignored. */
  observe(topic: string, points: readonly F1StreamPoint[] | undefined): void {
    const validate = FEED_VALIDATORS.get(topic)
    if (!validate || !points || points.length === 0) return
    this.cached = null
    try {
      for (const point of points) validate(point.d, this)
    } catch {
      // A validator must never break loading; the count of faults is for tests.
      this.faults++
    }
  }

  /** Validate every tracked topic of a whole session payload. */
  observeStreams(streams: Readonly<Record<string, readonly F1StreamPoint[] | undefined>>): void {
    for (const topic of FEED_VALIDATORS.keys()) this.observe(topic, streams[topic])
  }

  reset(): void {
    this.counters = newCounters()
    this.cached = EMPTY_FEED_QUALITY
    this.faults = 0
  }

  get validatorFaults(): number {
    return this.faults
  }

  report(): FeedQualityReport {
    this.cached ??= this.buildReport()
    return this.cached
  }

  private buildReport(): FeedQualityReport {
    const byFeed = new Map<string, FeedAnomalies>()
    let total = 0
    for (const id of CHECK_IDS) {
      const { seen, bad, example } = this.counters[id]
      if (bad === 0) continue
      const feed = checkFeed(id)
      const entry = byFeed.get(feed) ?? { feed, anomalies: 0, reasons: [] }
      const reason: FeedAnomalyReason = {
        problem: checkProblem(id),
        count: bad,
        checked: seen,
        example
      }
      entry.anomalies += bad
      entry.reasons.push(reason)
      byFeed.set(feed, entry)
      total += bad
    }
    if (total === 0) return EMPTY_FEED_QUALITY
    const feeds = [...byFeed.values()].sort((a, b) => b.anomalies - a.anomalies)
    for (const feed of feeds) feed.reasons.sort((a, b) => b.count - a.count)
    return { totalAnomalies: total, feeds }
  }
}
