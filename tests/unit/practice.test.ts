import { describe, expect, it } from 'vitest'
import { DemoProvider } from '@renderer/core/providers/DemoProvider'
import { PracticeEngine } from '@renderer/core/engines/PracticeEngine'
import {
  MAX_PRACTICE_PDF_BYTES,
  openF1PracticeYears,
  parseUpgradeDocument,
  practiceBriefCacheKey,
  validatePracticeBriefRequest,
  validatePracticePdfLength
} from '@shared/practice'
import type { PracticeBriefRequest } from '@shared/practice'

const provider = new DemoProvider()

describe('PracticeEngine', () => {
  it('requires a practice session', () => {
    const snapshot = provider.getSnapshotAt(provider.getDuration() * 0.4)
    expect(PracticeEngine.analyze(snapshot).available).toBe(false)
  })

  it('summarizes lap count, pace and inferred run programmes without future data', () => {
    const snapshot = provider.getSnapshotAt(provider.getDuration() * 0.45)
    snapshot.session = { ...snapshot.session, type: 'practice', name: 'Practice 2' }
    const analysis = PracticeEngine.analyze(snapshot)
    expect(analysis.available).toBe(true)
    expect(analysis.runs).toHaveLength(snapshot.drivers.length)
    expect(analysis.mostProductive?.lapCount).toBeGreaterThan(0)
    expect(analysis.runs.every((run) => run.lapCount >= 0)).toBe(true)
    expect(analysis.runs.some((run) => run.program === 'LONG RUN' || run.program === 'QUALIFYING RUN' || run.program === 'MIXED')).toBe(true)
  })
})

describe('FIA upgrade document parser', () => {
  it('extracts components and explicit no-update submissions', () => {
    const parsed = parseUpgradeDocument(`
Car Presentation – British Grand Prix
McLaren Formula 1 Team
Updated component Primary reason for update
1 Floor Body Performance - Local Load Revised geometry improves flow.
2 Rear Corner Performance - Flow Conditioning Revised inlet.
Car Presentation – British Grand Prix
SCUDERIA FERRARI HP
No updates submitted for this event.
`)
    expect(parsed).toHaveLength(2)
    expect(parsed[0]).toMatchObject({ teamName: 'McLaren Formula 1 Team', noUpdates: false })
    expect(parsed[0].components).toEqual(['Floor Body', 'Rear Corner'])
    expect(parsed[1]).toMatchObject({ teamName: 'SCUDERIA FERRARI HP', noUpdates: true })
  })
})

const PRACTICE_REQUEST: PracticeBriefRequest = {
  year: 2026,
  meetingName: 'British Grand Prix',
  countryName: 'Great Britain',
  dateStart: '2026-07-03T11:30:00Z',
  drivers: [{ number: 3, code: 'LIN', fullName: 'Arvid Lindblad', teamName: 'Red Bull Racing' }]
}

describe('practice request boundaries and cache identity', () => {
  it('separates sessions and changed drivers even when the car number is unchanged', () => {
    const fp1 = practiceBriefCacheKey(2026, 'British Grand Prix', PRACTICE_REQUEST)
    const fp2 = practiceBriefCacheKey(2026, 'British Grand Prix', {
      ...PRACTICE_REQUEST,
      dateStart: '2026-07-03T15:00:00Z'
    })
    const regularDriver = practiceBriefCacheKey(2026, 'British Grand Prix', {
      ...PRACTICE_REQUEST,
      drivers: [{ ...PRACTICE_REQUEST.drivers[0], fullName: 'Max Verstappen', code: 'VER' }]
    })
    expect(fp2).not.toBe(fp1)
    expect(regularDriver).not.toBe(fp1)
  })

  it('queries every available OpenF1 season before the current session', () => {
    expect(openF1PracticeYears(2026)).toEqual([2023, 2024, 2025, 2026])
    expect(openF1PracticeYears(2022)).toEqual([])
  })

  it('rejects oversized renderer payloads and invalid driver numbers', () => {
    expect(() => validatePracticeBriefRequest({
      ...PRACTICE_REQUEST,
      drivers: Array.from({ length: 31 }, () => PRACTICE_REQUEST.drivers[0])
    })).toThrow('Invalid practice driver list.')
    expect(() => validatePracticeBriefRequest({
      ...PRACTICE_REQUEST,
      drivers: [{ ...PRACTICE_REQUEST.drivers[0], number: Number.POSITIVE_INFINITY }]
    })).toThrow('Invalid practice driver number.')
    expect(() => validatePracticeBriefRequest({
      ...PRACTICE_REQUEST,
      drivers: [{ ...PRACTICE_REQUEST.drivers[0], fullName: 'x'.repeat(121) }]
    })).toThrow('Invalid practice driver name.')
  })

  it('rejects oversized declared PDFs and safely permits streaming an unknown length', () => {
    expect(validatePracticePdfLength('1024')).toBe(1024)
    expect(validatePracticePdfLength(null)).toBeNull()
    expect(() => validatePracticePdfLength(String(MAX_PRACTICE_PDF_BYTES + 1))).toThrow(
      'exceeds the safe size limit'
    )
  })
})
