import type { PluginSnapshot } from '@renderer/core/engines/PluginSnapshotApi'
import { errorMessage } from '@renderer/lib/errorMessage'

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
 *
 * Caveat: the app shell CSP (index.html) has `script-src 'self'` with no `blob:` and no
 * `unsafe-eval`, so a Blob Worker and the harness's `new Function` are expected to be
 * blocked in the packaged app. Those failures are surfaced verbatim with an explanatory
 * hint instead of hanging; making plugins actually run needs a CSP decision (see report).
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

interface Sandbox {
  worker: Worker
  /** Terminate the worker and release its blob URL. Safe to call more than once. */
  dispose: () => void
}

interface PluginRun {
  result: Promise<PluginRunResult>
  /** Force-stop the run (used when the timeout wins so a spinning plugin cannot leak). */
  dispose: () => void
}

const CSP_HINT =
  "The app's Content Security Policy (script-src 'self', no blob: workers, no unsafe-eval) " +
  'may be blocking the plugin sandbox.'
const CSP_SIGNATURE = /content security policy|unsafe-eval|refused to (?:create|evaluate)/i

/** Append the CSP explanation when a failure message looks CSP-related. */
function withCspHint(message: string): string {
  return CSP_SIGNATURE.test(message) ? `${message} ${CSP_HINT}` : message
}

function failedRun(error: string): PluginRun {
  return { result: Promise.resolve({ error }), dispose: () => {} }
}

function startSandbox(): Sandbox {
  const blob = new Blob([HARNESS], { type: 'application/javascript' })
  const url = URL.createObjectURL(blob)
  let worker: Worker
  try {
    worker = new Worker(url)
  } catch (e) {
    URL.revokeObjectURL(url)
    throw e
  }
  let disposed = false
  const dispose = () => {
    if (disposed) return
    disposed = true
    worker.terminate()
    URL.revokeObjectURL(url)
  }
  return { worker, dispose }
}

function interpretReply(data: unknown): PluginRunResult {
  const reply = (data ?? {}) as { ok?: unknown; result?: unknown; error?: unknown }
  if (reply.ok === true) return sanitizePluginResult(reply.result)
  const error = typeof reply.error === 'string' && reply.error ? reply.error : 'Plugin failed.'
  return { error: withCspHint(error) }
}

// A harness-level worker error (as opposed to a plugin error, which the harness catches
// and reports itself) means the worker script never ran, typically a CSP block.
const SANDBOX_LOAD_FAILURE = `The plugin sandbox failed to start (its Worker script could not load). ${CSP_HINT}`

function startPluginRun(source: string, snapshot: PluginSnapshot): PluginRun {
  if (typeof Worker === 'undefined') {
    return failedRun('Plugins require a browser Worker, unavailable in this environment.')
  }
  let sandbox: Sandbox
  try {
    sandbox = startSandbox()
  } catch (e) {
    return failedRun(withCspHint(`Could not start the plugin sandbox: ${errorMessage(e)}`))
  }
  const { worker, dispose } = sandbox
  const result = new Promise<PluginRunResult>((resolve) => {
    worker.onmessage = (e) => {
      dispose()
      resolve(interpretReply(e.data))
    }
    worker.onerror = (e) => {
      dispose()
      resolve({ error: e.message ? withCspHint(e.message) : SANDBOX_LOAD_FAILURE })
    }
    try {
      worker.postMessage({ source, snapshot })
    } catch (e) {
      dispose()
      resolve({ error: `Could not send the snapshot to the plugin sandbox: ${errorMessage(e)}` })
    }
  })
  return { result, dispose }
}

/**
 * Run a plugin's `compute(snapshot)` in a sandboxed Worker, bounded to 1s. On timeout the
 * worker is terminated: a `while(true){}` plugin would otherwise spin forever and every
 * further run would add another worker.
 */
export function runPlugin(source: string, snapshot: PluginSnapshot): Promise<PluginRunResult> {
  const run = startPluginRun(source, snapshot)
  return withTimeout(run.result, TIMEOUT_MS, () => {
    run.dispose()
    return { error: `Plugin timed out after ${TIMEOUT_MS}ms and was stopped.` }
  })
}
