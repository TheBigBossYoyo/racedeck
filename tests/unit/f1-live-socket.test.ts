import { describe, expect, it } from 'vitest'
import { SUBSCRIBE_TOPICS, hasUsableAuth } from '../../src/main/f1-live-socket'

describe('hasUsableAuth', () => {
  it('treats a subscription bearer as usable auth', () => {
    expect(hasUsableAuth({ bearer: 'jwt.token.here', cookieHeader: '' })).toBe(true)
  })

  it('treats cookies alone as usable auth (returning subscriber, token not re-sniffed)', () => {
    // This is the regression: cookies were captured (user shows "signed in") but
    // no bearer, so the socket must still authenticate rather than go anonymous.
    expect(hasUsableAuth({ bearer: null, cookieHeader: 'login=abc; entitlement=def' })).toBe(true)
  })

  it('is anonymous only when neither credential is present', () => {
    expect(hasUsableAuth({ bearer: null, cookieHeader: '' })).toBe(false)
    expect(hasUsableAuth(undefined)).toBe(false)
    expect(hasUsableAuth(null)).toBe(false)
  })
})

describe('SUBSCRIBE_TOPICS', () => {
  // Verified against a live session by subscribing to a candidate superset and
  // reading back which names F1's server accepted (it silently drops the rest).
  // These were all being missed before, so guard against the list shrinking.
  it('asks for every topic F1 actually serves live', () => {
    for (const topic of [
      'SessionStatus',
      'CurrentTyres',
      'TyreStintSeries',
      'TeamRadio',
      'PitLaneTimeCollection',
      'TopThree',
      'TimingStats'
    ]) {
      expect(SUBSCRIBE_TOPICS).toContain(topic)
    }
  })

  it('still asks for car telemetry/positions so a restored feed lights up', () => {
    // F1 does not serve these live today. Keeping them costs nothing (unknown
    // topics are dropped) and means no code change if they ever return.
    expect(SUBSCRIBE_TOPICS).toContain('CarData.z')
    expect(SUBSCRIBE_TOPICS).toContain('Position.z')
  })
})
