import { describe, expect, it, vi } from 'vitest'
import {
  isF1SessionLive,
  isWithinSaneLiveWindow,
  isF1FeedLive,
  feedLocalToUtcMs,
  parseGmtOffsetMs,
  shouldPauseAtDataEdge
} from '../../src/shared/f1-session-state'

describe('f1 session live decision', () => {
  it('waits at a growing live edge but pauses finished and replay providers', () => {
    expect(shouldPauseAtDataEdge('f1live', 'live')).toBe(false)
    expect(shouldPauseAtDataEdge('f1live', '2026/british/practice-1')).toBe(true)
    expect(shouldPauseAtDataEdge('demo', 'live')).toBe(true)
    expect(shouldPauseAtDataEdge('openf1', null)).toBe(true)
  })

  it('treats active SignalR updates as live evidence', () => {
    expect(
      isF1SessionLive({
        path: 'live',
        archiveStatus: null,
        startDate: '2026-07-05T15:00:00Z',
        endDate: '2026-07-05T17:00:00Z',
        liveStreamActive: true
      })
    ).toBe(true)
  })

  it('accepts explicit live archive status only inside a sane session window', () => {
    const nowMs = Date.parse('2026-07-05T15:30:00Z')
    expect(
      isF1SessionLive({
        path: '2026/silverstone/race',
        archiveStatus: 'Generating',
        startDate: '2026-07-05T15:00:00Z',
        endDate: '2026-07-05T17:00:00Z',
        nowMs
      })
    ).toBe(true)
  })

  it('rejects finished or stale sessions even if they are the latest available archive item', () => {
    const nowMs = Date.parse('2026-07-12T12:00:00Z')
    expect(
      isF1SessionLive({
        path: '2026/2026-07-05_British_Grand_Prix/2026-07-05_Race/',
        archiveStatus: 'Generating',
        startDate: '2026-07-05T15:00:00Z',
        endDate: '2026-07-05T17:00:00Z',
        nowMs
      })
    ).toBe(false)
    expect(
      isF1SessionLive({
        path: '2026/2026-07-05_British_Grand_Prix/2026-07-05_Race/',
        archiveStatus: 'Complete',
        startDate: '2026-07-05T15:00:00Z',
        endDate: '2026-07-05T17:00:00Z',
        nowMs
      })
    ).toBe(false)
  })

  it('rejects implausible timestamp windows from synthetic data', () => {
    expect(
      isWithinSaneLiveWindow(
        '2026-07-05T15:00:00Z',
        '2026-07-06T15:30:00Z',
        Date.parse('2026-07-05T16:00:00Z')
      )
    ).toBe(false)
  })

  it('uses the real clock by default', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-05T16:00:00Z'))
    expect(
      isF1SessionLive({
        path: '2026/silverstone/race',
        archiveStatus: 'Live',
        startDate: '2026-07-05T15:00:00Z',
        endDate: '2026-07-05T17:00:00Z'
      })
    ).toBe(true)
    vi.useRealTimers()
  })
})

describe('parseGmtOffsetMs', () => {
  it('parses unsigned, positive, and negative offsets', () => {
    expect(parseGmtOffsetMs('01:00:00')).toBe(3600_000)
    expect(parseGmtOffsetMs('+02:00:00')).toBe(7200_000)
    expect(parseGmtOffsetMs('-04:30:00')).toBe(-16200_000)
    expect(parseGmtOffsetMs(null)).toBe(0)
    expect(parseGmtOffsetMs('garbage')).toBe(0)
  })
})

describe('feedLocalToUtcMs', () => {
  it('shifts a zoneless local time by its GmtOffset to absolute UTC', () => {
    // 17:00 local at +01:00 == 16:00 UTC
    expect(feedLocalToUtcMs('2026-07-05T17:00:00', '01:00:00')).toBe(
      Date.parse('2026-07-05T16:00:00Z')
    )
  })
  it('returns null for missing input', () => {
    expect(feedLocalToUtcMs(null, '01:00:00')).toBeNull()
  })
})

describe('isF1FeedLive', () => {
  // The exact stale snapshot the probe returned when nothing was racing.
  const staleBritishGP = {
    sessionStatus: 'Finalised',
    archiveStatus: 'Complete',
    startDate: '2026-07-05T15:00:00',
    endDate: '2026-07-05T17:00:00',
    gmtOffset: '01:00:00'
  }

  it('rejects a finished, archived session even though the feed served its snapshot', () => {
    expect(isF1FeedLive({ ...staleBritishGP, nowMs: Date.parse('2026-07-12T12:00:00Z') })).toBe(
      false
    )
  })

  it('rejects on Complete archive status alone', () => {
    expect(isF1FeedLive({ archiveStatus: 'Complete', substantiveMessages: 999 })).toBe(false)
  })

  it('rejects on a finished SessionStatus alone', () => {
    expect(isF1FeedLive({ sessionStatus: 'Finalised' })).toBe(false)
    expect(isF1FeedLive({ sessionStatus: 'Ends' })).toBe(false)
    expect(isF1FeedLive({ sessionStatus: 'Inactive' })).toBe(false)
  })

  it('accepts a running session inside its scheduled window', () => {
    expect(
      isF1FeedLive({
        sessionStatus: 'Started',
        archiveStatus: null,
        startDate: '2026-07-05T15:00:00',
        endDate: '2026-07-05T17:00:00',
        gmtOffset: '01:00:00',
        nowMs: Date.parse('2026-07-05T15:30:00Z') // 16:30 local — mid-session
      })
    ).toBe(true)
  })

  it('rejects a not-yet-started session well before its window', () => {
    expect(
      isF1FeedLive({
        sessionStatus: 'Inactive',
        startDate: '2026-07-05T15:00:00',
        endDate: '2026-07-05T17:00:00',
        gmtOffset: '01:00:00',
        nowMs: Date.parse('2026-07-05T09:00:00Z')
      })
    ).toBe(false)
  })

  it('falls back to substantive-message evidence when metadata is sparse', () => {
    expect(isF1FeedLive({ substantiveMessages: 0 })).toBe(false)
    expect(isF1FeedLive({ substantiveMessages: 5 })).toBe(true)
  })
})
