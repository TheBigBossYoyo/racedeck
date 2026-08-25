import { nanoid } from 'nanoid'

/**
 * User-authored, timestamped notes tied to a driver/lap/event
 * (APP_IMPROVEMENT_ROADMAP.md P3 item 34). Unlike `RaceBookmark` (pure,
 * derived from the snapshot on every session load), these are user-created
 * and must persist across restarts — see `annotationsStore.ts`.
 */
export interface UserAnnotation {
  readonly id: string
  readonly sessionId: string
  /** Data-clock seconds since session start. */
  readonly t: number
  readonly driverNumber: number | null
  readonly lapNumber: number | null
  /** Short freeform tag, e.g. "strategy", "incident". */
  readonly tag: string | null
  readonly text: string
  /** Wall-clock ISO timestamp of when the note was written. */
  readonly createdAt: string
}

export interface CreateAnnotationInput {
  sessionId: string
  t: number
  driverNumber: number | null
  lapNumber: number | null
  tag: string | null
  text: string
}

export function createAnnotation(input: CreateAnnotationInput): UserAnnotation {
  return {
    id: nanoid(8),
    sessionId: input.sessionId,
    t: Math.max(0, input.t),
    driverNumber: input.driverNumber,
    lapNumber: input.lapNumber,
    tag: input.tag?.trim() || null,
    text: input.text.trim(),
    createdAt: new Date().toISOString()
  }
}

/** Parse a persisted value back into a UserAnnotation[], dropping anything malformed. */
export function sanitizeAnnotations(input: unknown): UserAnnotation[] {
  if (!Array.isArray(input)) return []
  const out: UserAnnotation[] = []
  for (const item of input) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    if (typeof o.id !== 'string' || typeof o.sessionId !== 'string') continue
    if (typeof o.t !== 'number' || !isFinite(o.t)) continue
    if (typeof o.text !== 'string' || typeof o.createdAt !== 'string') continue
    out.push({
      id: o.id,
      sessionId: o.sessionId,
      t: Math.max(0, o.t),
      driverNumber: typeof o.driverNumber === 'number' ? o.driverNumber : null,
      lapNumber: typeof o.lapNumber === 'number' ? o.lapNumber : null,
      tag: typeof o.tag === 'string' ? o.tag : null,
      text: o.text,
      createdAt: o.createdAt
    })
  }
  return out.sort((a, b) => a.t - b.t)
}
