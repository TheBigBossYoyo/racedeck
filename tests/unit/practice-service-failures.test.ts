// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  fetch: vi.fn(),
  pdf: {
    text: '',
    throwOnParse: false as boolean,
    constructed: 0,
    destroyed: 0,
    lastData: null as Uint8Array | null
  }
}))

vi.mock('electron', () => ({ net: { fetch: h.fetch } }))
vi.mock('pdf-parse', () => ({
  PDFParse: class {
    constructor(opts: { data: Uint8Array }) {
      h.pdf.constructed++
      h.pdf.lastData = opts.data
    }
    async getText(): Promise<{ text: string }> {
      if (h.pdf.throwOnParse) throw new Error('corrupt pdf')
      return { text: h.pdf.text }
    }
    async destroy(): Promise<void> {
      h.pdf.destroyed++
    }
  }
}))

import { PracticeService } from '../../src/main/practice-service'
import { MAX_PRACTICE_PDF_BYTES } from '../../src/shared/practice'

const NO_INFO = 'No sourced driver-swap or upgrade information was found for this event.'
const FIA = 'https://api.fia.com/system/files/decision-document/2026_belgian_grand_prix_-_car_presentation_submissions.pdf'

const UPGRADE_TEXT = [
  'Car Presentation – Belgian Grand Prix',
  '*McLaren*',
  '1 Front Wing Performance new profile',
  '2 Floor Edge Circuit specific tweak',
  'Car Presentation – Belgian Grand Prix',
  'Ferrari',
  'No updates submitted'
].join('\n')

const request = {
  year: 2026,
  meetingName: 'Belgian Grand Prix',
  countryName: 'Belgium',
  dateStart: '2026-07-17T11:30:00Z',
  drivers: [{ number: 14, code: 'ALO', fullName: 'Fernando Alonso', teamName: 'Aston Martin' }]
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function pdfResponse(bytes = 64, headers: Record<string, string> = {}): Response {
  return new Response(new Uint8Array(bytes), { status: 200, headers: { 'content-type': 'application/pdf', ...headers } })
}

/** A response whose body streams `chunks` chunks of `size` bytes and records cancellation. */
function streamingPdf(chunks: number, size: number, headers: Record<string, string> = {}) {
  const state = { pulled: 0, cancelled: false }
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (state.pulled >= chunks) return controller.close()
      state.pulled++
      controller.enqueue(new Uint8Array(size))
    },
    cancel() {
      state.cancelled = true
    }
  })
  return {
    state,
    response: new Response(body, { status: 200, headers: { 'content-type': 'application/pdf', ...headers } })
  }
}

const JOLPICA_OK = {
  MRData: {
    StandingsTable: {
      StandingsLists: [
        {
          DriverStandings: [
            { Driver: { givenName: 'Fernando', familyName: 'Alonso' }, Constructors: [{ name: 'Aston Martin' }] },
            { Driver: { givenName: 'Lance', familyName: 'Stroll' }, Constructors: [{ name: 'Aston Martin' }] }
          ]
        }
      ]
    }
  }
}

type Handler = () => Response | Promise<Response>
let handlers: { jolpica: Handler; openf1: Handler; fia: Handler }

beforeEach(() => {
  h.fetch.mockReset()
  h.pdf.text = UPGRADE_TEXT
  h.pdf.throwOnParse = false
  h.pdf.constructed = 0
  h.pdf.destroyed = 0
  h.pdf.lastData = null
  handlers = {
    jolpica: () => json(JOLPICA_OK),
    openf1: () => json([]),
    fia: () => pdfResponse()
  }
  h.fetch.mockImplementation(async (url: string) => {
    if (url.includes('api.jolpi.ca')) return handlers.jolpica()
    if (url.includes('api.openf1.org')) return handlers.openf1()
    if (url.includes('api.fia.com')) return handlers.fia()
    return new Response('', { status: 404 })
  })
})
afterEach(() => {
  vi.useRealTimers()
})

const fetchedUrls = (): string[] => h.fetch.mock.calls.map((c) => c[0] as string)

