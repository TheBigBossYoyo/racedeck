import { afterEach, describe, expect, it, vi } from 'vitest'
import { deflateRawSync } from 'node:zlib'
import { F1LiveService } from '../../src/main/f1-live-service'

function zLine(data: unknown, time = '00:00:01.000'): string {
  const encoded = deflateRawSync(Buffer.from(JSON.stringify(data))).toString('base64')
  return `${time}${JSON.stringify(encoded)}\n`
}

function bodyStream(emit: (controller: ReadableStreamDefaultController<Uint8Array>) => Promise<void>): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      return emit(controller)
    }
  })
}

const encode = (text: string): Uint8Array => new TextEncoder().encode(text)

function streamLine(data: unknown, time = '00:00:01.000'): string {
  return `${time}${JSON.stringify(data)}\n`
}

describe('F1 archive enrichment', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('retries a transient high-rate feed failure', async () => {
    let carDataAttempts = 0
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = String(input)
      if (url.includes('CarData.z')) {
        carDataAttempts += 1
        if (carDataAttempts === 1) return Promise.reject(new Error('transient network failure'))
        return Promise.resolve(new Response(zLine({ Entries: [] }), { status: 200 }))
      }
      return Promise.resolve(new Response(zLine({ Position: [] }), { status: 200 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    const chunk = await new F1LiveService().loadSessionEnrichmentChunk({
      path: '2026/Test_Grand_Prix/2026-01-01_Race/',
      feed: 'carData',
      carDataOffset: 0,
      positionOffset: 0,
      limit: 250
    })
    const positionChunk = await new F1LiveService().loadSessionEnrichmentChunk({
      path: '2026/Test_Grand_Prix/2026-01-01_Race/',
      feed: 'position',
      carDataOffset: 0,
      positionOffset: 0,
      limit: 250
    })

    expect(carDataAttempts).toBe(2)
    expect(chunk.carData).toHaveLength(1)
    expect(chunk.position).toHaveLength(0)
    expect(positionChunk.position).toHaveLength(1)
    expect(positionChunk.carData).toHaveLength(0)
    expect(chunk.done).toBe(true)
    expect(positionChunk.done).toBe(true)
  })

  it('retries required core timing independently of other feeds', async () => {
    let timingAttempts = 0
    vi.stubGlobal('fetch', vi.fn((input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('SessionInfo.json')) return Promise.resolve(new Response('{}', { status: 200 }))
      if (url.includes('TimingData.jsonStream')) {
        timingAttempts += 1
        if (timingAttempts === 1) return Promise.reject(new Error('transient timing failure'))
        return Promise.resolve(new Response(streamLine({ Lines: { '1': { Position: '1' } } }), { status: 200 }))
      }
      if (url.includes('DriverList.jsonStream')) {
        return Promise.resolve(new Response(streamLine({ '1': { RacingNumber: '1', Tla: 'TST' } }), { status: 200 }))
      }
      return Promise.resolve(new Response('', { status: 200 }))
    }))

    const data = await new F1LiveService().loadSession('2026/Test_Grand_Prix/2026-01-01_Race/')

    expect(timingAttempts).toBe(2)
    expect(data.streams.TimingData).toHaveLength(1)
    expect(data.streams.DriverList).toHaveLength(1)
  })

  it('does not cache a session whose optional feed failed, so a reselect heals it', async () => {
    let raceControlFetches = 0
    vi.stubGlobal('fetch', vi.fn((input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('SessionInfo.json')) {
        return Promise.resolve(new Response('{"ArchiveStatus":{"Status":"Complete"}}', { status: 200 }))
      }
      if (url.includes('TimingData.jsonStream')) {
        return Promise.resolve(new Response(streamLine({ Lines: { '1': { Position: '1' } } }), { status: 200 }))
      }
      if (url.includes('DriverList.jsonStream')) {
        return Promise.resolve(new Response(streamLine({ '1': { RacingNumber: '1', Tla: 'TST' } }), { status: 200 }))
      }
      if (url.includes('RaceControlMessages.jsonStream')) {
        raceControlFetches += 1
        if (raceControlFetches === 1) return Promise.reject(new Error('transient race-control failure'))
        return Promise.resolve(new Response(streamLine({ Messages: [{ Message: 'GREEN LIGHT' }] }), { status: 200 }))
      }
      return Promise.resolve(new Response('', { status: 200 }))
    }))
    const service = new F1LiveService()

    const first = await service.loadSession('2026/Test_Grand_Prix/2026-01-01_Race/')
    const second = await service.loadSession('2026/Test_Grand_Prix/2026-01-01_Race/')

    expect(first.streams.RaceControlMessages).toEqual([])
    expect(raceControlFetches).toBe(2)
    expect(second.streams.RaceControlMessages).toHaveLength(1)
    expect(second.streams.TimingData).toHaveLength(1)
  })

  it('rejects a partial archive that has no usable timing feed', async () => {
    vi.stubGlobal('fetch', vi.fn((input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('SessionInfo.json')) return Promise.resolve(new Response('{}', { status: 200 }))
      if (url.includes('DriverList.jsonStream')) {
        return Promise.resolve(new Response(streamLine({ '1': null }), { status: 200 }))
      }
      if (url.includes('TimingData.jsonStream')) {
        return Promise.resolve(new Response(streamLine({ Lines: { '1': null } }), { status: 200 }))
      }
      return Promise.resolve(new Response('', { status: 200 }))
    }))

    await expect(
      new F1LiveService().loadSession('2026/Test_Grand_Prix/2026-01-01_Race/')
    ).rejects.toThrow('no usable timing data')
  })

  it('commits a validated timing prefix while the tail streams, and requests Position immediately', async () => {
    let releaseTail: () => void = () => {}
    const tailGate = new Promise<void>((resolve) => { releaseTail = resolve })
    const requests: string[] = []
    vi.stubGlobal('fetch', vi.fn((input: string | URL | Request) => {
      const url = String(input)
      requests.push(url)
      if (url.endsWith('SessionInfo.json')) {
        return Promise.resolve(new Response('{"ArchiveStatus":{"Status":"Complete"}}', { status: 200 }))
      }
      if (url.includes('TimingData.jsonStream')) {
        return Promise.resolve(new Response(bodyStream(async (controller) => {
          controller.enqueue(encode(streamLine({ Lines: { '1': { Position: '1' } } }, '00:00:01.000')))
          await tailGate
          controller.enqueue(encode(streamLine({ Lines: { '1': { Position: '2' } } }, '00:00:02.000')))
          controller.close()
        }), { status: 200 }))
      }
      if (url.includes('DriverList.jsonStream')) {
        return Promise.resolve(new Response(streamLine({ '1': { RacingNumber: '1', Tla: 'TST' } }), { status: 200 }))
      }
      if (url.includes('Position.z')) {
        return Promise.resolve(new Response(zLine({ Position: [] }), { status: 200 }))
      }
      return Promise.resolve(new Response('', { status: 200 }))
    }))
    const service = new F1LiveService()

    const data = await service.loadSession('2026/Test_Grand_Prix/2026-01-01_Race/')

    // The session commits on the validated prefix while the tail is still open,
    // and the Position request went out without waiting for TimingData.
    expect(data.partialTiming).toBe(true)
    expect(data.streams.TimingData).toHaveLength(1)
    expect(requests.some((url) => url.includes('Position.z'))).toBe(true)

    const tail = service.loadSessionEnrichmentChunk({
      path: '2026/Test_Grand_Prix/2026-01-01_Race/',
      feed: 'timing',
      carDataOffset: 0,
      positionOffset: 0,
      timingOffset: 1,
      limit: 250
    })
    releaseTail()
    const chunk = await tail

    expect(chunk.timing?.map((point) => point.t)).toEqual([2])
    expect(chunk.nextTimingOffset).toBe(2)
    expect(chunk.done).toBe(true)
  })

  it('serves early chunks while the download is still streaming', async () => {
    let releaseTail: () => void = () => {}
    const tailGate = new Promise<void>((resolve) => { releaseTail = resolve })
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(bodyStream(async (controller) => {
      controller.enqueue(encode(zLine({ Position: [] }, '00:00:01.000')))
      controller.enqueue(encode(zLine({ Position: [] }, '00:00:02.000')))
      await tailGate
      controller.enqueue(encode(zLine({ Position: [] }, '00:00:03.000')))
      controller.close()
    }), { status: 200 }))))
    const service = new F1LiveService()

    const first = await service.loadSessionEnrichmentChunk({
      path: '2026/Test_Grand_Prix/2026-01-01_Race/',
      feed: 'position',
      carDataOffset: 0,
      positionOffset: 0,
      limit: 2
    })
    expect(first.position.map((point) => point.t)).toEqual([1, 2])
    expect(first.done).toBe(false)

    releaseTail()
    const rest = await service.loadSessionEnrichmentChunk({
      path: '2026/Test_Grand_Prix/2026-01-01_Race/',
      feed: 'position',
      carDataOffset: 0,
      positionOffset: first.nextPositionOffset,
      limit: 250
    })
    expect(rest.position.map((point) => point.t)).toEqual([3])
    expect(rest.done).toBe(true)
  })

  it('resumes a mid-stream failure without disturbing served offsets', async () => {
    let attempts = 0
    vi.stubGlobal('fetch', vi.fn(() => {
      attempts += 1
      if (attempts === 1) {
        return Promise.resolve(new Response(bodyStream(async (controller) => {
          controller.enqueue(encode(zLine({ Position: [] }, '00:00:01.000')))
          controller.enqueue(encode(zLine({ Position: [] }, '00:00:02.000')))
          controller.error(new Error('mid-stream network failure'))
        }), { status: 200 }))
      }
      return Promise.resolve(new Response(
        zLine({ Position: [] }, '00:00:01.000') +
        zLine({ Position: [] }, '00:00:02.000') +
        zLine({ Position: [] }, '00:00:03.000'),
        { status: 200 }
      ))
    }))
    const service = new F1LiveService()

    const first = await service.loadSessionEnrichmentChunk({
      path: '2026/Test_Grand_Prix/2026-01-01_Race/',
      feed: 'position',
      carDataOffset: 0,
      positionOffset: 0,
      limit: 2
    })
    const rest = await service.loadSessionEnrichmentChunk({
      path: '2026/Test_Grand_Prix/2026-01-01_Race/',
      feed: 'position',
      carDataOffset: 0,
      positionOffset: first.nextPositionOffset,
      limit: 250
    })

    expect(attempts).toBe(2)
    expect(first.position.map((point) => point.t)).toEqual([1, 2])
    expect(rest.position.map((point) => point.t)).toEqual([3])
    expect(rest.done).toBe(true)
  })

  it('runtime-validates enrichment requests and caps remote offsets', async () => {
    vi.stubGlobal('fetch', vi.fn(() =>
      Promise.resolve(new Response(zLine({ Position: [] }), { status: 200 }))
    ))
    const service = new F1LiveService()

    await expect(service.loadSessionEnrichmentChunk(null)).rejects.toThrow('Invalid F1 enrichment request')
    const chunk = await service.loadSessionEnrichmentChunk({
      path: '2026/Test_Grand_Prix/2026-01-01_Race/',
      feed: 'position',
      carDataOffset: 0,
      positionOffset: Number.MAX_SAFE_INTEGER,
      limit: 10_000
    })

    expect(chunk.nextPositionOffset).toBe(1_000_000)
    expect(chunk.done).toBe(true)
  })
})
