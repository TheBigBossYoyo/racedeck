/**
 * Scalar parsers and the untyped-record accessor shared by every F1 feed
 * normalizer. Moved verbatim from f1normalize.ts.
 */

/** F1 lap-time string → seconds. "1:23.456"→83.456, "23.456"→23.456, ""→null. */
export function parseLapTime(v: unknown): number | null {
  if (typeof v === 'number') return v > 0 ? v : null
  if (typeof v !== 'string' || !v.trim()) return null
  const parts = v.split(':')
  let sec = 0
  for (const p of parts) sec = sec * 60 + parseFloat(p)
  return isFinite(sec) && sec > 0 ? sec : null
}

/** F1 gap/interval string → seconds | '+1 LAP' | null. */
export function parseGap(v: unknown): number | '+1 LAP' | null {
  if (v == null) return null
  if (typeof v === 'number') return isFinite(v) ? v : null
  const s = String(v).trim()
  if (!s) return null
  const up = s.toUpperCase()
  if (up.includes('LAP') || /^\d+L$/.test(up)) return '+1 LAP'
  const n = parseFloat(s.replace('+', ''))
  return isFinite(n) ? n : null
}

export function numOrNull(v: unknown): number | null {
  if (typeof v === 'number') return isFinite(v) ? v : null
  if (typeof v === 'string' && v.trim()) {
    const n = parseFloat(v)
    return isFinite(n) ? n : null
  }
  return null
}

export const rec = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
