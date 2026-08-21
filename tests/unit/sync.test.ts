import { describe, it, expect } from 'vitest'
import {
  candidatesForDisplay,
  syncMath,
  SessionSyncEngine
} from '@renderer/core/engines/SessionSyncEngine'
import type { RaceControlMessage } from '@shared/models'

describe('syncMath', () => {
  it('clamps offsets to the valid bidirectional range', () => {
    expect(syncMath.clampOffset(-200)).toBe(-120)
    expect(syncMath.clampOffset(800)).toBe(600)
    expect(syncMath.clampOffset(42.5)).toBe(42.5)
  })

  it('nudges within range', () => {
    expect(syncMath.adjust(40, 5)).toBe(45)
    expect(syncMath.adjust(598, 5)).toBe(600)
    expect(syncMath.adjust(-118, -5)).toBe(-120)
  })

  it('maps video time to data time and back', () => {
    expect(syncMath.dataTimeForVideo(100, 42)).toBe(58)
    expect(syncMath.dataTimeForVideo(10, 42)).toBe(0) // never negative
    expect(syncMath.dataTimeForVideo(120, -20, 100)).toBe(100) // never past session end
    expect(syncMath.videoTimeForData(58, 42)).toBe(100)
  })

  it('reports the data-time range reachable at each offset', () => {
    expect(syncMath.dataRangeForVideoSession(100, 20)).toEqual({ min: 0, max: 80 })
    expect(syncMath.dataRangeForVideoSession(100, -20)).toEqual({ min: 20, max: 100 })
  })

  it('derives the broadcast delay from a live alignment (edge minus event)', () => {
    // Live edge at 300s; the event the user sees on the delayed video happened
    // at data time 272s → the video is 28s behind, so hold data back 28s.
    expect(syncMath.offsetForLiveAlignment(300, 272)).toBe(28)
    // Never negative when the edge somehow trails the event; clamped to range.
    expect(syncMath.offsetForLiveAlignment(100, 120)).toBe(-20)
    expect(syncMath.offsetForLiveAlignment(10_000, 0)).toBe(600)
  })
})

describe('SessionSyncEngine', () => {
  it('sets, nudges and clamps the offset', () => {
    const e = new SessionSyncEngine()
    expect(e.setOffset(45).offsetSeconds).toBe(45)
    expect(e.nudge(5).offsetSeconds).toBe(50)
    expect(e.nudge(-1000).offsetSeconds).toBe(-120)
  })

  it('builds ranked candidates for direct dashboard alignment', () => {
    const e = new SessionSyncEngine()
    const startMs = 0
    const messages: RaceControlMessage[] = [
      {
        id: 'sc-1',
        date: new Date(58_000).toISOString(), // 58s into session
        category: 'SafetyCar',
        message: 'SAFETY CAR DEPLOYED',
        flag: 'NONE',
        scope: 'Track',
        sector: null,
        driverNumber: null,
        lapNumber: 12,
        severity: 'critical'
      },
      {
        id: 'vsc-1',
        date: new Date(40_000).toISOString(),
        category: 'SafetyCar',
        message: 'VIRTUAL SAFETY CAR DEPLOYED',
        flag: 'NONE',
        scope: 'Track',
        sector: null,
        driverNumber: null,
        lapNumber: 8,
        severity: 'warning'
      }
    ]

    // User marks the safety car on video at live data time = 100s.
    const candidates = e.buildCandidates(messages, 100, startMs, 'safety-car')
    expect(candidates.length).toBe(1) // only the real SC, not the VSC
    expect(candidates[0].dataSec).toBe(58)
    expect(candidates[0].dataSec).toBe(58)
  })

  it('respects the selected event type when matching', () => {
    const e = new SessionSyncEngine()
    const messages: RaceControlMessage[] = [
      {
        id: 'vsc-1',
        date: new Date(40_000).toISOString(),
        category: 'SafetyCar',
        message: 'VIRTUAL SAFETY CAR',
        flag: 'NONE',
        scope: 'Track',
        sector: null,
        driverNumber: null,
        lapNumber: 8,
        severity: 'warning'
      }
    ]
    expect(e.buildCandidates(messages, 100, 0, 'safety-car').length).toBe(0)
    expect(e.buildCandidates(messages, 100, 0, 'vsc').length).toBe(1)
  })

  it('keeps distant replay events available for direct alignment', () => {
    const e = new SessionSyncEngine()
    const message: RaceControlMessage = {
      id: 'late-sc',
      date: new Date(3_600_000).toISOString(),
      category: 'SafetyCar',
      message: 'SAFETY CAR DEPLOYED',
      flag: 'NONE',
      scope: 'Track',
      sector: null,
      driverNumber: null,
      lapNumber: 20,
      severity: 'critical'
    }
    expect(e.buildCandidates([message], 30, 0, 'safety-car')).toHaveLength(1)
  })

  it('keeps every matching event available beyond the compact UI preview', () => {
    const e = new SessionSyncEngine()
    const messages: RaceControlMessage[] = Array.from({ length: 20 }, (_, index) => ({
      id: `yellow-${index}`,
      date: new Date(index * 10_000).toISOString(),
      sessionTime: index * 10,
      category: 'Flag',
      message: `YELLOW IN SECTOR ${index + 1}`,
      flag: 'YELLOW',
      scope: 'Sector',
      sector: index + 1,
      driverNumber: null,
      lapNumber: index + 1,
      severity: 'warning'
    }))
    const candidates = e.buildCandidates(messages, 0, 0, 'yellow-flag')
    expect(candidates).toHaveLength(20)
    expect(candidatesForDisplay(candidates, false)).toHaveLength(12)
    expect(candidatesForDisplay(candidates, true)).toHaveLength(20)
  })

  it('prefers provider session time over scheduled UTC metadata', () => {
    const e = new SessionSyncEngine()
    const message: RaceControlMessage = {
      id: 'feed-sc',
      date: '2024-07-07T14:04:48Z',
      sessionTime: 3591,
      category: 'SafetyCar',
      message: 'SAFETY CAR DEPLOYED',
      flag: 'NONE',
      scope: 'Track',
      sector: null,
      driverNumber: null,
      lapNumber: 2,
      severity: 'critical'
    }
    expect(e.buildCandidates([message], 0, Date.parse('2024-07-07T13:00:00Z'), 'safety-car')[0].dataSec).toBe(3591)
    expect(e.buildCandidates([message], 0, Number.NaN, 'safety-car')[0].dataSec).toBe(3591)
  })

  it('ignores candidates with no valid provider or UTC time', () => {
    const e = new SessionSyncEngine()
    const message: RaceControlMessage = {
      id: 'invalid-time',
      date: 'not-a-date',
      category: 'SafetyCar',
      message: 'SAFETY CAR DEPLOYED',
      flag: 'NONE',
      scope: 'Track',
      sector: null,
      driverNumber: null,
      lapNumber: 2,
      severity: 'critical'
    }
    expect(e.buildCandidates([message], 0, 0, 'safety-car')).toEqual([])
  })
})
