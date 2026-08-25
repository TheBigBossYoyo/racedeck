import type { PluginSnapshot } from '@renderer/core/engines/PluginSnapshotApi'

/**
 * Runs a local plugin's `compute(snapshot)` inside a sandboxed Web Worker
 * (APP_IMPROVEMENT_ROADMAP.md P3 item 36). The harness is a fixed constant
 * string built into a Blob URL — never user input — so the only thing that
 * varies per run is the plugin `source` passed via `postMessage` (structured
 * clone: no live object/function references, no bridge/IPC access ever
 * reaches the worker). The renderer already runs with
 * `nodeIntegration: false`, so a Worker spawned from it has no Node access
 * either; Workers never have DOM access. Bounded to 1s so a hung or
 * malicious plugin can't block the UI.
 */

const HARNESS = `
self.onmessage = (e) => {
  const { source, snapshot } = e.data
  try {
    const fn = new Function('snapshot', source + '\\n;return compute(snapshot)')
    self.postMessage({ ok: true, result: fn(snapshot) })
  } catch (err) {
    self.postMessage({ ok: false, error: err && err.message ? err.message : String(err) })
  }
}
`

const TIMEOUT_MS = 1000

export type PluginRunResult = Record<string, number | string> | { error: string }

/** Sanitize an arbitrary plugin return value into a safe metrics record. */
export function sanitizePluginResult(result: unknown): PluginRunResult {
  if (!result || typeof result !== 'object') {
    return { error: 'Plugin must return an object of metrics (compute(snapshot) => {...}).' }
  }
  const out: Record<string, number | string> = {}
  for (const [key, value] of Object.entries(result as Record<string, unknown>)) {
    if (typeof value === 'number' || typeof value === 'string') out[key] = value
  }
  return out
}

/** Race `task` against a timeout, resolving to `onTimeout()` if it doesn't finish in time. */
export function withTimeout<T>(task: Promise<T>, ms: number, onTimeout: () => T): Promise<T> {
  return new Promise((resolve) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      resolve(onTimeout())
    }, ms)
    void task.then((value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    })
  })
}

function runInWorker(source: string, snapshot: PluginSnapshot): Promise<PluginRunResult> {
  return new Promise((resolve) => {
    if (typeof Worker === 'undefined') {
      resolve({ error: 'Plugins require a browser Worker, unavailable in this environment.' })
      return
    }
    let url: string | null = null
    let worker: Worker | null = null
    try {
      const blob = new Blob([HARNESS], { type: 'application/javascript' })
      url = URL.createObjectURL(blob)
      worker = new Worker(url)
    } catch (e) {
      resolve({ error: e instanceof Error ? e.message : 'Failed to start the plugin sandbox.' })
      return
    }
    const cleanup = () => {
      worker?.terminate()
      if (url) URL.revokeObjectURL(url)
    }
    worker.onmessage = (e) => {
      cleanup()
      const data = e.data as { ok: boolean; result?: unknown; error?: string }
      resolve(
        data.ok ? sanitizePluginResult(data.result) : { error: data.error ?? 'Plugin failed.' }
      )
    }
    worker.onerror = (e) => {
      cleanup()
      resolve({ error: e.message || 'Plugin crashed.' })
    }
    worker.postMessage({ source, snapshot })
  })
}

/** Run a plugin's `compute(snapshot)` in a sandboxed Worker, bounded to 1s. */
export function runPlugin(source: string, snapshot: PluginSnapshot): Promise<PluginRunResult> {
  return withTimeout(runInWorker(source, snapshot), TIMEOUT_MS, () => ({
    error: `Plugin timed out after ${TIMEOUT_MS}ms.`
  }))
}