describe('PracticeService.briefing request validation', () => {
  it.each([
    ['no meeting or country', { ...request, meetingName: null, countryName: null }],
    ['a blank meeting', { ...request, meetingName: '  ', countryName: null }],
    ['a year before 2018', { ...request, year: 2017 }],
    ['a year after 2035', { ...request, year: 2036 }],
    ['a fractional year', { ...request, year: 2026.5 }],
    ['no year and no date', { ...request, year: null, dateStart: null }]
  ])('rejects %s without any network access', async (_label, req) => {
    const res = await new PracticeService().briefing(req)
    expect(res).toMatchObject({
      ok: false,
      error: 'Practice intelligence needs a recognized event and season.',
      swaps: [],
      upgrades: [],
      upgradeDocumentUrl: null
    })
    expect(h.fetch).not.toHaveBeenCalled()
  })

  it('derives the season from dateStart when year is absent, and the meeting from the country', async () => {
    const res = await new PracticeService().briefing({ ...request, year: null, meetingName: null })
    expect(res.ok).toBe(true)
    expect(fetchedUrls().some((u) => u.includes('/ergast/f1/2026/'))).toBe(true)
    expect(fetchedUrls()).toContain(
      'https://api.fia.com/system/files/decision-document/2026_belgium_-_car_presentation_submissions.pdf'
    )
  })
})

describe('PracticeService upgrade document', () => {
  it('parses a valid PDF into per-team upgrades and returns the source URL', async () => {
    const res = await new PracticeService().briefing(request)
    expect(res.ok).toBe(true)
    expect(res.upgradeDocumentUrl).toBe(FIA)
    expect(res.upgrades).toEqual([
      expect.objectContaining({ teamName: 'McLaren', noUpdates: false, components: ['Front Wing', 'Floor Edge'] }),
      expect.objectContaining({ teamName: 'Ferrari', noUpdates: true, components: [], summary: null })
    ])
    expect(res.error).toBeNull()
    expect(h.pdf.lastData?.byteLength).toBe(64)
  })

  it('builds an ASCII slug from an accented meeting name', async () => {
    await new PracticeService().briefing({ ...request, meetingName: 'São Paulo Grand Prix' })
    expect(fetchedUrls()).toContain(
      'https://api.fia.com/system/files/decision-document/2026_sao_paulo_grand_prix_-_car_presentation_submissions.pdf'
    )
  })

  it('returns no upgrades (and no URL) on a non-2xx response', async () => {
    handlers.fia = () => new Response('not found', { status: 404 })
    const res = await new PracticeService().briefing(request)
    expect(res).toMatchObject({ ok: true, upgrades: [], upgradeDocumentUrl: null })
    expect(h.pdf.constructed).toBe(0)
  })

  it('ignores a 200 response that is not a PDF (soft-404 HTML page) without parsing it', async () => {
    handlers.fia = () => new Response('<html>Not found</html>', { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })
    const res = await new PracticeService().briefing(request)
    expect(res).toMatchObject({ upgrades: [], upgradeDocumentUrl: null })
    expect(h.pdf.constructed).toBe(0)
  })

  it('treats a response with no content-type as not a PDF', async () => {
    handlers.fia = () => new Response(new Uint8Array(10), { status: 200 })
    const res = await new PracticeService().briefing(request)
    expect(res.upgradeDocumentUrl).toBeNull()
    expect(h.pdf.constructed).toBe(0)
  })

  it('accepts a differently-cased PDF content type', async () => {
    handlers.fia = () => new Response(new Uint8Array(8), { status: 200, headers: { 'content-type': 'Application/PDF' } })
    const res = await new PracticeService().briefing(request)
    expect(res.upgradeDocumentUrl).toBe(FIA)
  })

  it('rejects a document whose declared Content-Length exceeds 25 MiB before reading the body', async () => {
    const { response, state } = streamingPdf(1, 10, { 'content-length': String(MAX_PRACTICE_PDF_BYTES + 1) })
    handlers.fia = () => response
    const res = await new PracticeService().briefing(request)
    expect(res).toMatchObject({ upgrades: [], upgradeDocumentUrl: null })
    expect(h.pdf.constructed).toBe(0)
    expect(state.pulled).toBeLessThanOrEqual(1) // at most the stream's own prefetch; never drained
  })

  it.each(['abc', '0', '-5', '1e99'])('rejects an invalid Content-Length %j', async (len) => {
    handlers.fia = () => pdfResponse(16, { 'content-length': len })
    const res = await new PracticeService().briefing(request)
    expect(res.upgradeDocumentUrl).toBeNull()
    expect(h.pdf.constructed).toBe(0)
  })

  it('accepts a document exactly at the size limit declared via Content-Length', async () => {
    handlers.fia = () => pdfResponse(16, { 'content-length': String(MAX_PRACTICE_PDF_BYTES) })
    // (the header lies about the size; the streamed body is what is actually read)
    const res = await new PracticeService().briefing(request)
    expect(res.upgradeDocumentUrl).toBe(FIA)
  })

  it('aborts a stream that exceeds the limit when no Content-Length was sent, and cancels the body', async () => {
    const MiB = 1024 * 1024
    const { response, state } = streamingPdf(40, MiB)
    handlers.fia = () => response
    const res = await new PracticeService().briefing(request)
    expect(res).toMatchObject({ upgrades: [], upgradeDocumentUrl: null })
    expect(h.pdf.constructed).toBe(0)
    expect(state.cancelled).toBe(true)
    // It stopped shortly after crossing 25 MiB rather than draining all 40.
    expect(state.pulled).toBeLessThan(40)
    expect(state.pulled).toBeGreaterThanOrEqual(26)
  })

  it('reassembles a multi-chunk body in order', async () => {
    const chunks = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5]), new Uint8Array([6])]
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        chunks.forEach((x) => c.enqueue(x))
        c.close()
      }
    })
    handlers.fia = () => new Response(body, { status: 200, headers: { 'content-type': 'application/pdf' } })
    await new PracticeService().briefing(request)
    expect(Array.from(h.pdf.lastData!)).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('drops the document when the extracted text exceeds 1 MiB', async () => {
    h.pdf.text = 'Car Presentation – x\nMcLaren\n' + 'a'.repeat(1024 * 1024 + 1)
    const res = await new PracticeService().briefing(request)
    expect(res).toMatchObject({ upgrades: [], upgradeDocumentUrl: null })
    expect(h.pdf.destroyed).toBe(1) // parser is always released
  })

  it('survives a corrupt PDF, releases the parser, and still returns driver-swap data', async () => {
    h.pdf.throwOnParse = true
    const res = await new PracticeService().briefing(request)
    expect(res).toMatchObject({ ok: true, upgrades: [], upgradeDocumentUrl: null })
    expect(h.pdf.destroyed).toBe(1)
  })

  it('handles a PDF response with no body', async () => {
    handlers.fia = () => new Response(null, { status: 200, headers: { 'content-type': 'application/pdf' } })
    const res = await new PracticeService().briefing(request)
    expect(res.upgradeDocumentUrl).toBeNull()
    expect(h.pdf.constructed).toBe(0)
  })

  it('a PDF with no recognisable sections yields an empty upgrade list but keeps the URL', async () => {
    h.pdf.text = 'random unrelated text'
    const res = await new PracticeService().briefing(request)
    expect(res.upgrades).toEqual([])
    expect(res.upgradeDocumentUrl).toBe(FIA)
    expect(res.error).toBe(NO_INFO)
  })
})

