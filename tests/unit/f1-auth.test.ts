import { beforeEach, describe, expect, it, vi } from 'vitest'

type Handler = (...args: unknown[]) => unknown

interface FakeCookie {
  name: string
  value: string
  domain: string
}

const electron = vi.hoisted(() => ({
  cookies: [] as { name: string; value: string; domain: string }[],
  windows: [] as unknown[],
  session: {
    permissionRequestHandler: null as ((...args: unknown[]) => void) | null,
    permissionCheckHandler: null as ((...args: unknown[]) => boolean) | null
  }
}))

vi.mock('electron', () => {
  class FakeContents {
    handlers = new Map<string, Handler>()
    openHandler: ((details: { url: string }) => { action: string }) | null = null
    on(event: string, fn: Handler): void {
      this.handlers.set(event, fn)
    }
    setUserAgent = vi.fn()
    setWindowOpenHandler(fn: (details: { url: string }) => { action: string }): void {
      this.openHandler = fn
    }
  }
  class FakeWindow {
    webContents = new FakeContents()
    on = vi.fn()
    loadURL = vi.fn(async () => undefined)
    isDestroyed = () => false
    focus = vi.fn()
    close = vi.fn()
    constructor() {
      electron.windows.push(this)
    }
  }
  const ses = {
    cookies: {
      get: async (filter: { name?: string }) =>
        electron.cookies.filter((c) => !filter.name || c.name === filter.name),
      on: vi.fn()
    },
    setUserAgent: vi.fn(),
    setPermissionRequestHandler: (fn: (...args: unknown[]) => void) => {
      electron.session.permissionRequestHandler = fn
    },
    setPermissionCheckHandler: (fn: (...args: unknown[]) => boolean) => {
      electron.session.permissionCheckHandler = fn
    }
  }
  return { BrowserWindow: FakeWindow, session: { fromPartition: () => ses } }
})

import { F1AuthManager } from '../../src/main/f1-auth'

function makeToken(claims: Record<string, unknown>): string {
  const seg = (o: unknown): string =>
    Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '')
  return `${seg({ alg: 'HS256', typ: 'JWT' })}.${seg(claims)}.${'s'.repeat(43)}`
}

const TOKEN = makeToken({
  SubscriptionStatus: 'active',
  SubscriberId: '1',
  ents: [{ country: 'GBR', ent: 'ACCESS' }],
  exp: Math.floor(Date.now() / 1000) + 3600
})
const LOGIN_SESSION = encodeURIComponent(JSON.stringify({ data: { subscriptionToken: TOKEN } }))

function cookie(name: string, value: string, domain: string): FakeCookie {
  return { name, value, domain }
}

interface FakeWindowShape {
  webContents: {
    handlers: Map<string, Handler>
    openHandler: ((details: { url: string }) => { action: string }) | null
  }
}

function openLoginWindow(): FakeWindowShape {
  new F1AuthManager().openLogin(null)
  return electron.windows[electron.windows.length - 1] as FakeWindowShape
}

function navigate(win: FakeWindowShape, event: string, url: string): boolean {
  const e = { preventDefault: vi.fn() }
  const handler = win.webContents.handlers.get(event)
  if (!handler) throw new Error(`no ${event} handler`)
  handler(e, url)
  return e.preventDefault.mock.calls.length > 0
}

