import { persist } from './persist'

/**
 * Write helpers shared by the stores that persist user state.
 *
 * `writeLogged` is the fire-and-forget write: the UI never waits on a disk write,
 * but a failed one must not vanish either, so it is logged with the key it was
 * for. `createCoalescedWriter` collapses a burst of writes to one key (a drag, a
 * slider) into a single trailing write.
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Fire-and-forget persist that logs (never throws) when the write fails. */
export function writeLogged(namespace: string, key: string, value: unknown): void {
  persist.set(namespace, key, value).catch((error: unknown) => {
    console.error(`[persist] Could not save ${namespace}:${key} — ${describeError(error)}`)
  })
}

export interface CoalescedWriter {
  /** Queue a write; replaces any queued write to the same key and restarts the timer. */
  schedule: (namespace: string, key: string, value: unknown) => void
  /** Write the queued value now (no-op when nothing is queued). */
  flush: () => void
}

interface PendingWrite {
  namespace: string
  key: string
  value: unknown
}

const writers = new Set<CoalescedWriter>()
let unloadHooked = false

/** Best-effort: a queued write must survive the window closing inside the debounce delay. */
export function flushAllCoalescedWrites(): void {
  for (const writer of writers) writer.flush()
}

function hookUnloadOnce(): void {
  if (unloadHooked || typeof window === 'undefined') return
  unloadHooked = true
  window.addEventListener('pagehide', flushAllCoalescedWrites)
  window.addEventListener('beforeunload', flushAllCoalescedWrites)
}

/**
 * Trailing-edge debounced writer with a single slot. Scheduling a different key
 * while one is queued flushes the queued one first, so switching target never
 * drops the last value written to the old one.
 */
export function createCoalescedWriter(delayMs: number): CoalescedWriter {
  let pending: PendingWrite | null = null
  let timer: ReturnType<typeof setTimeout> | null = null

  const flush = (): void => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    if (!pending) return
    const write = pending
    pending = null
    writeLogged(write.namespace, write.key, write.value)
  }

  const schedule = (namespace: string, key: string, value: unknown): void => {
    if (pending && (pending.namespace !== namespace || pending.key !== key)) flush()
    pending = { namespace, key, value }
    if (timer) clearTimeout(timer)
    timer = setTimeout(flush, delayMs)
  }

  const writer: CoalescedWriter = { schedule, flush }
  writers.add(writer)
  hookUnloadOnce()
  return writer
}