describe('PracticeService failure isolation', () => {
  it('returns an empty briefing (ok:true) that flags the outage when every upstream fails', async () => {
    h.fetch.mockRejectedValue(new Error('offline'))
    const res = await new PracticeService().briefing(request)
    expect(res).toMatchObject({ ok: true, swaps: [], upgrades: [], upgradeDocumentUrl: null })
    expect(res.error).toMatch(/could not be reached/i)
  })

  it('a failing standings roster does not block the upgrade document', async () => {
    handlers.jolpica = () => new Response('', { status: 500 })
    const res = await new PracticeService().briefing(request)
    expect(res.swaps).toEqual([])
    expect(res.upgrades).toHaveLength(2)
    expect(res.error).toMatch(/incomplete/i)
  })

  it('a failing upgrade document does not block driver swaps', async () => {
    handlers.fia = () => new Response('', { status: 500 })
    const swapRequest = {
      ...request,
      drivers: [{ number: 99, code: 'TST', fullName: 'Test Driver', teamName: 'Aston Martin' }]
    }
    const res = await new PracticeService().briefing(swapRequest)
    expect(res.swaps).toHaveLength(1)
    expect(res.swaps[0]).toMatchObject({ fullName: 'Test Driver', replaces: ['Fernando Alonso', 'Lance Stroll'] })
    expect(res.upgrades).toEqual([])
    expect(res.error).toMatch(/incomplete/i)
  })

  it('tolerates a roster payload with an unexpected shape', async () => {
    handlers.jolpica = () => json({ MRData: { StandingsTable: 'nope' } })
    const res = await new PracticeService().briefing(request)
    expect(res.swaps).toEqual([])
  })

  it('tolerates malformed roster JSON', async () => {
    handlers.jolpica = () => new Response('<html>', { status: 200 })
    const res = await new PracticeService().briefing(request)
    expect(res.swaps).toEqual([])
    expect(res.upgrades).toHaveLength(2)
  })

  it('does not report a swap for a regular driver on their own team', async () => {
    const res = await new PracticeService().briefing(request)
    expect(res.swaps).toEqual([])
  })

  it('counts prior practice sessions from OpenF1 for a swapped-in driver, only those before the event', async () => {
    handlers.fia = () => new Response('', { status: 404 })
    handlers.openf1 = () => new Response('[]')
    h.fetch.mockImplementation(async (url: string) => {
      if (url.includes('api.jolpi.ca')) return json(JOLPICA_OK)
      if (url.includes('api.fia.com')) return new Response('', { status: 404 })
      if (url.includes('/drivers?full_name=Test%20Driver')) {
        return json([{ session_key: 1 }, { session_key: 1 }, { session_key: 2 }, { session_key: 3 }, { session_key: 4 }])
      }
      if (url.includes('/sessions?year=2025')) {
        return json([
          { session_key: 1, session_name: 'Practice 1', meeting_name: 'Abu Dhabi GP', date_start: '2025-12-05T09:00:00Z' },
          { session_key: 2, session_name: 'Race', meeting_name: 'Abu Dhabi GP', date_start: '2025-12-07T13:00:00Z' }
        ])
      }
      if (url.includes('/sessions?year=2026')) {
        return json([
          { session_key: 3, session_name: 'Practice 2', meeting_name: 'Austrian GP', date_start: '2026-06-26T12:00:00Z' },
          // after the event being briefed -> excluded
          { session_key: 4, session_name: 'Practice 1', meeting_name: 'Dutch GP', date_start: '2026-08-21T10:00:00Z' }
        ])
      }
      return json([])
    })
    const res = await new PracticeService().briefing({
      ...request,
      drivers: [{ number: 99, code: 'TST', fullName: 'Test Driver', teamName: 'Aston Martin' }]
    })
    expect(res.swaps[0]).toMatchObject({
      priorPracticeSessions: 2,
      priorPracticeEvents: ['Abu Dhabi GP', 'Austrian GP']
    })
    expect(res.swaps[0].sources.some((s) => s.label === 'OpenF1 sessions')).toBe(true)
  })

  it('leaves prior practice unknown (null) when OpenF1 rejects and no built-in record exists', async () => {
    handlers.openf1 = () => new Response('', { status: 401 })
    const res = await new PracticeService().briefing({
      ...request,
      drivers: [{ number: 99, code: 'TST', fullName: 'Test Driver', teamName: 'Aston Martin' }]
    })
    expect(res.swaps[0].priorPracticeSessions).toBeNull()
    expect(res.swaps[0].sources.some((s) => s.label === 'OpenF1 sessions')).toBe(false)
  })
})

