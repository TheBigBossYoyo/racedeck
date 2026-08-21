/**
 * F1 TV subscription token — extraction and validation.
 *
 * THE ONE TOKEN THAT WORKS. F1's live timing feed gates `CarData.z` (telemetry)
 * and `Position.z` (car positions) behind an F1 TV subscription. It accepts
 * exactly one credential: the `subscriptionToken` that F1 nests inside the
 * URL-encoded `login-session` cookie on `.formula1.com`:
 *
 *     login-session = %7B%22data%22%3A%7B%22subscriptionToken%22%3A%22eyJ...%22%7D%7D
 *                   → {"data":{"subscriptionToken":"<JWT>"}}
 *
 * Verified against a live session: an anonymous connection and one bearing this
 * token differ by exactly the two gated topics, which start flowing immediately
 * (~1 Hz each) once it is presented.
 *
 * TWO DECOYS to avoid — both look like credentials and neither works:
 *
 *  1. The `ascendontoken` / `entitlementtoken` header that f1tv.formula1.com
 *     sends on its own API calls. Same subscriber, same entitlements, similar
 *     payload — but live timing ignores it and silently serves the anonymous
 *     topic set. Sniffing this was why signed-in users saw no telemetry.
 *  2. The RAW `login-session` cookie value. It is a JSON *wrapper*, not a token,
 *     yet a naive three-segment JWT check passes it: the wrapper's only dots are
 *     the two inside the JWT it contains. Sending it as a bearer authenticates
 *     nothing. Always unwrap to `data.subscriptionToken`.
 */

/** Decoded claims we care about from the subscription token. */
export interface F1TokenPayload {
  /** "active" when the subscription is live. Anything else cannot unlock feeds. */
  subscriptionStatus: string | null
  /** Entitlement codes, e.g. ["REG", "ACCESS"]. F1 TV Access is enough. */
  entitlements: string[]
  /** Token expiry. F1 issues these for roughly a week. */
  expiresAt: Date | null
}

export type F1TokenState =
  | 'valid'
  | 'missing'
  | 'malformed'
  | 'expired'
  | 'inactive-subscription'

export interface F1TokenStatus {
  state: F1TokenState
  payload: F1TokenPayload | null
}

/** Looks like a three-segment JWT (header.payload.signature). */
export function looksLikeJwt(value: string | null | undefined): boolean {
  if (!value) return false
  const parts = value.split('.')
  return parts.length === 3 && parts[0].length > 10 && parts[1].length > 10
}

/**
 * Unwrap the `login-session` cookie value to the subscription token it carries.
 * Handles both the URL-encoded form the browser stores and an already-decoded
 * value. Returns null when the cookie is absent or not the expected wrapper.
 */
export function subscriptionTokenFromLoginSession(
  cookieValue: string | null | undefined
): string | null {
  if (!cookieValue) return null
  const candidates = [cookieValue]
  try {
    candidates.push(decodeURIComponent(cookieValue))
  } catch {
    /* value wasn't percent-encoded — the raw form is still worth trying */
  }
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as { data?: { subscriptionToken?: unknown } }
      const token = parsed?.data?.subscriptionToken
      if (typeof token === 'string' && looksLikeJwt(token)) return token
    } catch {
      /* not JSON in this form — try the next */
    }
  }
  return null
}

/** Base64url-decode one JWT segment, tolerating F1's missing padding. */
function decodeSegment(segment: string): string | null {
  let s = segment.replace(/-/g, '+').replace(/_/g, '/')
  s += '='.repeat((4 - (s.length % 4)) % 4)
  try {
    // Buffer in the main process; atob in a renderer/test environment.
    if (typeof Buffer !== 'undefined') return Buffer.from(s, 'base64').toString('utf8')
    return atob(s)
  } catch {
    return null
  }
}

/** Decode the token's claims. Returns null when it isn't a readable JWT. */
export function decodeF1Token(token: string | null | undefined): F1TokenPayload | null {
  if (!looksLikeJwt(token)) return null
  const json = decodeSegment(token!.split('.')[1])
  if (!json) return null
  try {
    const raw = JSON.parse(json) as {
      SubscriptionStatus?: unknown
      ents?: unknown
      exp?: unknown
    }
    const entitlements = Array.isArray(raw.ents)
      ? raw.ents
          .map((e) => (e && typeof e === 'object' ? (e as { ent?: unknown }).ent : e))
          .filter((e): e is string => typeof e === 'string')
      : []
    return {
      subscriptionStatus:
        typeof raw.SubscriptionStatus === 'string' ? raw.SubscriptionStatus : null,
      entitlements,
      expiresAt: typeof raw.exp === 'number' ? new Date(raw.exp * 1000) : null
    }
  } catch {
    return null
  }
}

/**
 * Classify a token so the UI can say something TRUE and actionable: an expired
 * token means "sign in again" (and that IS the fix), while a valid one means any
 * missing telemetry is not the user's login.
 */
export function inspectF1Token(
  token: string | null | undefined,
  nowMs: number = Date.now()
): F1TokenStatus {
  if (!token) return { state: 'missing', payload: null }
  const payload = decodeF1Token(token)
  if (!payload) return { state: 'malformed', payload: null }
  if (payload.expiresAt && payload.expiresAt.getTime() <= nowMs) {
    return { state: 'expired', payload }
  }
  if (payload.subscriptionStatus && payload.subscriptionStatus.toLowerCase() !== 'active') {
    return { state: 'inactive-subscription', payload }
  }
  return { state: 'valid', payload }
}
