// @vitest-environment node
import type { EventEmitter } from 'node:events'
import { deflateRawSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Protocol-level tests for F1LiveSocket. The `ws` module and global `fetch` are
 * replaced by fakes at the network boundary; everything asserted here is the
 * socket's observable output (status transitions, bytes it writes to the wire,
 * and the getData() snapshots the renderer receives).
 */

const RS = '\x1e'

vi.mock('ws', async () => {
  const { EventEmitter } = await import('node:events')
  class FakeWebSocket extends EventEmitter {
    static instances: FakeWebSocket[] = []
    sent: string[] = []
    closed = false
    /** 0 = CONNECTING, 1 = OPEN — mirrors ws, which errors when closed mid-connect. */
    readyState = 0
    /** How many 'error' listeners were attached at the moment close() was called. */
    errorListenersAtClose: number | null = null
    constructor(
      public url: string,
      public opts: { headers?: Record<string, string> }
    ) {
      super()
      this.on('open', () => {
        this.readyState = 1
      })
      FakeWebSocket.instances.push(this)
    }
    send(data: string): void {
      this.sent.push(data)
    }
    close(): void {
      this.closed = true
      this.errorListenersAtClose = this.listenerCount('error')
      // Real ws (8.x): closing a CONNECTING socket emits 'error' on the next tick,
      // which is an uncaught exception if nothing is listening.
      if (this.readyState === 0) {
        process.nextTick(() =>
          this.emit('error', new Error('WebSocket was closed before the connection was established'))
        )
      }
    }
  }
  return { default: FakeWebSocket }
})

import WebSocket from 'ws'
import { F1LiveSocket, SUBSCRIBE_TOPICS } from '../../src/main/f1-live-socket'
import type { LiveStatus } from '../../src/shared/f1live'

interface FakeWs extends EventEmitter {
  url: string
  opts: { headers?: Record<string, string> }
  sent: string[]
  closed: boolean
  errorListenersAtClose: number | null
  send: (data: string) => void
}
const FakeWebSocket = WebSocket as unknown as { instances: FakeWs[] }

const NOW = Date.parse('2026-07-05T14:00:00Z')

function negotiateOk(token = 'conn-tok', cookies: string[] = []): Response {
  const headers = new Headers()
  for (const c of cookies) headers.append('set-cookie', c)
  return new Response(JSON.stringify({ connectionToken: token }), { status: 200, headers })
}

const fetchMock = vi.fn()

/** Queue negotiate responses; once exhausted the last one repeats. */
function queueNegotiate(...responses: Array<Response | Error>): void {
  fetchMock.mockReset()
  responses.forEach((r, i) => {
    const isLast = i === responses.length - 1
    const impl = async (): Promise<Response> => {
      if (r instanceof Error) throw r
      return r.clone()
    }
    if (isLast) fetchMock.mockImplementation(impl)
    else fetchMock.mockImplementationOnce(impl)
  })
}

const flush = (): Promise<void> => vi.advanceTimersByTimeAsync(0)

function frame(msg: unknown): string {
  return JSON.stringify(msg) + RS
}
const feed = (topic: string, data: unknown): string =>
  frame({ type: 1, target: 'feed', arguments: [topic, data, '2026-07-05T14:00:00Z'] })
const completion = (result: Record<string, unknown>): string =>
  frame({ type: 3, invocationId: '0', result })

function zpayload(value: unknown): string {
  return deflateRawSync(Buffer.from(JSON.stringify(value))).toString('base64')
}

function latestWs(): FakeWs {
  return FakeWebSocket.instances[FakeWebSocket.instances.length - 1]
}
function emitMessage(ws: FakeWs, text: string): void {
  ws.emit('message', Buffer.from(text))
}

/** Start connect(), and (unless told otherwise) complete the handshake. */
async function connectAndHandshake(
  sock: F1LiveSocket,
  ctx?: Parameters<F1LiveSocket['connect']>[0]
): Promise<{ ws: FakeWs; status: LiveStatus }> {
  const p = sock.connect(ctx)
  await flush()
  const ws = latestWs()
  ws.emit('open')
  emitMessage(ws, '{}' + RS)
  return { ws, status: await p }
}

