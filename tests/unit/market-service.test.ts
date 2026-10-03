// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({ fetch: vi.fn() }))
vi.mock('electron', () => ({ net: { fetch: electron.fetch } }))

import { MarketService } from '../../src/main/market-service'

const GAMMA = 'https://gamma-api.polymarket.com'
const CLOB = 'https://clob.polymarket.com'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

/** A binary Yes/No driver sub-market as Gamma encodes it (arrays as JSON strings). */
function driverMarket(name: string, yes: number, token: string, closed = false) {
  return {
    groupItemTitle: name,
    outcomes: JSON.stringify(['Yes', 'No']),
    outcomePrices: JSON.stringify([String(yes), String(1 - yes)]),
    clobTokenIds: JSON.stringify([`${token}-yes`, `${token}-no`]),
    closed
  }
}

function winnerEvent(over: Record<string, unknown> = {}) {
  return {
    slug: 'f1-belgian-grand-prix-winner',
    title: 'F1 Belgian Grand Prix Winner',
    active: true,
    closed: false,
    volume: '125000.5',
    endDate: '2026-07-05T00:00:00Z',
    markets: [driverMarket('Max Verstappen', 0.5, 'ver'), driverMarket('Lando Norris', 0.3, 'nor')],
    ...over
  }
}

/** Route mocked net.fetch calls by URL prefix. */
function route(handlers: Array<[RegExp, () => Response | Promise<Response>]>): void {
  electron.fetch.mockImplementation(async (url: string) => {
    for (const [re, h] of handlers) if (re.test(url)) return h()
    return new Response('', { status: 404 })
  })
}

const urls = (): string[] => electron.fetch.mock.calls.map((c) => c[0] as string)

/** A net.fetch that never answers but rejects with AbortError when its signal fires. */
function hangUntilAborted(): void {
  electron.fetch.mockImplementation(
    (_url: string, init: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          const e = new Error('The operation was aborted')
          e.name = 'AbortError'
          reject(e)
        })
      })
  )
}

