import { describe, it, expect } from 'vitest'
import {
  parseMaybeJsonArray,
  normalizeWinnerEvent,
  pickBestEvent,
  isWinnerEvent,
  canonicalGpKeys,
  parseHistory,
  priceAt,
  normalizeReplayMarketPrices,
  normalizeSlug,
  marketSearchQueries
} from '@shared/market'
import { matchOutcomesToDrivers, marketQueryForSession } from '@renderer/store/marketStore'
import type { Driver } from '@shared/models'

// A trimmed, realistic Gamma "event" with grouped per-driver winner markets.
const EVENT = {
  slug: 'f1-british-grand-prix-winner',
  title: 'F1 British Grand Prix Winner',
  active: true,
  closed: false,
  endDate: '2025-07-06T00:00:00Z',
  volume: 1250000,
  markets: [
    {
      groupItemTitle: 'Verstappen',
      question: 'Will Max Verstappen win the 2025 F1 British Grand Prix?',
      outcomes: '["Yes", "No"]',
      outcomePrices: '["0.42", "0.58"]',
      clobTokenIds: '["yes-ver", "no-ver"]',
      closed: false
    },
    {
      groupItemTitle: 'Norris',
      question: 'Will Lando Norris win the 2025 F1 British Grand Prix?',
      outcomes: '["Yes", "No"]',
      outcomePrices: '["0.31", "0.69"]',
      clobTokenIds: '["yes-nor", "no-nor"]',
      closed: false
    },
    {
      // Malformed price → must be dropped, not crash.
      groupItemTitle: 'Broken',
      outcomes: '["Yes", "No"]',
      outcomePrices: 'not-json',
      clobTokenIds: '[]'
    }
  ]
}

describe('parseMaybeJsonArray', () => {
  it('parses JSON-string arrays and passes through real arrays', () => {
    expect(parseMaybeJsonArray('["Yes", "No"]')).toEqual(['Yes', 'No'])
    expect(parseMaybeJsonArray(['a', 'b'])).toEqual(['a', 'b'])
    expect(parseMaybeJsonArray('garbage')).toEqual([])
    expect(parseMaybeJsonArray(null)).toEqual([])
  })
})

describe('normalizeWinnerEvent', () => {
  const { event, outcomes } = normalizeWinnerEvent(EVENT)

  it('summarises the event', () => {
    expect(event.slug).toBe('f1-british-grand-prix-winner')
    expect(event.closed).toBe(false)
    expect(event.volume).toBe(1250000)
  })

  it('extracts Yes-price probabilities, sorted, dropping malformed markets', () => {
    expect(outcomes.map((o) => o.name)).toEqual(['Verstappen', 'Norris'])
    expect(outcomes[0].probability).toBeCloseTo(0.42, 6)
    expect(outcomes[1].probability).toBeCloseTo(0.31, 6)
    expect(outcomes[0].yesTokenId).toBe('yes-ver')
  })

  it('de-vigs raw prices into a fair distribution that sums to 1', () => {
    const fairSum = outcomes.reduce((a, o) => a + o.fairProbability, 0)
    expect(fairSum).toBeCloseTo(1, 6)
    // 0.42 / (0.42 + 0.31) ≈ 0.575 — higher than the raw 0.42 once vig is removed.
    expect(outcomes[0].fairProbability).toBeCloseTo(0.42 / 0.73, 6)
    expect(outcomes[0].fairProbability).toBeGreaterThan(outcomes[0].probability)
  })

  it('parses resolved full-name markets without turning every driver into zero', () => {
    const resolved = normalizeWinnerEvent({
      ...EVENT,
      active: false,
      closed: true,
      markets: [
        {
          groupItemTitle: 'Lando Norris',
          outcomes: '["Yes","No"]',
          outcomePrices: '["1","0"]',
          clobTokenIds: '["yes-lando","no-lando"]',
          closed: true
        },
        {
          groupItemTitle: 'Max Verstappen',
          outcomes: '["Yes","No"]',
          outcomePrices: '["0","1"]',
          clobTokenIds: '["yes-max","no-max"]',
          closed: true
        }
      ]
    })
    expect(resolved.outcomes.find((outcome) => outcome.name === 'Lando Norris')).toMatchObject({
      probability: 1,
      fairProbability: 1,
      yesTokenId: 'yes-lando',
      resolved: true
    })
    expect(resolved.outcomes.reduce((sum, outcome) => sum + outcome.fairProbability, 0)).toBe(1)
  })
})