describe('PracticeService timeouts', () => {
  it('aborts every upstream request after 15s and degrades to an empty, flagged briefing', async () => {
    vi.useFakeTimers()
    h.fetch.mockImplementation(
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise((_res, reject) => {
          init.signal.addEventListener('abort', () => {
            const e = new Error('aborted')
            e.name = 'AbortError'
            reject(e)
          })
        })
    )
    const p = new PracticeService().briefing(request)
    let settled = false
    void p.then(() => (settled = true))
    await vi.advanceTimersByTimeAsync(14_999)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    const res = await p
    expect(res).toMatchObject({ ok: true, swaps: [], upgrades: [], upgradeDocumentUrl: null })
    expect(res.error).toMatch(/could not be reached/i)
  })
})

describe('PracticeService cache', () => {
  it('serves an identical briefing from cache for 6 hours, then refetches', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-01T00:00:00Z'))
    const svc = new PracticeService()
    const first = await svc.briefing(request)
    const calls = h.fetch.mock.calls.length
    vi.setSystemTime(Date.now() + 6 * 3600_000 - 1000)
    expect(await svc.briefing(request)).toBe(first)
    expect(h.fetch).toHaveBeenCalledTimes(calls)
    vi.setSystemTime(Date.now() + 2000)
    await svc.briefing(request)
    expect(h.fetch.mock.calls.length).toBeGreaterThan(calls)
  })

  it('keys the cache by roster, so a changed driver line-up is not served stale data', async () => {
    const svc = new PracticeService()
    await svc.briefing(request)
    const calls = h.fetch.mock.calls.length
    await svc.briefing({ ...request, drivers: [...request.drivers, { number: 99, code: 'TST', fullName: 'Test Driver', teamName: 'Aston Martin' }] })
    expect(h.fetch.mock.calls.length).toBeGreaterThan(calls)
  })
})

