import { beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({ fetch: vi.fn() }))

vi.mock('electron', () => ({ net: { fetch: electron.fetch } }))

import { PracticeService } from '../../src/main/practice-service'

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  })
}

describe('PracticeService driver enrichment', () => {
  beforeEach(() => {
    electron.fetch.mockReset()
    electron.fetch.mockImplementation(async (url: string) => {
      if (url.includes('driverstandings')) {
        return jsonResponse({
          MRData: {
            StandingsTable: {
              StandingsLists: [{
                DriverStandings: [
                  {
                    Driver: { givenName: 'Fernando', familyName: 'Alonso' },
                    Constructors: [{ name: 'Aston Martin' }]
                  },
                  {
                    Driver: { givenName: 'Lance', familyName: 'Stroll' },
                    Constructors: [{ name: 'Aston Martin' }]
                  }
                ]
              }]
            }
          }
        })
      }
      if (url.includes('api.openf1.org')) return new Response('', { status: 401 })
      return new Response('', { status: 404 })
    })
  })

  it('uses dated official Crawford data when OpenF1 history requires authentication', async () => {
    const result = await new PracticeService().briefing({
      year: 2026,
      meetingName: 'Belgian Grand Prix',
      countryName: 'Belgium',
      dateStart: '2026-07-17T11:30:00Z',
      drivers: [
        { number: 18, code: 'STR', fullName: 'Lance Stroll', teamName: 'Aston Martin' },
        { number: 34, code: 'CRA', fullName: 'Jak Crawford', teamName: 'Aston Martin' }
      ]
    })

    const swap = result.swaps.find((item) => item.fullName === 'Jak Crawford')
    expect(swap).toMatchObject({
      replaces: ['Fernando Alonso'],
      originSeries: 'FIA Formula 2',
      originTeam: 'DAMS Lucas Oil',
      recentResults: ['2025 FIA F2: P2', '2024 FIA F2: P5 · 1 win · 6 podiums'],
      priorPracticeSessions: 4,
      priorPracticeEvents: ['Abu Dhabi GP', 'Japanese GP', 'Austrian GP']
    })
    expect(swap?.sources.some((source) => source.url.includes('astonmartinf1.com'))).toBe(true)
    expect(swap?.sources.some((source) => source.label === 'Austria 2026 FP1')).toBe(true)
    expect(swap?.sources.some((source) => source.label === 'OpenF1 sessions')).toBe(false)
  })
})