/** A connected socket with SessionInfo installed via the Subscribe completion. */
async function connectedSocket(): Promise<{ sock: F1LiveSocket; ws: FakeWs }> {
  queueNegotiate(negotiateOk())
  const sock = new F1LiveSocket()
  const { ws } = await connectAndHandshake(sock)
  return { sock, ws }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  FakeWebSocket.instances.length = 0
  vi.stubGlobal('fetch', fetchMock)
  queueNegotiate(negotiateOk())
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('negotiate', () => {
  it('reports a non-2xx negotiate as an error and never opens a websocket', async () => {
    queueNegotiate(new Response('nope', { status: 500 }))
    const sock = new F1LiveSocket()
    const status = await sock.connect()
    expect(status.state).toBe('error')
    expect(status.detail).toBe('Negotiate failed (500).')
    expect(FakeWebSocket.instances).toHaveLength(0)
    expect(sock.getStatus().state).toBe('error')
  })

  it('maps a network failure to a readable error', async () => {
    queueNegotiate(new Error('getaddrinfo ENOTFOUND'))
    const status = await new F1LiveSocket().connect()
    expect(status).toMatchObject({ state: 'error', detail: 'Negotiate error: getaddrinfo ENOTFOUND' })
    expect(FakeWebSocket.instances).toHaveLength(0)
  })

  it('errors when the negotiate body has no connectionToken', async () => {
    queueNegotiate(new Response('{}', { status: 200 }))
    const status = await new F1LiveSocket().connect()
    expect(status).toMatchObject({ state: 'error', detail: 'Negotiate returned no connection token.' })
  })

  it('errors when the negotiate body is not JSON', async () => {
    queueNegotiate(new Response('<html>gateway</html>', { status: 200 }))
    const status = await new F1LiveSocket().connect()
    expect(status.state).toBe('error')
    expect(status.detail).toMatch(/^Negotiate error: /)
  })

  it('carries the AWSALB sticky cookies onto the websocket upgrade', async () => {
    queueNegotiate(
      negotiateOk('tok/with space', ['AWSALB=abc; Path=/; Expires=x', 'AWSALBCORS=abc; Path=/'])
    )
    const { ws } = await connectAndHandshake(new F1LiveSocket())
    expect(ws.opts.headers?.Cookie).toBe('AWSALB=abc; AWSALBCORS=abc')
    expect(ws.url).toBe('wss://livetiming.formula1.com/signalrcore?id=tok%2Fwith%20space')
    expect(ws.opts.headers?.Authorization).toBeUndefined()
  })
})

describe('authenticated connect', () => {
  it('presents bearer + cookies on negotiate and the upgrade, and reports subscription', async () => {
    queueNegotiate(negotiateOk('t1', ['AWSALB=zzz; Path=/']))
    const sock = new F1LiveSocket()
    const { ws, status } = await connectAndHandshake(sock, { bearer: 'jwt', cookieHeader: 'login=1' })

    const [, init] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string> }]
    expect(init.headers.Authorization).toBe('Bearer jwt')
    expect(init.headers.Cookie).toBe('login=1')

    expect(ws.opts.headers?.Authorization).toBe('Bearer jwt')
    expect(ws.opts.headers?.Cookie).toBe('AWSALB=zzz; login=1')
    expect(ws.url).toContain('&access_token=jwt')
    expect(status.subscription).toBe(true)
    expect(status.detail).toMatch(/subscription/i)
  })

  it('falls back to anonymous when the authenticated negotiate is rejected (401)', async () => {
    queueNegotiate(new Response('', { status: 401 }), negotiateOk('anon-tok'))
    const sock = new F1LiveSocket()
    const { ws, status } = await connectAndHandshake(sock, { bearer: 'stale', cookieHeader: 'c=1' })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const anonInit = fetchMock.mock.calls[1][1] as { headers: Record<string, string> }
    expect(anonInit.headers.Authorization).toBeUndefined()
    expect(anonInit.headers.Cookie).toBeUndefined()

    expect(ws.url).toBe('wss://livetiming.formula1.com/signalrcore?id=anon-tok')
    expect(ws.opts.headers?.Authorization).toBeUndefined()
    expect(ws.opts.headers?.Cookie ?? '').not.toContain('c=1')
    expect(status.state).toBe('connected')
    expect(status.subscription).toBe(false)
  })

  it('also falls back when the authenticated negotiate throws', async () => {
    queueNegotiate(new Error('reset'), negotiateOk('anon-tok'))
    const { status } = await connectAndHandshake(new F1LiveSocket(), { bearer: 'b' })
    expect(status.state).toBe('connected')
    expect(status.subscription).toBe(false)
  })

  it('surfaces the auth rejection when the anonymous retry fails too', async () => {
    queueNegotiate(new Response('', { status: 403 }), new Response('', { status: 503 }))
    const status = await new F1LiveSocket().connect({ bearer: 'b' })
    expect(status.state).toBe('error')
    expect(status.detail).toBe('Live feed rejected auth (403).')
  })

  it('does not retry for an anonymous connect that fails', async () => {
    queueNegotiate(new Response('', { status: 502 }))
    await new F1LiveSocket().connect()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('handshake', () => {
  it('sends the json/v1 handshake on open, then Subscribe with every topic once acknowledged', async () => {
    const sock = new F1LiveSocket()
    const p = sock.connect()
    await flush()
    const ws = latestWs()
    ws.emit('open')
    expect(ws.sent).toEqual([JSON.stringify({ protocol: 'json', version: 1 }) + RS])
    expect(sock.getStatus()).toMatchObject({ state: 'connecting', detail: 'handshaking…' })

    emitMessage(ws, '{}' + RS)
    const status = await p
    expect(status.state).toBe('connected')
    expect(ws.sent).toHaveLength(2)
    const sub = JSON.parse(ws.sent[1].replace(RS, ''))
    expect(sub).toMatchObject({ type: 1, target: 'Subscribe' })
    expect(sub.arguments).toEqual([SUBSCRIBE_TOPICS])
  })

  it('fails on a handshake {error} and closes the socket without subscribing', async () => {
    const sock = new F1LiveSocket()
    const p = sock.connect()
    await flush()
    const ws = latestWs()
    ws.emit('open')
    emitMessage(ws, JSON.stringify({ error: 'Unsupported protocol' }) + RS)
    const status = await p
    expect(status).toMatchObject({ state: 'error', detail: 'Handshake rejected: Unsupported protocol' })
    expect(ws.closed).toBe(true)
    expect(ws.sent).toHaveLength(1) // only the handshake, never a Subscribe
  })

  it('a later websocket close does not overwrite the error state', async () => {
    const sock = new F1LiveSocket()
    const p = sock.connect()
    await flush()
    const ws = latestWs()
    ws.emit('open')
    emitMessage(ws, JSON.stringify({ error: 'x' }) + RS)
    await p
    ws.emit('close', 1006) // listeners were removed by fail(); must be a no-op
    expect(sock.getStatus().state).toBe('error')
  })

  it('resolves with an error when the websocket itself errors', async () => {
    const sock = new F1LiveSocket()
    const p = sock.connect()
    await flush()
    latestWs().emit('error', new Error('ECONNRESET'))
    const status = await p
    expect(status).toMatchObject({ state: 'error', detail: 'WebSocket error: ECONNRESET' })
  })

  it('skips a malformed frame that precedes the handshake ack instead of treating it as the ack', async () => {
    const sock = new F1LiveSocket()
    const p = sock.connect()
    await flush()
    const ws = latestWs()
    ws.emit('open')
    emitMessage(ws, 'not-json' + RS + '{}' + RS)
    expect((await p).state).toBe('connected')
  })

  it('processes a handshake ack, Subscribe completion and feed frames batched in ONE payload', async () => {
    const sock = new F1LiveSocket()
    const p = sock.connect()
    await flush()
    const ws = latestWs()
    ws.emit('open')
    emitMessage(
      ws,
      '{}' +
        RS +
        completion({ SessionInfo: { Meeting: { Name: 'Belgian Grand Prix' }, Name: 'Race' } }) +
        feed('TimingData', { Lines: { '1': { Position: '1' } } }) +
        feed('TimingData', { Lines: { '1': { Position: '2' } } })
    )
    const status = await p
    expect(status.state).toBe('connected')
    expect(sock.getStatus().sessionName).toBe('Belgian Grand Prix · Race')
    const data = sock.getData()
    expect(data?.streams.TimingData).toHaveLength(2)
    expect(data?.cursors.TimingData).toBe(2)
  })
})

describe('frame handling', () => {
  it('skips a malformed frame in the middle of a batch and keeps processing the rest', async () => {
    const { sock, ws } = await connectedSocket()
    emitMessage(ws, feed('TimingData', { n: 1 }) + '{"type":1,"tar' + RS + feed('TimingData', { n: 2 }))
    const pts = sock.getData()!.streams.TimingData
    expect(pts.map((p) => (p.d as { n: number }).n)).toEqual([1, 2])
  })

  it('ignores server pings, close frames, non-feed invocations and feed calls with too few arguments', async () => {
    const { sock, ws } = await connectedSocket()
    emitMessage(
      ws,
      frame({ type: 6 }) +
        frame({ type: 7, error: 'server shutting down' }) +
        frame({ type: 1, target: 'somethingElse', arguments: ['TimingData', {}] }) +
        frame({ type: 1, target: 'feed', arguments: ['TimingData'] }) +
        frame({ type: 1, target: 'feed' }) +
        frame({ type: 99 })
    )
    expect(sock.getData()!.streams).toEqual({})
    expect(sock.getStatus().messages).toBe(0)
    expect(sock.getStatus().state).toBe('connected')
  })

  it('ignores a completion whose result is not an object', async () => {
    const { sock, ws } = await connectedSocket()
    emitMessage(ws, frame({ type: 3, invocationId: '0', result: 'oops' }) + frame({ type: 3, invocationId: '0' }))
    expect(sock.getData()!.streams).toEqual({})
  })

  it('accepts a payload with empty segments and a trailing separator', async () => {
    const { sock, ws } = await connectedSocket()
    emitMessage(ws, RS + RS + feed('TimingData', { n: 1 }) + RS)
    expect(sock.getData()!.streams.TimingData).toHaveLength(1)
  })

  it('records the arrival time of each point relative to connect, in seconds', async () => {
    const { sock, ws } = await connectedSocket()
    vi.setSystemTime(NOW + 12_500)
    emitMessage(ws, feed('TimingData', { n: 1 }))
    const data = sock.getData()!
    expect(data.streams.TimingData[0].t).toBeCloseTo(12.5, 3)
    expect(data.duration).toBeCloseTo(12.5, 3)
  })

  it('only republishes status on the first feed message and every 25th thereafter', async () => {
    const { sock, ws } = await connectedSocket()
    const seen: LiveStatus[] = []
    sock.setStatusListener((s) => seen.push(s))
    for (let i = 0; i < 24; i++) emitMessage(ws, feed('TimingData', { i }))
    expect(seen).toHaveLength(1) // message #1
    emitMessage(ws, feed('TimingData', { i: 24 })) // message #25
    expect(seen).toHaveLength(2)
    expect(seen[1].messages).toBe(25)
  })
})

describe('compressed (.z) topics', () => {
  it('inflates CarData.z into the CarData stream and flips gatedData', async () => {
    const { sock, ws } = await connectedSocket()
    const entry = { Entries: [{ Utc: 'x', Cars: { '1': { Channels: { '0': 11000 } } } }] }
    emitMessage(ws, feed('CarData.z', zpayload(entry)))
    const data = sock.getData()!
    expect(data.streams.CarData).toHaveLength(1)
    expect(data.streams.CarData[0].d).toEqual(entry)
    expect(data.streams['CarData.z']).toBeUndefined()
    expect(sock.getStatus().gatedData).toBe(true)
  })

  it('drops a .z payload that is not valid base64/deflate without throwing or claiming gated data', async () => {
    const { sock, ws } = await connectedSocket()
    emitMessage(ws, feed('Position.z', 'this is not deflate!!'))
    emitMessage(ws, feed('Position.z', Buffer.from('plain text, not deflated').toString('base64')))
    emitMessage(ws, feed('Position.z', 12345))
    emitMessage(ws, feed('Position.z', ''))
    // deflate of non-JSON text
    emitMessage(ws, feed('Position.z', deflateRawSync(Buffer.from('not json {')).toString('base64')))
    const data = sock.getData()!
    expect(data.streams.Position).toBeUndefined()
    expect(data.cursors.Position).toBeUndefined()
    // The socket survives and keeps ingesting good frames afterwards.
    emitMessage(ws, feed('Position.z', zpayload({ Position: [] })))
    expect(sock.getData()!.streams.Position).toHaveLength(1)
    expect(sock.getStatus().state).toBe('connected')
  })

  it('does not report gated data until a gated topic actually arrives', async () => {
    const { sock, ws } = await connectedSocket()
    emitMessage(ws, feed('TimingData', { a: 1 }))
    expect(sock.getStatus().gatedData).toBe(false)
  })
})

describe('status transitions', () => {
  it('goes connecting -> connected and notifies the listener', async () => {
    const sock = new F1LiveSocket()
    const states: string[] = []
    sock.setStatusListener((s) => states.push(s.state))
    await connectAndHandshake(sock)
    expect(states[0]).toBe('connecting')
    expect(states[states.length - 1]).toBe('connected')
    expect(states).not.toContain('error')
  })

  it('reports closed with the close code when the server drops the connection', async () => {
    const { sock, ws } = await connectedSocket()
    ws.emit('close', 1006)
    expect(sock.getStatus()).toMatchObject({ state: 'closed', detail: 'closed (1006)' })
  })

  it('stops the keepalive ping once the connection closes', async () => {
    const { ws } = await connectedSocket()
    await vi.advanceTimersByTimeAsync(10_000)
    const pings = () => ws.sent.filter((s) => s === frame({ type: 6 })).length
    expect(pings()).toBe(1)
    await vi.advanceTimersByTimeAsync(20_000)
    expect(pings()).toBe(3)
    ws.emit('close', 1000)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(pings()).toBe(3)
  })

  it('does not throw if a keepalive ping fails to send', async () => {
    const { ws } = await connectedSocket()
    ws.send = () => {
      throw new Error('socket not open')
    }
    await expect(vi.advanceTimersByTimeAsync(10_000)).resolves.not.toThrow()
  })

  it('disconnect() closes the socket and reports disconnected; a second call is harmless', async () => {
    const { sock, ws } = await connectedSocket()
    sock.disconnect()
    expect(ws.closed).toBe(true)
    expect(sock.getStatus()).toMatchObject({ state: 'closed', detail: 'disconnected' })
    sock.disconnect()
    expect(sock.getStatus().detail).toBe('disconnected')
  })

  it('disconnect() on a never-connected socket leaves it idle', () => {
    const sock = new F1LiveSocket()
    sock.disconnect()
    expect(sock.getStatus().state).toBe('idle')
  })

  it('a reconnect discards the previous connection, its data and its listeners', async () => {
    queueNegotiate(negotiateOk('one'))
    const sock = new F1LiveSocket()
    const first = await connectAndHandshake(sock)
    emitMessage(first.ws, feed('TimingData', { old: true }))
    expect(sock.getData()!.streams.TimingData).toHaveLength(1)

    queueNegotiate(negotiateOk('two'))
    const second = await connectAndHandshake(sock)
    expect(first.ws.closed).toBe(true)
    expect(second.ws).not.toBe(first.ws)
    expect(second.ws.url).toContain('id=two')

    // Frames from the dead socket no longer reach the shared state.
    emitMessage(first.ws, feed('TimingData', { stale: true }))
    const data = sock.getData()!
    expect(data.streams.TimingData).toBeUndefined()
    expect(sock.getStatus().messages).toBe(0)
  })

  it('a failed reconnect leaves the socket in error and data unavailable state consistent', async () => {
    const { sock } = await connectedSocket()
    queueNegotiate(new Response('', { status: 500 }))
    const status = await sock.connect()
    expect(status.state).toBe('error')
    expect(sock.getData()!.streams).toEqual({}) // reset by the reconnect, not stale
  })

  // Regression: connect() used to have no staleness check after `await this.negotiate()`,
  // so two overlapping calls (e.g. a double-clicked "Connect") each opened a WebSocket and
  // the first was orphaned, still writing into the shared streams. The older call now
  // stands down once a newer one has started.
  it('an overlapping connect() leaves exactly one live websocket', async () => {
    const sock = new F1LiveSocket()
    const p1 = sock.connect()
    const p2 = sock.connect()
    await flush()
    const open = FakeWebSocket.instances.filter((w) => !w.closed)
    void p1
    void p2
    expect(open).toHaveLength(1)
  })
})

describe('getData', () => {
  it('returns null while idle', () => {
    expect(new F1LiveSocket().getData()).toBeNull()
  })

  it('returns cursors that continue exactly where the previous delta ended', async () => {
    const { sock, ws } = await connectedSocket()
    for (let i = 0; i < 5; i++) emitMessage(ws, feed('TimingData', { i }))
    const first = sock.getData()!
    expect(first.streams.TimingData).toHaveLength(5)
    expect(first.cursors.TimingData).toBe(5)

    for (let i = 5; i < 8; i++) emitMessage(ws, feed('TimingData', { i }))
    const second = sock.getData(first.cursors, first.generation)!
    expect(second.streams.TimingData.map((p) => (p.d as { i: number }).i)).toEqual([5, 6, 7])
    expect(second.cursors.TimingData).toBe(8)

    const third = sock.getData(second.cursors, second.generation)!
    expect(third.streams.TimingData).toEqual([])
    expect(third.cursors.TimingData).toBe(8)
  })

  it('serves a delta only for topics that advanced, addressing each topic independently', async () => {
    const { sock, ws } = await connectedSocket()
    emitMessage(ws, feed('TimingData', { a: 1 }) + feed('WeatherData', { w: 1 }))
    const first = sock.getData()!
    emitMessage(ws, feed('WeatherData', { w: 2 }))
    const next = sock.getData(first.cursors, first.generation)!
    expect(next.streams.TimingData).toEqual([])
    expect(next.streams.WeatherData).toHaveLength(1)
  })

  it('ignores cursors when the generation argument is omitted or stale', async () => {
    const { sock, ws } = await connectedSocket()
    for (let i = 0; i < 4; i++) emitMessage(ws, feed('TimingData', { i }))
    const first = sock.getData()!
    expect(sock.getData(first.cursors)!.streams.TimingData).toHaveLength(4) // no generation
    expect(sock.getData(first.cursors, first.generation - 1)!.streams.TimingData).toHaveLength(4)
    expect(sock.getData(first.cursors, first.generation)!.streams.TimingData).toHaveLength(0)
  })

  it('bumps the generation on reconnect so cursors from the old connection are ignored', async () => {
    const { sock, ws } = await connectedSocket()
    for (let i = 0; i < 4; i++) emitMessage(ws, feed('TimingData', { i }))
    const old = sock.getData()!

    queueNegotiate(negotiateOk('again'))
    const again = await connectAndHandshake(sock)
    for (let i = 0; i < 2; i++) emitMessage(again.ws, feed('TimingData', { i: 100 + i }))
    const fresh = sock.getData(old.cursors, old.generation)!
    expect(fresh.generation).toBeGreaterThan(old.generation)
    // The old cursor (4) would have skipped both new points if it had been honoured.
    expect(fresh.streams.TimingData).toHaveLength(2)
    expect(fresh.cursors.TimingData).toBe(2)
  })

  it('treats non-finite, negative and out-of-range cursors safely', async () => {
    const { sock, ws } = await connectedSocket()
    for (let i = 0; i < 6; i++) emitMessage(ws, feed('TimingData', { i }))
    const gen = sock.getData()!.generation
    const len = (c: number) => sock.getData({ TimingData: c }, gen)!.streams.TimingData.length
    expect(len(Number.NaN)).toBe(6)
    expect(len(Number.POSITIVE_INFINITY)).toBe(6)
    expect(len(-10)).toBe(6)
    expect(len(1e9)).toBe(0)
    expect(len(2.9)).toBe(4) // truncated toward the last whole point
    expect(sock.getData({ TimingData: 'x' as unknown as number }, gen)!.streams.TimingData).toHaveLength(6)
  })

  it('keeps the cursor absolute when the retention cap trims the oldest telemetry', async () => {
    const { sock, ws } = await connectedSocket()
    const CHUNK = 500
    for (let i = 0; i < 20_000; i += CHUNK) {
      let batch = ''
      for (let j = 0; j < CHUNK; j++) batch += feed('CarData', { i: i + j })
      emitMessage(ws, batch)
    }
    const atCap = sock.getData()!
    expect(atCap.cursors.CarData).toBe(20_000)
    expect(atCap.streams.CarData).toHaveLength(20_000)

    // One point over the cap trims a 2,000-point chunk from the front.
    emitMessage(ws, feed('CarData', { i: 20_000 }))
    const afterTrim = sock.getData(atCap.cursors, atCap.generation)!
    expect(afterTrim.cursors.CarData).toBe(20_001)
    // Renderer already held 0..19,999; the only new point is #20,000.
    expect(afterTrim.streams.CarData.map((p) => (p.d as { i: number }).i)).toEqual([20_000])

    // A brand new reader gets only what is retained: 18,001 points, 2,000..20,000.
    const fresh = sock.getData()!
    expect(fresh.streams.CarData).toHaveLength(18_001)
    expect((fresh.streams.CarData[0].d as { i: number }).i).toBe(2_000)
    // A reader whose cursor points into the trimmed region gets everything held.
    const behind = sock.getData({ CarData: 500 }, atCap.generation)!
    expect(behind.streams.CarData).toHaveLength(18_001)
  })

  it('never caps non-telemetry topics', async () => {
    const { sock, ws } = await connectedSocket()
    for (let i = 0; i < 20_500; i += 500) {
      let batch = ''
      for (let j = 0; j < 500; j++) batch += feed('TimingData', { i: i + j })
      emitMessage(ws, batch)
    }
    expect(sock.getData()!.streams.TimingData).toHaveLength(20_500)
  })
})

describe('session info, liveness and summary', () => {
  const SESSION = {
    Meeting: {
      Key: 1300,
      Name: 'Belgian Grand Prix',
      OfficialName: 'FORMULA 1 MSC CRUISES BELGIAN GRAND PRIX 2026',
      Location: 'Spa-Francorchamps',
      Country: { Code: 'BEL', Name: 'Belgium' },
      Circuit: { ShortName: 'Spa-Francorchamps' }
    },
    Key: 9900,
    Type: 'Race',
    Name: 'Race',
    Path: '2026/2026-07-05_Belgian_Grand_Prix/2026-07-05_Race/',
    // 15:00-17:00 local at UTC+2 -> 13:00-15:00Z; NOW (14:00Z) is inside.
    StartDate: '2026-07-05T15:00:00',
    EndDate: '2026-07-05T17:00:00',
    GmtOffset: '02:00:00',
    ArchiveStatus: { Status: 'Generating' }
  }

  it('summarises SessionInfo and calls a session inside its window live', async () => {
    const { sock, ws } = await connectedSocket()
    emitMessage(ws, completion({ SessionInfo: structuredClone(SESSION) }))
    const { summary, sessionInfo } = sock.getData()!
    expect(summary).toMatchObject({
      path: 'live',
      key: 9900,
      meetingName: 'Belgian Grand Prix',
      name: 'Race',
      type: 'Race',
      countryCode: 'BEL',
      countryName: 'Belgium',
      location: 'Spa-Francorchamps',
      circuitShortName: 'Spa-Francorchamps',
      gmtOffset: '02:00:00',
      archiveStatus: 'Generating',
      liveStreamActive: true,
      feedPath: SESSION.Path
    })
    expect(sessionInfo).toMatchObject({ Key: 9900 })
    expect(sock.getStatus().sessionName).toBe('Belgian Grand Prix · Race')
    expect(sock.getStatus().live).toBe(true)
  })

  it('falls back to placeholder summary fields before any SessionInfo arrives', async () => {
    const { sock } = await connectedSocket()
    expect(sock.getData()!.summary).toMatchObject({
      path: 'live',
      key: 0,
      meetingName: 'Live Session',
      name: 'Live',
      type: 'Unknown',
      liveStreamActive: false,
      feedPath: null
    })
  })

  it('merges SessionInfo deltas onto the keyframe instead of replacing it', async () => {
    const { sock, ws } = await connectedSocket()
    emitMessage(ws, completion({ SessionInfo: structuredClone(SESSION) }))
    emitMessage(ws, feed('SessionInfo', { ArchiveStatus: { Status: 'Complete' } }))
    const { summary } = sock.getData()!
    expect(summary.meetingName).toBe('Belgian Grand Prix') // survived the small delta
    expect(summary.archiveStatus).toBe('Complete')
    expect(summary.liveStreamActive).toBe(false) // sealed archive -> not live
  })

  it('lets the dedicated SessionStatus topic override a stale SessionInfo keyframe', async () => {
    const { sock, ws } = await connectedSocket()
    emitMessage(ws, completion({ SessionInfo: structuredClone(SESSION) }))
    expect(sock.getData()!.summary.liveStreamActive).toBe(true)
    emitMessage(ws, feed('SessionStatus', { Status: 'Finalised' }))
    expect(sock.getData()!.summary.liveStreamActive).toBe(false)
    // An empty/garbage status does not clobber the last good one.
    emitMessage(ws, feed('SessionStatus', { Status: '' }) + feed('SessionStatus', null))
    expect(sock.getData()!.summary.liveStreamActive).toBe(false)
  })

  it('is not live once the scheduled end is more than the grace window past', async () => {
    const { sock, ws } = await connectedSocket()
    emitMessage(ws, completion({ SessionInfo: structuredClone(SESSION) }))
    vi.setSystemTime(Date.parse('2026-07-05T19:00:00Z')) // end 15:00Z + 3h grace = 18:00Z
    expect(sock.getData()!.summary.liveStreamActive).toBe(false)
  })

  it('does not count Heartbeat as evidence of a live session when the SessionInfo has no schedule', async () => {
    const { sock, ws } = await connectedSocket()
    emitMessage(ws, completion({ SessionInfo: { Name: 'Mystery', Meeting: { Name: 'X' } } }))
    emitMessage(ws, feed('Heartbeat', { Utc: 'now' }) + feed('Heartbeat', { Utc: 'later' }))
    expect(sock.getData()!.summary.liveStreamActive).toBe(false)
    emitMessage(ws, feed('TimingData', { Lines: {} }))
    expect(sock.getData()!.summary.liveStreamActive).toBe(true)
  })

  it('explains an idle feed by naming the finished event it last covered', async () => {
    const { sock, ws } = await connectedSocket()
    emitMessage(
      ws,
      completion({
        SessionInfo: { ...structuredClone(SESSION), ArchiveStatus: { Status: 'Complete' } }
      })
    )
    const s = sock.getStatus()
    expect(s.live).toBe(false)
    expect(s.detail).toContain('No live session right now')
    expect(s.detail).toContain('Belgian Grand Prix · Race')
  })

  it('distinguishes anonymous, authenticated-but-waiting and gated-data live details', async () => {
    // anonymous
    queueNegotiate(negotiateOk())
    const anon = new F1LiveSocket()
    const a = await connectAndHandshake(anon)
    emitMessage(a.ws, completion({ SessionInfo: structuredClone(SESSION) }))
    expect(anon.getStatus().detail).toMatch(/public timing/)

    // authenticated, telemetry not flowing yet
    queueNegotiate(negotiateOk())
    const auth = new F1LiveSocket()
    const b = await connectAndHandshake(auth, { bearer: 'jwt' })
    emitMessage(b.ws, completion({ SessionInfo: structuredClone(SESSION) }))
    expect(auth.getStatus().detail).toMatch(/waiting for telemetry/)

    // telemetry arrives -> full data
    emitMessage(b.ws, feed('CarData.z', zpayload({ Entries: [] })))
    for (let i = 0; i < 24; i++) emitMessage(b.ws, feed('TimingData', { i })) // reach message #25 -> republish
    expect(auth.getStatus().detail).toMatch(/full F1 TV data/)
    expect(auth.getStatus().gatedData).toBe(true)
  })
})

describe('WeatherDataSeries backfill', () => {
  const series = (...stamps: string[]) => ({
    Series: stamps.map((Timestamp, i) => ({ Timestamp, Weather: { AirTemp: String(20 + i) } }))
  })

  it('expands history into WeatherData with negative t for samples before connect, sorted', async () => {
    const { sock, ws } = await connectedSocket()
    emitMessage(ws, feed('WeatherData', { AirTemp: '25' })) // lands at t=0
    emitMessage(ws, feed('WeatherDataSeries', series('2026-07-05T13:58:00Z', '2026-07-05T13:59:00Z')))
    const data = sock.getData()!
    expect(data.streams.WeatherDataSeries).toBeUndefined()
    const ts = data.streams.WeatherData.map((p) => p.t)
    expect(ts).toEqual([-120, -60, 0])
    expect(data.streams.WeatherData[2].d).toEqual({ AirTemp: '25' })
  })

  it('skips malformed series entries and duplicate timestamps', async () => {
    const { sock, ws } = await connectedSocket()
    emitMessage(
      ws,
      feed('WeatherDataSeries', {
        Series: [
          null,
          { Timestamp: 5, Weather: {} },
          { Timestamp: 'garbage', Weather: {} },
          { Timestamp: '2026-07-05T13:59:00Z' }, // no Weather
          { Timestamp: '2026-07-05T13:59:00Z', Weather: { AirTemp: '1' } },
          { Timestamp: '2026-07-05T13:59:00Z', Weather: { AirTemp: '2' } }
        ]
      })
    )
    const pts = sock.getData()!.streams.WeatherData
    expect(pts).toHaveLength(1)
    expect(pts[0].d).toEqual({ AirTemp: '1' })
  })

  it('ignores a series payload without a Series array', async () => {
    const { sock, ws } = await connectedSocket()
    emitMessage(ws, feed('WeatherDataSeries', { Series: 'nope' }) + feed('WeatherDataSeries', null))
    expect(sock.getData()!.streams.WeatherData).toBeUndefined()
  })

  it('never inserts behind a cursor the renderer already holds once a snapshot was read', async () => {
    const { sock, ws } = await connectedSocket()
    emitMessage(ws, feed('WeatherData', { AirTemp: '25' }))
    const first = sock.getData()! // published
    emitMessage(
      ws,
      feed('WeatherDataSeries', series('2026-07-05T13:50:00Z', '2026-07-05T14:00:30Z'))
    )
    const delta = sock.getData(first.cursors, first.generation)!
    // The old (t<=0) sample is dropped; the future one is appended after the cursor.
    expect(delta.streams.WeatherData.map((p) => p.t)).toEqual([30])
    expect(delta.cursors.WeatherData).toBe(2)
  })
})

describe('disconnect / connect races', () => {
  /** A negotiate that stays pending until the test releases it. */
  function deferredNegotiate(): { release: () => void } {
    let release!: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })
    fetchMock.mockReset()
    fetchMock.mockImplementation(async () => {
      await gate
      return negotiateOk()
    })
    return { release }
  }

  /** Track whether a promise has settled without awaiting it. */
  function watch<T>(p: Promise<T>): { settled: boolean; value?: T } {
    const box: { settled: boolean; value?: T } = { settled: false }
    void p.then((v) => {
      box.settled = true
      box.value = v
    })
    return box
  }

  it('a disconnect() during negotiate keeps the pending connect() from opening a websocket', async () => {
    const gate = deferredNegotiate()
    const sock = new F1LiveSocket()
    const p = sock.connect()
    await flush()
    sock.disconnect()
    gate.release()
    const status = await p
    await flush()
    expect(FakeWebSocket.instances).toHaveLength(0)
    expect(status.state).toBe('closed')
    expect(sock.getStatus()).toMatchObject({ state: 'closed', detail: 'disconnected' })
  })

  it('a disconnect() bumps the generation so cursors from before it are ignored', async () => {
    const { sock, ws } = await connectedSocket()
    emitMessage(ws, feed('TimingData', { n: 1 }))
    const before = sock.getData()!
    sock.disconnect()
    expect(sock.getData(before.cursors, before.generation)!.generation).toBeGreaterThan(
      before.generation
    )
  })

  it('settles a connect() whose websocket is closed by disconnect() before the handshake', async () => {
    const sock = new F1LiveSocket()
    const p = sock.connect()
    await flush()
    expect(FakeWebSocket.instances).toHaveLength(1)
    const box = watch(p)
    sock.disconnect()
    await flush()
    expect(box.settled).toBe(true)
    expect(box.value?.state).toBe('closed')
  })

  it('settles a connect() when the server closes the socket before the handshake completes', async () => {
    const sock = new F1LiveSocket()
    const p = sock.connect()
    await flush()
    const box = watch(p)
    latestWs().emit('close', 1006)
    await flush()
    expect(box.settled).toBe(true)
    expect(box.value).toMatchObject({ state: 'closed', detail: 'closed (1006)' })
  })

  it('a second connect() during the first one leaves one live socket and settles both promises', async () => {
    const sock = new F1LiveSocket()
    const p1 = sock.connect()
    await flush()
    const first = latestWs()
    const box1 = watch(p1)
    const p2 = sock.connect()
    await flush()
    const second = latestWs()
    expect(second).not.toBe(first)
    expect(first.closed).toBe(true)
    expect(box1.settled).toBe(true)
    second.emit('open')
    emitMessage(second, '{}' + RS)
    expect((await p2).state).toBe('connected')
    expect(FakeWebSocket.instances.filter((w) => !w.closed)).toHaveLength(1)
  })

  it('attaches an error listener before closing a still-connecting socket (ws emits on nextTick)', async () => {
    const sock = new F1LiveSocket()
    const p = sock.connect()
    await flush()
    const ws = latestWs()
    sock.disconnect()
    await p
    expect(ws.errorListenersAtClose).toBeGreaterThanOrEqual(1)
    // The deferred "closed before the connection was established" error must not throw.
    await flush()
    expect(ws.listenerCount('error')).toBeGreaterThanOrEqual(1)
  })

  it('also guards the close performed when a handshake is rejected', async () => {
    const sock = new F1LiveSocket()
    const p = sock.connect()
    await flush()
    const ws = latestWs()
    ws.emit('open')
    emitMessage(ws, JSON.stringify({ error: 'nope' }) + RS)
    await p
    expect(ws.errorListenersAtClose).toBeGreaterThanOrEqual(1)
  })
})

describe('status is a fresh object per update', () => {
  it('getStatus reflects the message counter and subscription flag', async () => {
    queueNegotiate(negotiateOk())
    const sock = new F1LiveSocket()
    const { ws } = await connectAndHandshake(sock, { cookieHeader: 'c=1' })
    emitMessage(ws, feed('TimingData', {}))
    const s = sock.getStatus()
    expect(s.messages).toBe(1)
    expect(s.subscription).toBe(true)
  })
})
