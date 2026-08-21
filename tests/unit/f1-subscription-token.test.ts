import { describe, expect, it } from 'vitest'
import {
  decodeF1Token,
  inspectF1Token,
  looksLikeJwt,
  subscriptionTokenFromLoginSession
} from '@shared/f1-subscription-token'

/** Build a JWT-shaped string with the given claims (signature is irrelevant here). */
function makeToken(claims: Record<string, unknown>): string {
  const seg = (o: unknown): string =>
    Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '')
  return `${seg({ alg: 'HS256', typ: 'JWT' })}.${seg(claims)}.${'s'.repeat(43)}`
}

const ACTIVE = {
  SubscriptionStatus: 'active',
  SubscriberId: '220837358',
  ents: [
    { country: 'GBR', ent: 'REG' },
    { country: 'GBR', ent: 'ACCESS' }
  ],
  exp: Math.floor(Date.now() / 1000) + 7 * 24 * 3600
}

describe('subscriptionTokenFromLoginSession', () => {
  it('unwraps the token from the URL-encoded cookie F1 actually sets', () => {
    const token = makeToken(ACTIVE)
    const cookie = encodeURIComponent(JSON.stringify({ data: { subscriptionToken: token } }))
    expect(subscriptionTokenFromLoginSession(cookie)).toBe(token)
  })

  it('also accepts an already-decoded cookie value', () => {
    const token = makeToken(ACTIVE)
    expect(
      subscriptionTokenFromLoginSession(JSON.stringify({ data: { subscriptionToken: token } }))
    ).toBe(token)
  })

  it('never returns the raw wrapper, which naive JWT checks mistake for a token', () => {
    // THE ORIGINAL BUG: the wrapper's only dots are the two inside the JWT it
    // contains, so `value.split('.').length === 3` passes and the whole JSON blob
    // was sent as a bearer. F1 then served the anonymous topic set, and the app
    // blamed the user's subscription for the missing telemetry.
    const wrapper = JSON.stringify({ data: { subscriptionToken: makeToken(ACTIVE) } })
    expect(looksLikeJwt(wrapper)).toBe(true) // the trap
    expect(subscriptionTokenFromLoginSession(wrapper)).not.toBe(wrapper)
    expect(looksLikeJwt(subscriptionTokenFromLoginSession(wrapper))).toBe(true)
  })

  it('returns null for absent or non-wrapper values', () => {
    expect(subscriptionTokenFromLoginSession(null)).toBeNull()
    expect(subscriptionTokenFromLoginSession('')).toBeNull()
    expect(subscriptionTokenFromLoginSession('not-json')).toBeNull()
    expect(subscriptionTokenFromLoginSession(JSON.stringify({ data: {} }))).toBeNull()
  })
})

describe('decodeF1Token', () => {
  it('reads subscription status, entitlements and expiry', () => {
    const payload = decodeF1Token(makeToken(ACTIVE))
    expect(payload?.subscriptionStatus).toBe('active')
    expect(payload?.entitlements).toEqual(['REG', 'ACCESS'])
    expect(payload?.expiresAt).toBeInstanceOf(Date)
  })

  it('tolerates the missing base64 padding F1 emits', () => {
    // Claim sizes that leave the payload segment un-padded must still decode.
    for (const pad of ['a', 'ab', 'abc', 'abcd']) {
      const token = makeToken({ ...ACTIVE, SubscriberId: pad })
      expect(decodeF1Token(token)?.subscriptionStatus).toBe('active')
    }
  })

  it('returns null for non-JWT input', () => {
    expect(decodeF1Token(null)).toBeNull()
    expect(decodeF1Token('abc')).toBeNull()
  })
})

describe('inspectF1Token', () => {
  it('accepts an active, unexpired token', () => {
    expect(inspectF1Token(makeToken(ACTIVE)).state).toBe('valid')
  })

  it('flags an expired token — the case that needs a fresh sign-in', () => {
    const expired = makeToken({ ...ACTIVE, exp: Math.floor(Date.now() / 1000) - 60 })
    expect(inspectF1Token(expired).state).toBe('expired')
  })

  it('flags a lapsed subscription rather than claiming it will work', () => {
    const lapsed = makeToken({ ...ACTIVE, SubscriptionStatus: 'inactive' })
    expect(inspectF1Token(lapsed).state).toBe('inactive-subscription')
  })

  it('distinguishes no token from an unreadable one', () => {
    expect(inspectF1Token(null).state).toBe('missing')
    expect(inspectF1Token('nonsense').state).toBe('malformed')
  })
})