beforeEach(() => {
  electron.fetch.mockReset()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('MarketService.winner', () => {
  it('finds an event by query, refetches the full event by slug and returns de-vigged, sorted outcomes', async () => {
    route([
      [/public-search/, () => json({ events: [{ slug: 'f1-belgian-grand-prix-winner', title: 'F1 Belgian Grand Prix Winner' }] })],
      [/events\?slug=/, () => json([winnerEvent()])]
    ])
    const res = await new MarketService().winner({ query: 'Belgian Grand Prix' })

    expect(res.ok).toBe(true)
    expect(res.error).toBeNull()
    expect(res.event).toMatchObject({ slug: 'f1-belgian-grand-prix-winner', active: true, closed: false, volume: 125000.5 })
    expect(res.outcomes.map((o) => o.name)).toEqual(['Max Verstappen', 'Lando Norris'])
    expect(res.outcomes[0]).toMatchObject({ probability: 0.5, yesTokenId: 'ver-yes', resolved: false })
    // 0.5 + 0.3 = 0.8 overround -> fair probabilities sum to 1
    expect(res.outcomes[0].fairProbability).toBeCloseTo(0.625, 6)
    expect(res.outcomes[1].fairProbability).toBeCloseTo(0.375, 6)
    // Search queries include the round's canonical Polymarket wording.
    expect(urls().some((u) => u.includes('public-search?q=Belgian%20Grand%20Prix'))).toBe(true)
    expect(urls().some((u) => u.includes(`${GAMMA}/events?slug=f1-belgian-grand-prix-winner`))).toBe(true)
  })

  it('falls back to the search payload when the by-slug refetch returns no event', async () => {
    route([
      [/public-search/, () => json({ events: [winnerEvent()] })],
      [/events\?slug=/, () => json([])]
    ])
    const res = await new MarketService().winner({ query: 'Belgian Grand Prix' })
    expect(res.ok).toBe(true)
    expect(res.outcomes).toHaveLength(2)
  })

  it('resolves an explicit slug, extracting it from a pasted polymarket URL', async () => {
    route([[/events\?slug=/, () => json([winnerEvent()])]])
    const res = await new MarketService().winner({
      slug: 'https://polymarket.com/event/f1-belgian-grand-prix-winner?tid=1'
    })
    expect(res.ok).toBe(true)
    expect(urls()).toEqual([`${GAMMA}/events?slug=f1-belgian-grand-prix-winner`])
  })

  it('reports a clear error when the slug matches nothing', async () => {
    route([[/events\?slug=/, () => json([])]])
    const res = await new MarketService().winner({ slug: 'nope' })
    expect(res).toMatchObject({ ok: false, event: null, outcomes: [], error: 'No Polymarket event found for slug "nope".' })
  })

  it('treats a non-array slug response as no event rather than crashing', async () => {
    route([[/events\?slug=/, () => json({ error: 'weird' })]])
    const res = await new MarketService().winner({ slug: 'x' })
    expect(res.ok).toBe(false)
    expect(res.error).toContain('No Polymarket event found')
  })

  it('rejects an empty/blank query without touching the network', async () => {
    const res = await new MarketService().winner({ query: '   ' })
    expect(res).toMatchObject({ ok: false, error: 'No race query provided.' })
    const res2 = await new MarketService().winner({})
    expect(res2.error).toBe('No race query provided.')
    expect(electron.fetch).not.toHaveBeenCalled()
  })

  it('says so when no winner market matches the query', async () => {
    route([[/public-search/, () => json({ events: [{ slug: 'x', title: '2026 F1 Drivers Championship winner' }] })]])
    const res = await new MarketService().winner({ query: 'Belgian Grand Prix' })
    expect(res.ok).toBe(false)
    expect(res.error).toBe('No live F1 winner market matched "Belgian Grand Prix".')
  })

  it('tolerates a search response with no events array', async () => {
    route([[/public-search/, () => json({ events: 'nope' })]])
    const res = await new MarketService().winner({ query: 'Belgian Grand Prix' })
    expect(res.ok).toBe(false)
    expect(res.error).toContain('No live F1 winner market matched')
  })

  it('returns the matched event but an error when it has no readable odds', async () => {
    route([[/events\?slug=/, () => json([winnerEvent({ markets: [{ outcomes: 'garbage', outcomePrices: '[bad' }, null] })])]])
    const res = await new MarketService().winner({ slug: 'f1-belgian-grand-prix-winner' })
    expect(res.ok).toBe(false)
    expect(res.error).toBe('Matched an event but it has no readable winner odds.')
    expect(res.event?.slug).toBe('f1-belgian-grand-prix-winner')
  })

  it('marks a closed, settled market as resolved and clamps out-of-range prices', async () => {
    route([
      [
        /events\?slug=/,
        () =>
          json([
            winnerEvent({
              markets: [driverMarket('Winner', 1, 'w', true), driverMarket('Loser', 0, 'l', true), driverMarket('Odd', 1.7, 'o')]
            })
          ])
      ]
    ])
    const res = await new MarketService().winner({ slug: 's' })
    const by = Object.fromEntries(res.outcomes.map((o) => [o.name, o]))
    expect(by.Winner.resolved).toBe(true)
    expect(by.Loser.resolved).toBe(true)
    expect(by.Odd.probability).toBe(1)
    expect(by.Odd.resolved).toBe(false)
  })

  it('maps a non-2xx response to an error carrying the status and a trimmed body excerpt', async () => {
    route([[/events\?slug=/, () => new Response('  upstream\n\n   exploded  ' + 'x'.repeat(500), { status: 503 })]])
    const res = await new MarketService().winner({ slug: 's' })
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/^Polymarket request failed \(503\): upstream exploded x+$/)
    expect(res.error!.length).toBeLessThan(300)
  })

  it('omits the body excerpt when a non-2xx response has an empty body', async () => {
    route([[/events\?slug=/, () => new Response('', { status: 429 })]])
    const res = await new MarketService().winner({ slug: 's' })
    expect(res.error).toBe('Polymarket request failed (429).')
  })

  it('maps malformed upstream JSON to an error instead of throwing', async () => {
    route([[/events\?slug=/, () => new Response('<html>not json', { status: 200 })]])
    const res = await new MarketService().winner({ slug: 's' })
    expect(res.ok).toBe(false)
    expect(res.error).toBeTruthy()
    expect(res.outcomes).toEqual([])
  })

  it('maps a network rejection to its message', async () => {
    electron.fetch.mockRejectedValue(new Error('net::ERR_INTERNET_DISCONNECTED'))
    const res = await new MarketService().winner({ slug: 's' })
    expect(res).toMatchObject({ ok: false, error: 'net::ERR_INTERNET_DISCONNECTED' })
  })

  it('uses a generic message when the rejection carries none', async () => {
    electron.fetch.mockRejectedValue({})
    const res = await new MarketService().winner({ slug: 's' })
    expect(res.error).toBe('Unknown market request error.')
  })

  it('times out after 15s with a readable message and aborts the request', async () => {
    vi.useFakeTimers()
    hangUntilAborted()
    const p = new MarketService().winner({ slug: 's' })
    await vi.advanceTimersByTimeAsync(14_999)
    let settled = false
    void p.then(() => (settled = true))
    await vi.advanceTimersByTimeAsync(0)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    const res = await p
    expect(res).toMatchObject({ ok: false, error: 'Market request timed out after 15s.' })
  })

  it('fails the whole request if any of the parallel search queries fails', async () => {
    route([
      [/public-search\?q=Belgian%20Grand%20Prix&/, () => json({ events: [winnerEvent()] })],
      [/public-search/, () => new Response('', { status: 500 })]
    ])
    // "Belgian GP" fans out to two searches: itself and the canonical wording.
    const res = await new MarketService().winner({ query: 'Belgian GP' })
    expect(urls().filter((u) => u.includes('public-search'))).toHaveLength(2)
    expect(res.ok).toBe(false)
    expect(res.error).toBe('Polymarket request failed (500).')
  })

  it('truncates over-long queries to 160 chars', async () => {
    route([[/public-search/, () => json({ events: [] })]])
    await new MarketService().winner({ query: 'a'.repeat(400) })
    const q = new URL(urls()[0]).searchParams.get('q')!
    expect(q).toHaveLength(160)
  })
})

describe('MarketService.search', () => {
  it('returns only winner events, summarised', async () => {
    route([
      [
        /public-search/,
        () =>
          json({
            events: [
              winnerEvent(),
              { slug: 'f1-drivers-championship-winner-2026', title: '2026 F1 Drivers Championship Winner' },
              { slug: 'nba-finals', title: 'NBA Finals winner' }
            ]
          })
      ]
    ])
    const res = await new MarketService().search('  belgian  ')
    expect(res.ok).toBe(true)
    expect(res.events).toHaveLength(1)
    expect(res.events[0]).toMatchObject({ slug: 'f1-belgian-grand-prix-winner', volume: 125000.5 })
    expect(urls()[0]).toContain('q=belgian&')
  })

  it('short-circuits a blank query with an ok empty result', async () => {
    const res = await new MarketService().search('   ')
    expect(res).toEqual({ ok: true, error: null, events: [] })
    expect(electron.fetch).not.toHaveBeenCalled()
  })

  it('treats a null or non-object payload as zero events', async () => {
    route([[/public-search/, () => json(null)]])
    expect(await new MarketService().search('x')).toEqual({ ok: true, error: null, events: [] })
  })

  it('returns ok:false with the HTTP error and no events on a 500', async () => {
    route([[/public-search/, () => new Response('bad gateway', { status: 502 })]])
    const res = await new MarketService().search('x')
    expect(res).toEqual({ ok: false, error: 'Polymarket request failed (502): bad gateway', events: [] })
  })

  it('times out after 15s', async () => {
    vi.useFakeTimers()
    hangUntilAborted()
    const p = new MarketService().search('x')
    await vi.advanceTimersByTimeAsync(15_000)
    expect(await p).toEqual({ ok: false, error: 'Market request timed out after 15s.', events: [] })
  })
})

describe('MarketService.history', () => {
  const HISTORY = { history: [{ t: 300, p: 0.3 }, { t: 100, p: 0.1 }, { t: 200, p: 1.4 }, { t: 'x', p: 0.5 }, { t: 400 }] }

  it('parses, sorts, clamps and filters the price series', async () => {
    route([[/prices-history/, () => json(HISTORY)]])
    const res = await new MarketService().history({ yesTokenId: ' tok ' })
    expect(res.ok).toBe(true)
    expect(res.yesTokenId).toBe('tok')
    expect(res.points).toEqual([
      { t: 100, p: 0.1 },
      { t: 200, p: 1 },
      { t: 300, p: 0.3 }
    ])
    expect(urls()[0]).toBe(`${CLOB}/prices-history?market=tok&interval=max&fidelity=30`)
  })

  it('rejects an empty token without fetching', async () => {
    const res = await new MarketService().history({ yesTokenId: '   ' })
    expect(res).toEqual({ ok: false, error: 'No token id provided.', yesTokenId: '', points: [] })
    expect(electron.fetch).not.toHaveBeenCalled()
  })

  it('uses an explicit time range and caps it to 14 days back from the end', async () => {
    route([[/prices-history/, () => json({ history: [] })]])
    const end = 2_000_000_000
    await new MarketService().history({ yesTokenId: 't', startTs: end - 100 * 86_400, endTs: end })
    const u = new URL(urls()[0])
    expect(u.searchParams.get('endTs')).toBe(String(end))
    expect(u.searchParams.get('startTs')).toBe(String(end - 14 * 86_400))
    expect(u.searchParams.has('interval')).toBe(false)
  })

  it('ignores an inverted or partial range and falls back to a whitelisted interval', async () => {
    route([[/prices-history/, () => json({ history: [] })]])
    const svc = new MarketService()
    await svc.history({ yesTokenId: 't', startTs: 200, endTs: 100, interval: '1h' })
    await svc.history({ yesTokenId: 't', startTs: 200, interval: 'bogus' as never })
    const [a, b] = urls().map((u) => new URL(u).searchParams)
    expect(a.get('interval')).toBe('1h')
    expect(a.has('startTs')).toBe(false)
    expect(b.get('interval')).toBe('max')
  })

  it('clamps fidelity into [1, 10000] and truncates fractions', async () => {
    route([[/prices-history/, () => json({ history: [] })]])
    const svc = new MarketService()
    await svc.history({ yesTokenId: 't', fidelity: 0 })
    await svc.history({ yesTokenId: 't', fidelity: 99_999 })
    await svc.history({ yesTokenId: 't', fidelity: 7.9 })
    expect(urls().map((u) => new URL(u).searchParams.get('fidelity'))).toEqual(['1', '10000', '7'])
  })

  it('encodes the token id and truncates it to 256 characters', async () => {
    route([[/prices-history/, () => json({ history: [] })]])
    const res = await new MarketService().history({ yesTokenId: 'a b&c=' + 'z'.repeat(400) })
    expect(res.yesTokenId).toHaveLength(256)
    expect(new URL(urls()[0]).searchParams.get('market')).toBe(res.yesTokenId)
    expect(urls()[0]).not.toContain('a b&c')
  })

  it('returns no points for an unexpected payload shape', async () => {
    route([[/prices-history/, () => json({ history: 'nope' })]])
    expect((await new MarketService().history({ yesTokenId: 't' })).points).toEqual([])
    route([[/prices-history/, () => json(null)]])
    expect((await new MarketService().history({ yesTokenId: 't' })).points).toEqual([])
  })

  it('reports non-2xx as a failure that still echoes the token', async () => {
    route([[/prices-history/, () => new Response('', { status: 500 })]])
    const res = await new MarketService().history({ yesTokenId: 'tok' })
    expect(res).toEqual({ ok: false, error: 'Polymarket request failed (500).', yesTokenId: 'tok', points: [] })
  })

  it('times out after 15s', async () => {
    vi.useFakeTimers()
    hangUntilAborted()
    const p = new MarketService().history({ yesTokenId: 'tok' })
    await vi.advanceTimersByTimeAsync(15_000)
    const res = await p
    expect(res.ok).toBe(false)
    expect(res.error).toBe('Market request timed out after 15s.')
  })
})
