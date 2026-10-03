import { describe, expect, it } from 'vitest'
import { isAppNavigation, isTrustedSender } from '../../src/main/ipc/trusted-sender'

const DEV = 'http://localhost:5173'

describe('isTrustedSender', () => {
  it('trusts the packaged app served from a local file', () => {
    expect(isTrustedSender('file:///C:/Program%20Files/RaceDeck/resources/app.asar/out/renderer/index.html', null)).toBe(true)
    expect(isTrustedSender('file:///C:/app/out/renderer/index.html#/dashboard', null)).toBe(true)
    expect(isTrustedSender('file:///opt/racedeck/out/renderer/index.html', undefined)).toBe(true)
  })

  it('refuses a file URL that points at a remote (UNC) host', () => {
    expect(isTrustedSender('file://evil-host/share/index.html', null)).toBe(false)
  })

  it('trusts the dev-server origin only while a dev server URL is configured', () => {
    expect(isTrustedSender('http://localhost:5173/', DEV)).toBe(true)
    expect(isTrustedSender('http://localhost:5173/src/main.tsx?t=1', DEV)).toBe(true)
    expect(isTrustedSender('http://localhost:5173/', null)).toBe(false)
    expect(isTrustedSender('http://localhost:5173/', undefined)).toBe(false)
  })

  it('refuses another origin, port or scheme even in dev', () => {
    expect(isTrustedSender('http://localhost:5174/', DEV)).toBe(false)
    expect(isTrustedSender('https://localhost:5173/', DEV)).toBe(false)
    expect(isTrustedSender('http://localhost.evil.example:5173/', DEV)).toBe(false)
    expect(isTrustedSender('http://localhost@evil.example:5173/', DEV)).toBe(false)
  })

  it.each([
    ['a remote https page', 'https://www.formula1.com/'],
    ['the TOD host', 'https://tod.example/watch'],
    ['about:blank', 'about:blank'],
    ['a data URL', 'data:text/html,<script>1</script>'],
    ['a javascript URL', 'javascript:alert(1)'],
    ['a devtools URL', 'devtools://devtools/bundled/inspector.html'],
    ['an empty string', ''],
    ['a non-URL', 'not a url'],
    ['null', null],
    ['undefined', undefined]
  ])('refuses %s', (_label, url) => {
    expect(isTrustedSender(url, DEV)).toBe(false)
  })

  it('ignores an unparseable dev server URL rather than trusting everything', () => {
    expect(isTrustedSender('http://localhost:5173/', 'not a url')).toBe(false)
  })
})

describe('isAppNavigation', () => {
  const APP_FILE = 'file:///C:/Program%20Files/RaceDeck/resources/app.asar/out/renderer/index.html'

  it('allows the app document itself, with or without a hash or query', () => {
    expect(isAppNavigation(APP_FILE, null, APP_FILE)).toBe(true)
    expect(isAppNavigation(`${APP_FILE}#/settings`, null, APP_FILE)).toBe(true)
    expect(isAppNavigation(`${APP_FILE}?x=1`, null, APP_FILE)).toBe(true)
  })

  it('compares the file path case-insensitively (Windows drive letters)', () => {
    expect(isAppNavigation(APP_FILE.replace('C:', 'c:'), null, APP_FILE)).toBe(true)
  })

  it('refuses any other local file, remote page or scheme', () => {
    expect(isAppNavigation('file:///C:/Windows/win.ini', null, APP_FILE)).toBe(false)
    expect(isAppNavigation('https://evil.example/', null, APP_FILE)).toBe(false)
    expect(isAppNavigation('javascript:alert(1)', null, APP_FILE)).toBe(false)
    expect(isAppNavigation('not a url', null, APP_FILE)).toBe(false)
  })

  it('allows the dev origin when running against the dev server', () => {
    expect(isAppNavigation('http://localhost:5173/anything', DEV, APP_FILE)).toBe(true)
    expect(isAppNavigation('http://localhost:9999/', DEV, APP_FILE)).toBe(false)
  })
})