describe('canonicalGpKeys', () => {
  it('maps GP name, country and circuit synonyms to the same round', () => {
    const a = canonicalGpKeys('British Grand Prix')
    const b = canonicalGpKeys('Silverstone')
    const c = canonicalGpKeys('Great Britain')
    expect(a.size).toBe(1)
    expect([...a][0]).toBe([...b][0])
    expect([...a][0]).toBe([...c][0])
  })

  it('does not confuse different rounds or short substrings', () => {
    const uk = canonicalGpKeys('British Grand Prix')
    const it = canonicalGpKeys('Italian Grand Prix')
    expect([...uk][0]).not.toBe([...it][0])
    // "uk" must be a whole word, not a substring of "ukelele".
    expect(canonicalGpKeys('ukelele festival').size).toBe(0)
  })
})

describe('marketSearchQueries', () => {
  it('adds canonical Polymarket wording for circuit and country aliases', () => {
    expect(marketSearchQueries('Silverstone')).toEqual(['Silverstone', 'British Grand Prix'])
    expect(marketSearchQueries('Great Britain Grand Prix')).toEqual([
      'Great Britain Grand Prix',
      'British Grand Prix'
    ])
  })
})

describe('isWinnerEvent / pickBestEvent', () => {
  it('recognises an F1 winner event', () => {
    expect(isWinnerEvent(EVENT)).toBe(true)
    expect(isWinnerEvent({ title: 'Kraken IPO in 2025?', slug: 'kraken-ipo' })).toBe(false)
  })

  it('excludes season-long championship markets', () => {
    expect(
      isWinnerEvent({ title: 'F1 2026 Drivers Championship Winner', slug: 'f1-2026-wdc' })
    ).toBe(false)
  })

  it('picks the best matching event by query overlap and liveness', () => {
    const events = [
      { title: 'F1 Monaco Grand Prix Winner', slug: 'f1-monaco-grand-prix-winner', active: true, closed: false, volume: 500000 },
      EVENT,
      { title: 'US Presidential Election Winner', slug: 'us-election', active: true, closed: false, volume: 9e9 }
    ]
    const best = pickBestEvent(events, 'British Grand Prix')
    expect((best as { slug?: string })?.slug).toBe('f1-british-grand-prix-winner')
  })

  it('identifies the round through a circuit/country synonym', () => {
    const events = [
      { title: 'F1 Monaco Grand Prix Winner', slug: 'f1-monaco-grand-prix-winner', active: true, closed: false, volume: 500000 },
      EVENT
    ]
    // Our session says "Silverstone" / "Great Britain"; Polymarket says "British".
    expect((pickBestEvent(events, 'Silverstone') as { slug?: string })?.slug).toBe(
      'f1-british-grand-prix-winner'
    )
    expect((pickBestEvent(events, 'Great Britain Grand Prix') as { slug?: string })?.slug).toBe(
      'f1-british-grand-prix-winner'
    )
  })

  it('disambiguates the right weekend by race-date proximity', () => {
    const may = {
      title: 'F1 Miami Grand Prix Winner',
      slug: 'f1-miami-gp-winner',
      active: true,
      closed: false,
      endDate: '2026-05-03T00:00:00Z',
      volume: 800000
    }
    const octEarlier = {
      title: 'F1 Miami Grand Prix Winner (rerun)',
      slug: 'f1-miami-gp-winner-2',
      active: true,
      closed: false,
      endDate: '2026-10-01T00:00:00Z',
      volume: 800000
    }
    // Race is in early May → the May market must win despite identical everything else.
    const best = pickBestEvent([octEarlier, may], 'Miami Grand Prix', {
      targetDateMs: Date.parse('2026-05-03T18:00:00Z')
    })
    expect((best as { slug?: string })?.slug).toBe('f1-miami-gp-winner')
  })

  it('returns null when nothing resembles an F1 winner market', () => {
    expect(pickBestEvent([{ title: 'Some crypto thing', slug: 'x' }], 'British Grand Prix')).toBeNull()
  })
})

describe('parseHistory / priceAt', () => {
  const points = parseHistory({
    history: [
      { t: 300, p: 0.5 },
      { t: 100, p: 0.4 },
      { t: 200, p: 0.45 }
    ]
  })

  it('parses and sorts history ascending by time', () => {
    expect(points.map((p) => p.t)).toEqual([100, 200, 300])
  })

  it('reads the price at (or just before) an instant', () => {
    expect(priceAt(points, 50)).toBe(0.4) // before first → clamp to first
    expect(priceAt(points, 150)).toBe(0.4)
    expect(priceAt(points, 250)).toBe(0.45)
    expect(priceAt(points, 9999)).toBe(0.5)
    expect(priceAt([], 100)).toBeNull()
  })
})