beforeEach(() => {
  electron.cookies.length = 0
  electron.windows.length = 0
  electron.session.permissionRequestHandler = null
  electron.session.permissionCheckHandler = null
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

describe('F1AuthManager cookie domain matching', () => {
  it('collects cookies for formula1.com and its subdomains only', async () => {
    electron.cookies.push(
      cookie('a', '1', '.formula1.com'),
      cookie('b', '2', 'account.formula1.com'),
      cookie('c', '3', 'formula1.com'),
      cookie('evil1', 'x', 'evilformula1.com'),
      cookie('evil2', 'x', '.evilformula1.com'),
      cookie('evil3', 'x', 'formula1.com.attacker.example')
    )

    const ctx = await new F1AuthManager().getAuthContext()

    expect(ctx.cookieHeader).toBe('a=1; b=2; c=3')
    expect(ctx.cookieHeader).not.toContain('x')
  })

  it('takes the subscription token from a formula1.com cookie', async () => {
    electron.cookies.push(cookie('login-session', LOGIN_SESSION, '.formula1.com'))

    const ctx = await new F1AuthManager().getAuthContext()

    expect(ctx.bearer).toBe(TOKEN)
    expect(ctx.hasSubscription).toBe(true)
  })

  it('never trusts a login-session cookie planted on a look-alike domain', async () => {
    electron.cookies.push(cookie('login-session', LOGIN_SESSION, 'evilformula1.com'))

    const ctx = await new F1AuthManager().getAuthContext()

    expect(ctx.bearer).toBeNull()
    expect(ctx.hasSubscription).toBe(false)
    expect(ctx.hasAuth).toBe(false)
  })
})

describe('F1 login window hardening', () => {
  it('denies every permission request in the login session', () => {
    openLoginWindow()

    const callback = vi.fn()
    electron.session.permissionRequestHandler?.({}, 'geolocation', callback, {})
    electron.session.permissionRequestHandler?.({}, 'media', callback, {})

    expect(callback).toHaveBeenCalledTimes(2)
    expect(callback.mock.calls.every(([granted]) => granted === false)).toBe(true)
    expect(electron.session.permissionCheckHandler?.({}, 'notifications', 'https://x', {})).toBe(
      false
    )
  })

  it('blocks navigation and redirects to anything that is not https', () => {
    const win = openLoginWindow()

    for (const event of ['will-navigate', 'will-redirect']) {
      expect(navigate(win, event, 'file:///C:/Windows/win.ini')).toBe(true)
      expect(navigate(win, event, 'http://account.formula1.com/')).toBe(true)
      expect(navigate(win, event, 'javascript:alert(1)')).toBe(true)
      expect(navigate(win, event, 'ms-msdt:/id x')).toBe(true)
    }
  })

  it('still lets the sign-in flow move between https pages (F1, identity providers)', () => {
    const win = openLoginWindow()

    for (const event of ['will-navigate', 'will-redirect']) {
      expect(navigate(win, event, 'https://account.formula1.com/#/en/login')).toBe(false)
      expect(navigate(win, event, 'https://accounts.google.com/o/oauth2/v2/auth')).toBe(false)
    }
  })

  it('opens https popups (social sign-in) but denies any other scheme', () => {
    const win = openLoginWindow()

    expect(win.webContents.openHandler?.({ url: 'https://accounts.google.com/x' })).toEqual({
      action: 'allow'
    })
    for (const url of ['http://x.example/', 'file:///C:/x', 'javascript:alert(1)']) {
      expect(win.webContents.openHandler?.({ url })).toEqual({ action: 'deny' })
    }
  })

  it('opens an about:blank popup (window.open("") navigated afterwards), consistent with the navigation guard', () => {
    const win = openLoginWindow()

    expect(win.webContents.openHandler?.({ url: 'about:blank' })).toEqual({ action: 'allow' })
    // ...and the follow-up navigation of that popup is judged by the same rule.
    expect(navigate(win, 'will-navigate', 'about:blank')).toBe(false)
    // Other about: pages and empty strings remain denied.
    for (const url of ['about:srcdoc', 'about:blank#x', '']) {
      expect(win.webContents.openHandler?.({ url })).toEqual({ action: 'deny' })
    }
  })

  it('applies the same navigation lock to popups it allowed', () => {
    const win = openLoginWindow()
    const child = { webContents: { handlers: new Map<string, Handler>(), on: vi.fn(), setWindowOpenHandler: vi.fn() } }
    child.webContents.on.mockImplementation((event: string, fn: Handler) => {
      child.webContents.handlers.set(event, fn)
    })

    win.webContents.handlers.get('did-create-window')?.(child)

    expect(navigate(child as unknown as FakeWindowShape, 'will-navigate', 'file:///C:/x')).toBe(true)
    expect(navigate(child as unknown as FakeWindowShape, 'will-navigate', 'https://x.example/')).toBe(false)
    expect(child.webContents.setWindowOpenHandler).toHaveBeenCalled()
  })
})
