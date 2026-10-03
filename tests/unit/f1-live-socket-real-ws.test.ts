// @vitest-environment node
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * Uses the REAL `ws` package (redirected to a local server that never completes
 * the upgrade) because the crash this guards against is ws behaviour: closing a
 * CONNECTING socket emits 'error' on the next tick, and once the socket's
 * listeners are removed that is an uncaught exception in the main process.
 */

const target = vi.hoisted(() => ({ port: 0 }))

vi.mock('ws', async (importOriginal) => {
  const mod = await importOriginal<typeof import('ws')>()
  class Redirected extends mod.default {
    constructor(url: string, opts?: ConstructorParameters<typeof mod.default>[2]) {
      super(url.replace('wss://livetiming.formula1.com', `ws://127.0.0.1:${target.port}`), opts)
    }
  }
  return { ...mod, default: Redirected }
})

import { F1LiveSocket } from '../../src/main/f1-live-socket'

let server: Server
const stalledSockets = new Set<import('node:net').Socket>()

beforeAll(async () => {
  server = createServer()
  // Accept the TCP connection and the upgrade request, then never answer it.
  server.on('upgrade', (_req, socket) => {
    stalledSockets.add(socket)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  target.port = (server.address() as AddressInfo).port
})

afterAll(async () => {
  for (const s of stalledSockets) s.destroy()
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

describe('F1LiveSocket with a real ws client', () => {
  it('disconnecting mid-upgrade does not raise an uncaught exception', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ connectionToken: 'tok' }), { status: 200 }))
    )
    const uncaught: unknown[] = []
    const onUncaught = (err: unknown): void => {
      uncaught.push(err)
    }
    process.on('uncaughtException', onUncaught)
    try {
      const sock = new F1LiveSocket()
      const pending = sock.connect()
      // Let negotiate finish and the ws enter CONNECTING against the stalled server.
      await new Promise((r) => setTimeout(r, 100))
      sock.disconnect()
      const status = await pending
      // ws emits its "closed before established" error on the next tick.
      await new Promise((r) => setTimeout(r, 100))
      expect(status.state).toBe('closed')
      expect(uncaught).toEqual([])
    } finally {
      process.off('uncaughtException', onUncaught)
      vi.unstubAllGlobals()
    }
  })
})