describe('normalizeReplayMarketPrices', () => {
  const tokens = [
    { driverNumber: 1, yesTokenId: 'yes-ver' },
    { driverNumber: 4, yesTokenId: 'yes-nor' }
  ]
  const complete = {
    'yes-ver': [{ t: 100, p: 0.4 }],
    'yes-nor': [{ t: 100, p: 0.3 }]
  }

  it('normalizes only a complete matched replay field', () => {
    const prices = normalizeReplayMarketPrices(tokens, complete, {}, 100)
    expect(prices.get(1)).toBeCloseTo(4 / 7)
    expect(prices.get(4)).toBeCloseTo(3 / 7)
  })

  it('suppresses all replay odds when any matched history is missing, empty, or failed', () => {
    expect(normalizeReplayMarketPrices(tokens, { 'yes-ver': complete['yes-ver'] }, {}, 100).size).toBe(0)
    expect(normalizeReplayMarketPrices(tokens, { ...complete, 'yes-nor': [] }, {}, 100).size).toBe(0)
    expect(normalizeReplayMarketPrices(tokens, complete, { 'yes-nor': 'network failed' }, 100).size).toBe(0)
  })
})

describe('normalizeSlug', () => {
  it('extracts a slug from a Polymarket URL or bare slug', () => {
    expect(normalizeSlug('https://polymarket.com/event/f1-british-grand-prix-winner')).toBe(
      'f1-british-grand-prix-winner'
    )
    expect(normalizeSlug('  f1-british-grand-prix-winner/ ')).toBe('f1-british-grand-prix-winner')
  })
})

describe('matchOutcomesToDrivers', () => {
  const drivers: Driver[] = [
    driver(1, 'VER', 'Max', 'Verstappen'),
    driver(4, 'NOR', 'Lando', 'Norris'),
    driver(11, 'PER', 'Sergio', 'Pérez')
  ]

  it('matches surnames (accent-insensitive) to driver numbers', () => {
    const { outcomes } = normalizeWinnerEvent(EVENT)
    const { byDriver, unmatched } = matchOutcomesToDrivers(
      [
        ...outcomes,
        { name: 'Perez', probability: 0.05, fairProbability: 0.05, yesTokenId: 't', resolved: false }
      ],
      drivers
    )
    expect(byDriver.get(1)?.name).toBe('Verstappen')
    expect(byDriver.get(4)?.name).toBe('Norris')
    expect(byDriver.get(11)?.name).toBe('Perez') // matched Pérez despite accent
    expect(unmatched.length).toBe(0)
  })

  it('matches full names and first-initial+surname forms too', () => {
    const { byDriver } = matchOutcomesToDrivers(
      [
        { name: 'Max Verstappen', probability: 0.4, fairProbability: 0.4, yesTokenId: null, resolved: false },
        { name: 'L. Norris', probability: 0.3, fairProbability: 0.3, yesTokenId: null, resolved: false }
      ],
      drivers
    )
    expect(byDriver.get(1)?.name).toBe('Max Verstappen')
    expect(byDriver.get(4)?.name).toBe('L. Norris')
  })

  it('collects outcomes with no driver match', () => {
    const { unmatched } = matchOutcomesToDrivers(
      [{ name: 'Nobody', probability: 0.1, fairProbability: 0.1, yesTokenId: null, resolved: false }],
      drivers
    )
    expect(unmatched.length).toBe(1)
  })
})

describe('marketQueryForSession', () => {
  it('derives a GP query from the meeting or country', () => {
    expect(
      marketQueryForSession({ meetingName: 'British Grand Prix', countryName: 'UK', year: 2025 })
    ).toBe('British Grand Prix')
    expect(
      marketQueryForSession({ meetingName: null, countryName: 'Italy', year: 2025 })
    ).toBe('Italy Grand Prix')
  })
})

function driver(number: number, code: string, firstName: string, lastName: string): Driver {
  return {
    number,
    code,
    firstName,
    lastName,
    fullName: `${firstName} ${lastName}`,
    broadcastName: null,
    teamName: null,
    teamColour: null,
    headshotUrl: null,
    countryCode: null
  }
}
