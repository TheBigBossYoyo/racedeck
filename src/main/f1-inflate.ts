import { inflateRawSync } from 'node:zlib'

/**
 * Decode one `.z` feed payload: base64 of raw-deflated JSON, as used by the
 * archive's `CarData.z` / `Position.z` lines and by the live socket's `.z`
 * topics. Returns null for anything that is not that (wrong type, empty, bad
 * base64, corrupt deflate, invalid JSON) — a bad frame must not take the feed down.
 *
 * Lives in the main process because it needs Node's zlib; `@shared/f1live` stays
 * dependency-free for the renderer.
 */
export function inflateZPayload(base64: unknown): unknown {
  if (typeof base64 !== 'string' || !base64) return null
  try {
    return JSON.parse(inflateRawSync(Buffer.from(base64, 'base64')).toString('utf8'))
  } catch {
    return null
  }
}
