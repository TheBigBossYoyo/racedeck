/**
 * Best-effort human message from a caught value. `catch (e)` is `unknown`, and
 * anything can be thrown (strings, IPC-serialised plain objects), so
 * `(e as Error).message` can silently yield `undefined`. This never does.
 */
export function errorMessage(e: unknown, fallback = 'Unknown error'): string {
  if (typeof e === 'string') return e || fallback
  if (e != null && typeof e === 'object') {
    const message = (e as { message?: unknown }).message
    if (typeof message === 'string' && message) return message
  }
  return fallback
}
