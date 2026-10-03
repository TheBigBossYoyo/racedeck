import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runPlugin } from '@renderer/lib/pluginRunner'
import type { PluginSnapshot } from '@renderer/core/engines/PluginSnapshotApi'

const snapshot: PluginSnapshot = { clock: 0, currentLap: null, trackStatus: 'CLEAR' }

class FakeWorker {
  static instances: FakeWorker[] = []
  static throwOnConstruct: Error | null = null
  static postMessageError: Error | null = null
  onmessage: ((e: { data: unknown }) => void) | null = null
  onerror: ((e: { message: string }) => void) | null = null
  terminate = vi.fn()
  postMessage = vi.fn(() => {
    if (FakeWorker.postMessageError) throw FakeWorker.postMessageError
  })
  constructor(public url: string) {
    if (FakeWorker.throwOnConstruct) throw FakeWorker.throwOnConstruct
    FakeWorker.instances.push(this)
  }
}

const urlStatics = URL as unknown as {
  createObjectURL?: unknown
  revokeObjectURL?: unknown
}
let originalCreate: unknown
let originalRevoke: unknown
let revoke: ReturnType<typeof vi.fn>

describe('runPlugin worker lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    FakeWorker.instances = []
    FakeWorker.throwOnConstruct = null
    FakeWorker.postMessageError = null
    originalCreate = urlStatics.createObjectURL
    originalRevoke = urlStatics.revokeObjectURL
    revoke = vi.fn()
    urlStatics.createObjectURL = vi.fn(() => 'blob:fake-harness')
    urlStatics.revokeObjectURL = revoke
    vi.stubGlobal('Worker', FakeWorker)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    urlStatics.createObjectURL = originalCreate
    urlStatics.revokeObjectURL = originalRevoke
  })

  it('terminates the worker and revokes the blob URL when the plugin times out', async () => {
    const pending = runPlugin('function compute(){ while(true){} }', snapshot)
    const worker = FakeWorker.instances[0]
    expect(worker.terminate).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1000)

    await expect(pending).resolves.toEqual({ error: expect.stringContaining('timed out') })
    expect(worker.terminate).toHaveBeenCalledTimes(1)
    expect(revoke).toHaveBeenCalledWith('blob:fake-harness')
  })

  it('does not accumulate workers: each timed-out run terminates its own', async () => {
    const runs = [1, 2, 3].map(() => runPlugin('x', snapshot))
    await vi.advanceTimersByTimeAsync(1000)
    await Promise.all(runs)
    expect(FakeWorker.instances).toHaveLength(3)
    for (const w of FakeWorker.instances) expect(w.terminate).toHaveBeenCalledTimes(1)
  })

  it('terminates the worker exactly once on a normal reply and sanitizes the result', async () => {
    const pending = runPlugin('x', snapshot)
    const worker = FakeWorker.instances[0]
    worker.onmessage?.({ data: { ok: true, result: { a: 1, bad: { nested: true } } } })

    await expect(pending).resolves.toEqual({ a: 1 })
    expect(worker.terminate).toHaveBeenCalledTimes(1)
    // The timeout firing afterwards must not double-terminate or override the result.
    await vi.advanceTimersByTimeAsync(2000)
    expect(worker.terminate).toHaveBeenCalledTimes(1)
  })

  it('surfaces a plugin runtime error message from the harness', async () => {
    const pending = runPlugin('x', snapshot)
    FakeWorker.instances[0].onmessage?.({ data: { ok: false, error: 'compute is not defined' } })
    await expect(pending).resolves.toEqual({ error: 'compute is not defined' })
  })

  it('adds a CSP hint when the harness reports an unsafe-eval refusal', async () => {
    const pending = runPlugin('x', snapshot)
    FakeWorker.instances[0].onmessage?.({
      data: {
        ok: false,
        error:
          "Refused to evaluate a string as JavaScript because 'unsafe-eval' is not an allowed source of script"
      }
    })
    const result = await pending
    expect(result).toEqual({ error: expect.stringContaining('unsafe-eval') })
    expect((result as { error: string }).error).toMatch(/Content Security Policy/i)
  })

  it('reports an honest sandbox-start failure when the worker errors with no message', async () => {
    const pending = runPlugin('x', snapshot)
    const worker = FakeWorker.instances[0]
    worker.onerror?.({ message: '' })

    const result = await pending
    expect((result as { error: string }).error).toMatch(/sandbox/i)
    expect((result as { error: string }).error).toMatch(/Content Security Policy/i)
    expect((result as { error: string }).error).not.toBe('Plugin crashed.')
    expect(worker.terminate).toHaveBeenCalledTimes(1)
    expect(revoke).toHaveBeenCalledWith('blob:fake-harness')
  })

  it('keeps a non-empty worker error message', async () => {
    const pending = runPlugin('x', snapshot)
    FakeWorker.instances[0].onerror?.({ message: 'Uncaught SyntaxError: nope' })
    await expect(pending).resolves.toEqual({ error: 'Uncaught SyntaxError: nope' })
  })

  it('surfaces the real error when constructing the Worker throws (e.g. CSP SecurityError)', async () => {
    FakeWorker.throwOnConstruct = new Error(
      "Access to the script at 'blob:x' is denied by the document's Content Security Policy."
    )
    const result = await runPlugin('x', snapshot)
    expect(result).toEqual({ error: expect.stringContaining('Content Security Policy') })
    expect((result as { error: string }).error).toMatch(/sandbox/i)
    // The blob URL created before the failed construction must not leak.
    expect(revoke).toHaveBeenCalledWith('blob:fake-harness')
  })

  it('surfaces a non-Error throw from Worker construction rather than a generic message', async () => {
    FakeWorker.throwOnConstruct = 'string failure' as unknown as Error
    const result = await runPlugin('x', snapshot)
    expect((result as { error: string }).error).toContain('string failure')
  })

  it('does not hang when postMessage throws (e.g. uncloneable snapshot), and cleans up', async () => {
    FakeWorker.postMessageError = new Error('DataCloneError')
    const result = await runPlugin('x', snapshot)
    expect(result).toEqual({ error: expect.stringContaining('DataCloneError') })
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalledTimes(1)
    expect(revoke).toHaveBeenCalledWith('blob:fake-harness')
  })
})
