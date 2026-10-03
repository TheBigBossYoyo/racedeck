import { describe, expect, it } from 'vitest'
import { AI_PROVIDERS } from '@shared/ai'
import { EXTERNAL_LINK_HOSTS, isAllowedExternalUrl } from '@shared/external-links'

describe('isAllowedExternalUrl', () => {
  it('allows every AI provider "get a key" link exactly as the Settings page uses it', () => {
    const links = Object.values(AI_PROVIDERS)
      .map((p) => p.keyUrl)
      .filter(Boolean)
    expect(links.length).toBeGreaterThan(0)
    for (const link of links) expect(isAllowedExternalUrl(link)).toBe(true)
  })

  it('allows the Polymarket event link the Settings page builds', () => {
    expect(isAllowedExternalUrl('https://polymarket.com/event/f1-race-winner')).toBe(true)
  })

  it('derives its host list from the providers, so a new provider is covered automatically', () => {
    for (const provider of Object.values(AI_PROVIDERS)) {
      if (!provider.keyUrl) continue
      expect(EXTERNAL_LINK_HOSTS.has(new URL(provider.keyUrl).hostname)).toBe(true)
    }
    expect(EXTERNAL_LINK_HOSTS.has('polymarket.com')).toBe(true)
  })

  it.each([
    ['plain http', 'http://polymarket.com/event/x'],
    ['a lookalike suffix host', 'https://polymarket.com.evil.example/event/x'],
    ['a lookalike prefix host', 'https://evilpolymarket.com/event/x'],
    ['a subdomain of an allowed host', 'https://evil.polymarket.com/'],
    ['credentials in the URL', 'https://polymarket.com@evil.example/'],
    ['embedded credentials on an allowed host', 'https://user:pw@polymarket.com/'],
    ['a custom port', 'https://polymarket.com:8443/'],
    ['a file URL', 'file:///C:/Windows/System32/calc.exe'],
    ['a javascript URL', 'javascript:alert(1)'],
    ['a custom protocol handler', 'ms-msdt:/id PCWDiagnostic'],
    ['the F1 TV login host', 'https://account.formula1.com/'],
    ['an empty string', ''],
    ['a non-URL', 'not a url'],
    ['an over-long URL', `https://polymarket.com/${'a'.repeat(3000)}`]
  ])('refuses %s', (_label, url) => {
    expect(isAllowedExternalUrl(url)).toBe(false)
  })

  it('refuses non-string input', () => {
    expect(isAllowedExternalUrl(undefined)).toBe(false)
    expect(isAllowedExternalUrl(null)).toBe(false)
    expect(isAllowedExternalUrl(5)).toBe(false)
  })
})
