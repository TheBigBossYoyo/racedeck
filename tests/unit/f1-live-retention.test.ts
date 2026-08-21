import { describe, expect, it } from 'vitest'
import { F1LiveSocket } from '../../src/main/f1-live-socket'

/**
 * The delta protocol hands the renderer an ABSOLUTE cursor per topic. Trimming
 * old telemetry shifts array indices, so the socket must translate between the
 * two — get this wrong and the renderer silently skips or duplicates points.
 */

/** The socket's private retention state, reached deliberately for this test. */
interface SocketInternals {
  streams: Record<string, { t: number; d: unknown }[]>
  dropped: Record<string, number>
  status: { state: string }
}

/** A socket with a pre-seeded stream, bypassing the network. */
function socketWith(topic: string, points: number, dropped = 0): F1LiveSocket {
  const sock = new F1LiveSocket()
  const inner = sock as unknown as SocketInternals
  inner.status.state = 'connected'
  inner.streams[topic] = Array.from({ length: points }, (_, i) => ({ t: i, d: { i } }))
  if (dropped > 0) inner.dropped[topic] = dropped
  return sock
}

describe('live stream cursors', () => {
  it('reports a cursor covering the full history, including trimmed points', () => {
    const sock = socketWith('CarData', 100, 500)
    const data = sock.getData()
    // 500 discarded + 100 retained = 600 points have existed on this topic.
    expect(data?.cursors.CarData).toBe(600)
  })

  it('resumes from an absolute cursor that lands inside retained data', () => {
    const sock = socketWith('CarData', 100, 500)
    const first = sock.getData()
    // Ask again from absolute 550 → the last 50 retained points.
    const next = sock.getData({ CarData: 550 }, first?.generation)
    expect(next?.streams.CarData).toHaveLength(50)
    expect((next?.streams.CarData[0].d as { i: number }).i).toBe(50)
  })

  it('sends everything still held when the cursor points into trimmed history', () => {
    // The renderer asks from 100, but points before 500 are gone. It must get
    // all retained data rather than a slice computed from a stale index.
    const sock = socketWith('CarData', 100, 500)
    const first = sock.getData()
    const next = sock.getData({ CarData: 100 }, first?.generation)
    expect(next?.streams.CarData).toHaveLength(100)
  })

  it('returns nothing new when the cursor is already current', () => {
    const sock = socketWith('CarData', 100, 500)
    const first = sock.getData()
    const next = sock.getData({ CarData: 600 }, first?.generation)
    expect(next?.streams.CarData).toHaveLength(0)
  })

  it('ignores cursors from a superseded connection generation', () => {
    const sock = socketWith('CarData', 100, 500)
    const next = sock.getData({ CarData: 600 }, 999)
    expect(next?.streams.CarData).toHaveLength(100)
  })

  it('leaves untrimmed topics addressed by plain index', () => {
    const sock = socketWith('TimingData', 40)
    const first = sock.getData()
    expect(first?.cursors.TimingData).toBe(40)
    const next = sock.getData({ TimingData: 30 }, first?.generation)
    expect(next?.streams.TimingData).toHaveLength(10)
  })
})
