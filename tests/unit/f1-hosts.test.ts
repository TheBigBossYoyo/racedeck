import { describe, expect, it } from 'vitest'
import {
  isFormula1CookieDomain,
  isFormula1Host,
  isHttpsUrl,
  isLoginNavigationAllowed
} from '../../src/main/f1-hosts'

describe('isFormula1Host', () => {
  it.each(['formula1.com', 'account.formula1.com', 'f1tv.formula1.com', 'A.Formula1.COM'])(
    'accepts %s',
    (host) => {
      expect(isFormula1Host(host)).toBe(true)
    }
  )

  it.each([
    'evilformula1.com',
    'formula1.com.evil.example',
    'notformula1.com',
    'formula1.co',
    'formula1.com.',
    'evil.example',
    '',
    'xformula1.com'
  ])('rejects %s', (host) => {
    expect(isFormula1Host(host)).toBe(false)
  })
})

describe('isFormula1CookieDomain', () => {
  it('accepts host-only and leading-dot domain cookies', () => {
    expect(isFormula1CookieDomain('.formula1.com')).toBe(true)
    expect(isFormula1CookieDomain('formula1.com')).toBe(true)
    expect(isFormula1CookieDomain('account.formula1.com')).toBe(true)
    expect(isFormula1CookieDomain('.account.formula1.com')).toBe(true)
  })

  it('rejects look-alike domains that merely contain the string', () => {
    expect(isFormula1CookieDomain('evilformula1.com')).toBe(false)
    expect(isFormula1CookieDomain('.evilformula1.com')).toBe(false)
    expect(isFormula1CookieDomain('formula1.com.evil.example')).toBe(false)
    expect(isFormula1CookieDomain('www.formula1.com.attacker.net')).toBe(false)
  })

  it('rejects missing domains', () => {
    expect(isFormula1CookieDomain(undefined)).toBe(false)
    expect(isFormula1CookieDomain(null)).toBe(false)
    expect(isFormula1CookieDomain('')).toBe(false)
  })
})

describe('isHttpsUrl', () => {
  it('accepts https only', () => {
    expect(isHttpsUrl('https://account.formula1.com/#/en/login')).toBe(true)
    expect(isHttpsUrl('https://accounts.google.com/o/oauth2/auth')).toBe(true)
    expect(isHttpsUrl('http://account.formula1.com/')).toBe(false)
    expect(isHttpsUrl('file:///C:/x')).toBe(false)
    expect(isHttpsUrl('javascript:alert(1)')).toBe(false)
    expect(isHttpsUrl('data:text/html,hi')).toBe(false)
    expect(isHttpsUrl('nope')).toBe(false)
    expect(isHttpsUrl('')).toBe(false)
  })
})

describe('isLoginNavigationAllowed', () => {
  it('allows https pages, including third-party identity providers', () => {
    expect(isLoginNavigationAllowed('https://account.formula1.com/#/en/login')).toBe(true)
    expect(isLoginNavigationAllowed('https://accounts.google.com/o/oauth2/v2/auth')).toBe(true)
  })

  it('allows the inert blank page popups start on', () => {
    expect(isLoginNavigationAllowed('about:blank')).toBe(true)
  })

  it.each([
    'http://account.formula1.com/',
    'file:///C:/Windows/win.ini',
    'javascript:alert(1)',
    'data:text/html,<script>1</script>',
    'ms-msdt:/id x',
    'about:srcdoc',
    'not a url',
    ''
  ])('refuses %s', (url) => {
    expect(isLoginNavigationAllowed(url)).toBe(false)
  })
})
