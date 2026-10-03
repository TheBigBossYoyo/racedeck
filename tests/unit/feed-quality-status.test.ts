import { describe, expect, it } from 'vitest'
import {
  FEED_DRIFT_MIN_COUNT,
  FEED_DRIFT_MIN_RATE,
  buildSystemStatus,
  describeFeedQuality,
  isFeedDrifting,
  type SystemStatusInputs
} from '@renderer/core/engines/SystemStatus'
import type { FeedQualityReport } from '@renderer/core/providers/types'

function inputs(overrides: Partial<SystemStatusInputs> = {}): SystemStatusInputs {
  return {
    sessionError: null,
    liveStatus: null,
    loggedIn: true,
    followStatus: 'off',
    followDetail: null,
    drmCapable: false,
    drmReady: false,
    enrichmentIssue: null,
    persistCorruptions: [],
    persistRecoveredBackup: null,
    reconnect: null,
    ...overrides
  }
}

function report(count: number, checked: number, feed = 'TimingData'): FeedQualityReport {
  return {
    totalAnomalies: count,
    feeds: [
      {
        feed,
        anomalies: count,
        reasons: [
          { problem: 'non-numeric lap time', count, checked, example: '#44 LastLapTime: "OUT"' }
        ]
      }
    ]
  }
}

describe('feed data quality status entry', () => {
  it('adds nothing when there are no anomalies (absent, null, empty)', () => {
    expect(buildSystemStatus(inputs())).toEqual([])
    expect(buildSystemStatus(inputs({ feedQuality: null }))).toEqual([])
    expect(buildSystemStatus(inputs({ feedQuality: { totalAnomalies: 0, feeds: [] } }))).toEqual([])
  })

  it('lists a few stray values as an info note that is not an issue', () => {
    const entries = buildSystemStatus(inputs({ feedQuality: report(12, 40_000) }))
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      category: 'feed-quality',
      severity: 'info',
      informational: true,
      recoveryActionId: null
    })
    expect(entries[0].ongoing).toBeUndefined()
    expect(entries[0].message).toBe(
      'Feed data quality: 12 unexpected values in TimingData (non-numeric lap time ×12). First seen: #44 LastLapTime: "OUT".'
    )
  })

  it('uses the singular for one value', () => {
    expect(describeFeedQuality(report(1, 100))).toContain('1 unexpected value in TimingData')
  })

  it('escalates to a warning that counts as an issue only for systematic drift', () => {
    const drifting = buildSystemStatus(inputs({ feedQuality: report(FEED_DRIFT_MIN_COUNT, 200) }))
    expect(drifting[0]).toMatchObject({ severity: 'warning', informational: false })
  })

  it('needs both enough values and a high enough rate', () => {
    // Just under the count, even at a 100% rate: a fluke, not drift.
    expect(isFeedDrifting(report(FEED_DRIFT_MIN_COUNT - 1, FEED_DRIFT_MIN_COUNT - 1))).toBe(false)
    // Plenty of values, but a tiny background rate over a long session.
    expect(isFeedDrifting(report(500, 500 / (FEED_DRIFT_MIN_RATE / 2)))).toBe(false)
    // At both thresholds.
    expect(
      isFeedDrifting(report(FEED_DRIFT_MIN_COUNT, FEED_DRIFT_MIN_COUNT / FEED_DRIFT_MIN_RATE))
    ).toBe(true)
  })

  it('summarises at most two feeds and two reasons each, and says how many more', () => {
    const many: FeedQualityReport = {
      totalAnomalies: 60,
      feeds: ['TimingData', 'Position', 'DriverList'].map((feed, i) => ({
        feed,
        anomalies: 20,
        reasons: [
          { problem: 'a', count: 10, checked: 1e6, example: i === 0 ? 'first' : null },
          { problem: 'b', count: 6, checked: 1e6, example: null },
          { problem: 'c', count: 4, checked: 1e6, example: null }
        ]
      }))
    }
    const message = describeFeedQuality(many)
    expect(message).toContain('20 unexpected values in TimingData (a ×10, b ×6, +1 more)')
    expect(message).toContain('20 unexpected values in Position')
    expect(message).toContain('1 more feed affected')
    expect(message).not.toContain('DriverList')
    expect(message).toContain('First seen: first.')
  })

  it('leaves the other status entries alone', () => {
    const entries = buildSystemStatus(
      inputs({ sessionError: 'boom', feedQuality: report(3, 1000) })
    )
    expect(entries.map((e) => e.category)).toEqual(['provider', 'feed-quality'])
    expect(entries.filter((e) => !e.ongoing && !e.informational)).toHaveLength(1)
  })
})
