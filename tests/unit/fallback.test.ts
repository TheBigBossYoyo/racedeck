import { describe, it, expect } from 'vitest'
import {
  isHardFailure,
  shouldFallback,
  nextFallbackMode,
  decideInitialMode,
  describeMode,
  fallbackReasonText,
  isTrustedTodUrl,
  isSafeExternalUrl,
  HARD_FAILURE_CODES,
  BENIGN_ABORT_CODE
} from '@shared/video-fallback'

describe('video fallback — failure classification', () => {
  it('recognises hard failure codes', () => {
    expect(isHardFailure(-30)).toBe(true) // ERR_BLOCKED_BY_RESPONSE
    expect(isHardFailure(-105)).toBe(true) // ERR_NAME_NOT_RESOLVED
    expect(isHardFailure(-3)).toBe(false) // ERR_ABORTED (benign)
    expect(isHardFailure(200)).toBe(false) // not a network failure
    expect(HARD_FAILURE_CODES).toContain(-30)
  })

  it('only falls back on main-frame, non-benign, hard failures with auto-fallback on', () => {
    expect(shouldFallback(-30, true, true)).toBe(true)
    expect(shouldFallback(BENIGN_ABORT_CODE, true, true)).toBe(false) // benign abort
    expect(shouldFallback(-30, false, true)).toBe(false) // subframe
    expect(shouldFallback(-30, true, false)).toBe(false) // auto-fallback disabled
    expect(shouldFallback(999, true, true)).toBe(false) // unknown/soft code
  })
})

describe('video fallback — the ladder', () => {
  it('descends embedded → companion → external (terminal)', () => {
    expect(nextFallbackMode('embedded')).toBe('companion')
    expect(nextFallbackMode('companion')).toBe('external')
    expect(nextFallbackMode('external')).toBe('external')
    expect(nextFallbackMode('none')).toBe('external')
  })

  it('uses the external browser when Widevine is unavailable', () => {
    expect(decideInitialMode(false)).toBe('external')
    expect(decideInitialMode(true)).toBe('embedded')
  })
})

describe('video fallback — trusted provider URLs', () => {
  it('accepts exact HTTPS provider hosts and their subdomains', () => {
    expect(isTrustedTodUrl('https://www.tod.tv/')).toBe(true)
    expect(isTrustedTodUrl('https://auth.tod.tv/login')).toBe(true)
    expect(isTrustedTodUrl('https://connect.bein.com/')).toBe(true)
  })

  it('rejects insecure, malformed, and lookalike hosts', () => {
    expect(isTrustedTodUrl('http://tod.tv/')).toBe(false)
    expect(isTrustedTodUrl('https://tod.tv.example.com/')).toBe(false)
    expect(isTrustedTodUrl('https://evilbein.com/')).toBe(false)
    expect(isTrustedTodUrl('not a url')).toBe(false)
  })

  it('allows only HTTPS URLs to leave through the system browser', () => {
    expect(isSafeExternalUrl('https://support.tod.tv/help')).toBe(true)
    expect(isSafeExternalUrl('http://tod.tv/')).toBe(false)
    expect(isSafeExternalUrl('file:///C:/Windows/System32/calc.exe')).toBe(false)
    expect(isSafeExternalUrl('custom-protocol:payload')).toBe(false)
  })
})

describe('video fallback — user-facing copy', () => {
  it('describes each mode', () => {
    expect(describeMode('embedded').short).toBe('Embedded')
    expect(describeMode('embedded').label).toMatch(/embedded mode active/i)
    expect(describeMode('companion').short).toBe('Companion')
    expect(describeMode('external').short).toBe('External')
    expect(describeMode('none').short).toBe('Off')
  })

  it('produces the polished fallback message with the switch reason', () => {
    const embeddedMsg = fallbackReasonText('embedded', -30)
    expect(embeddedMsg).toMatch(/Companion Window mode/i)
    expect(embeddedMsg).toContain('-30')

    const companionMsg = fallbackReasonText('companion', -105)
    expect(companionMsg).toMatch(/default browser/i)
  })
})
