import { describe, expect, it } from 'vitest'
import { isSafeExternalUrl, isTrustedTodUrl } from '@shared/video-fallback'

/**
 * isTrustedTodUrl gates which pages may open provider browser surfaces and be
 * granted permissions. These are the look-alike / parser-confusion cases a
 * naive `includes()` or `endsWith()` check gets wrong.
 */
describe('isTrustedTodUrl - accepted', () => {
  it.each([
    'https://tod.tv/',
    'https://www.tod.tv/watch',
    'https://auth.tod.tv/login?next=/x',
    'https://bein.com',
    'https://connect.bein.com/',
    'https://beinsports.com/',
    'https://a.b.c.beinsports.com/deep/path#frag',
    'HTTPS://WWW.TOD.TV/',
    'https://tod.tv:443/',
    'https://tod.tv:8443/'
  ])('trusts %s', (url) => {
    expect(isTrustedTodUrl(url)).toBe(true)
  })
})

describe('isTrustedTodUrl - rejected', () => {
  it.each([
    ['plain http', 'http://tod.tv/'],
    ['ws scheme', 'wss://tod.tv/'],
    ['javascript scheme', 'javascript:alert(1)//tod.tv'],
    ['data scheme', 'data:text/html,tod.tv'],
    ['file scheme', 'file:///tod.tv'],
    ['blob scheme', 'blob:https://tod.tv/uuid'],
    ['suffix look-alike (evilbein.com)', 'https://evilbein.com/'],
    ['suffix look-alike (notod.tv)', 'https://notod.tv/'],
    ['trusted as a subdomain of attacker', 'https://tod.tv.example.com/'],
    ['trusted as a path segment', 'https://evil.example/tod.tv'],
    ['trusted as a query value', 'https://evil.example/?u=https://tod.tv/'],
    ['trusted as a fragment', 'https://evil.example/#tod.tv'],
    ['userinfo trick (trusted host is the username)', 'https://tod.tv@evil.example/'],
    ['userinfo trick with password', 'https://tod.tv:pw@evil.example/'],
    ['hyphen prefix', 'https://-tod.tv/'],
    ['hyphenated look-alike', 'https://tod-tv.com/'],
    ['different TLD', 'https://tod.tv.evil/'],
    ['backslash host confusion', 'https://evil.example\\@tod.tv/'],
    ['IP address', 'https://127.0.0.1/'],
    ['bare suffix without a dot boundary', 'https://xbeinsports.com/'],
    ['punycode homograph', 'https://xn--tod-6ma.tv/'],
    ['unicode homograph (cyrillic o)', 'https://t\u043Ed.tv/'],
    ['empty string', ''],
    ['no scheme', 'tod.tv'],
    ['relative path', '/tod.tv'],
    ['garbage', 'not a url']
  ])('rejects %s', (_label, url) => {
    expect(isTrustedTodUrl(url)).toBe(false)
  })

  it('rejects undefined', () => {
    expect(isTrustedTodUrl(undefined)).toBe(false)
  })
})

describe('isSafeExternalUrl', () => {
  it('allows only https URLs to be handed to the OS', () => {
    expect(isSafeExternalUrl('https://example.com/a')).toBe(true)
    for (const bad of ['http://example.com', 'file:///C:/Windows/System32/calc.exe', 'javascript:alert(1)', 'ms-msdt:/id', 'vscode://x', '', 'nope']) {
      expect(isSafeExternalUrl(bad)).toBe(false)
    }
    expect(isSafeExternalUrl(undefined)).toBe(false)
  })
})