describe('PracticeService unpublished upgrade document', () => {
  const UNREACHABLE = /could not be reached/i

  // The FIA publishes the car-presentation PDF only for some events, at a URL we
  // derive from the meeting name. Its absence is the normal case, not an outage.
  it.each([404, 403])('treats an FIA %i as "document not published": not degraded, and cached', async (status) => {
    handlers.fia = () => new Response('', { status })
    const svc = new PracticeService()
    const res = await svc.briefing(request)
    expect(res).toMatchObject({ ok: true, upgrades: [], upgradeDocumentUrl: null })
    expect(res.error).toBe(NO_INFO)
    expect(res.error).not.toMatch(UNREACHABLE)

    const calls = h.fetch.mock.calls.length
    expect(await svc.briefing(request)).toBe(res)
    expect(h.fetch).toHaveBeenCalledTimes(calls)
  })

  it('a missing document does not hide the driver-swap data, and the briefing is clean', async () => {
    handlers.fia = () => new Response('', { status: 404 })
    const svc = new PracticeService()
    const res = await svc.briefing({
      ...request,
      drivers: [{ number: 99, code: 'TST', fullName: 'Test Driver', teamName: 'Aston Martin' }]
    })
    expect(res.swaps).toHaveLength(1)
    expect(res.error).toBeNull()
    expect(await svc.briefing({
      ...request,
      drivers: [{ number: 99, code: 'TST', fullName: 'Test Driver', teamName: 'Aston Martin' }]
    })).toBe(res)
  })

  it.each([500, 502, 503, 401, 429])('still degrades (and does not cache) on an FIA %i', async (status) => {
    handlers.fia = () => new Response('', { status })
    const svc = new PracticeService()
    const first = await svc.briefing(request)
    expect(first.error).toMatch(UNREACHABLE)
    const calls = h.fetch.mock.calls.length
    const second = await svc.briefing(request)
    expect(second).not.toBe(first)
    expect(h.fetch.mock.calls.length).toBeGreaterThan(calls)
  })

  it('still degrades (and does not cache) on a network error reaching the FIA', async () => {
    handlers.fia = () => {
      throw new Error('ECONNRESET')
    }
    const svc = new PracticeService()
    const first = await svc.briefing(request)
    expect(first.error).toMatch(UNREACHABLE)
    expect(await svc.briefing(request)).not.toBe(first)
  })

  it('the 404/403 exemption is scoped to the FIA document: a 404 from the roster API is still an outage', async () => {
    handlers.jolpica = () => new Response('', { status: 404 })
    const res = await new PracticeService().briefing(request)
    expect(res.error).toMatch(UNREACHABLE)
  })
})

describe('PracticeService degraded briefings', () => {
  const UNREACHABLE = /could not be reached/i

  it('says a source was unreachable, instead of claiming nothing exists, when every upstream fails', async () => {
    h.fetch.mockRejectedValue(new Error('offline'))

    const res = await new PracticeService().briefing(request)

    expect(res).toMatchObject({ ok: true, swaps: [], upgrades: [] })
    expect(res.error).toMatch(UNREACHABLE)
    expect(res.error).not.toBe(NO_INFO)
  })

  it('flags a partial briefing when only one source fails', async () => {
    handlers.jolpica = () => new Response('', { status: 500 })

    const res = await new PracticeService().briefing(request)

    expect(res.upgrades).toHaveLength(2)
    expect(res.error).toMatch(UNREACHABLE)
  })

  it('still reports "no sourced information" when every source answered and had nothing', async () => {
    h.pdf.text = ''
    const res = await new PracticeService().briefing(request)

    expect(res.error).toBe(NO_INFO)
  })

  it('does not cache a degraded briefing, so the next request retries the failed source', async () => {
    const svc = new PracticeService()
    handlers.jolpica = () => new Response('', { status: 500 })
    const degraded = await svc.briefing(request)
    expect(degraded.error).toMatch(UNREACHABLE)

    handlers.jolpica = () => json(JOLPICA_OK)
    const recovered = await svc.briefing(request)

    expect(recovered).not.toBe(degraded)
    expect(recovered.error).toBeNull()
  })

  it('still caches a healthy briefing', async () => {
    const svc = new PracticeService()
    const first = await svc.briefing(request)
    const calls = h.fetch.mock.calls.length

    expect(await svc.briefing(request)).toBe(first)
    expect(h.fetch).toHaveBeenCalledTimes(calls)
  })
})
