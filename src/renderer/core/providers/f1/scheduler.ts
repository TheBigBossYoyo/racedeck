/** Points preprocessed between cooperative yields (lap history, ERS integration). */
export const PRECOMPUTE_YIELD_EVERY = 400

/**
 * Cooperative yield between preprocessing chunks. `scheduler.yield()` (or a
 * MessageChannel hop) resumes in ~0.1 ms; `setTimeout(0)` is clamped to ~4 ms
 * once nested, which adds up over the dozens of yields a session load takes.
 * Exported as an object so tests can observe/replace the yield.
 * Moved verbatim from F1LiveProvider.ts.
 */
export const renderScheduler = {
  yieldToRenderer: (): Promise<void> => {
    const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler
    if (scheduler?.yield) return scheduler.yield.call(scheduler)
    return new Promise<void>((resolve) => {
      const channel = new MessageChannel()
      channel.port1.onmessage = () => {
        channel.port1.close()
        resolve()
      }
      channel.port2.postMessage(null)
    })
  }
}

/** Resolved through the object on every call, so a test's replacement takes effect. */
export const yieldToRenderer = (): Promise<void> => renderScheduler.yieldToRenderer()
