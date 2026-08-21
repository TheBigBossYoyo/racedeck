import { BrowserWindow, session, type Session } from 'electron'
import {
  inspectF1Token,
  subscriptionTokenFromLoginSession,
  type F1TokenStatus
} from '@shared/f1-subscription-token'

/**
 * F1AuthManager — the in-app F1 TV sign-in for LIVE timing.
 *
 * WHY a real login window (not a password form): F1's account API sits behind bot
 * protection (a captcha "Pardon Our Interruption" page) that blocks raw
 * programmatic logins, and the richer live data (car positions / telemetry /
 * Driver Tracker) is now gated behind an active F1 TV subscription. So the user
 * signs in on F1's OWN page inside a RaceDeck window — Chromium (not RaceDeck)
 * holds the password — and we read the resulting F1 TV subscription token out of
 * the authenticated session's own cookie, plus the formula1.com cookies. That
 * token unlocks the live data the user's own subscription entitles them to. This
 * is a legitimate authenticated client, not DRM bypass, credential theft, or
 * piracy (RaceDeck never touches TOD's protected video/keys).
 *
 * THE TOKEN THAT MATTERS is the `subscriptionToken` nested inside the
 * `login-session` cookie — see `@shared/f1-subscription-token`, which documents
 * the two look-alike decoys that do NOT authenticate the live feed. Presenting
 * the right one is the difference between basic timing and live telemetry.
 */

export const F1_PARTITION = 'persist:f1account'
const LOGIN_URL = 'https://account.formula1.com/#/en/login'
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

export interface F1AuthContext {
  cookieHeader: string
  /** The F1 TV `subscriptionToken` — the ONLY credential the live feed accepts. */
  bearer: string | null
  /** True when we hold a valid, unexpired, active subscription token. */
  hasSubscription: boolean
  /** True when we found at least a session cookie or a token. */
  hasAuth: boolean
  /** Why the token is unusable, when it is — drives honest, actionable UI. */
  tokenState: F1TokenStatus['state']
  /** Token expiry (F1 issues these for about a week), when known. */
  tokenExpiresAt: string | null
}

export class F1AuthManager {
  private win: BrowserWindow | null = null
  private capturedToken: string | null = null
  private sniffing = false

  private ses(): Session {
    return session.fromPartition(F1_PARTITION)
  }

  /**
   * Watch the F1 partition's cookie jar for the `login-session` cookie and keep
   * the subscription token it wraps up to date.
   *
   * This replaced header-sniffing, which watched f1tv.formula1.com's API calls
   * for an `ascendontoken`/`entitlementtoken` bearer. That token belongs to the
   * same subscriber and looks right, but the live timing feed does not accept it
   * — presenting it got the anonymous topic set, so signed-in users never saw
   * telemetry. The cookie is also available the instant login completes, with no
   * hidden F1 TV window needed to provoke an API call.
   */
  private startSniffing(): void {
    if (this.sniffing) return
    this.sniffing = true
    try {
      this.ses().cookies.on('changed', (_e, cookie, _cause, removed) => {
        if (removed || cookie.name !== 'login-session') return
        const token = subscriptionTokenFromLoginSession(cookie.value)
        if (token) this.capturedToken = token
      })
    } catch {
      /* listener may already be bound; the cookie read below still works */
    }
  }

  /** Read the subscription token straight from the partition's cookie jar. */
  private async readSubscriptionTokenFromCookies(): Promise<string | null> {
    try {
      const cookies = await this.ses().cookies.get({ name: 'login-session' })
      for (const c of cookies) {
        if (!(c.domain ?? '').includes('formula1.com')) continue
        const token = subscriptionTokenFromLoginSession(c.value)
        if (token) return token
      }
    } catch {
      /* ignore */
    }
    return null
  }

  /** Open (or focus) the F1 login window and begin token capture. */
  openLogin(parent?: BrowserWindow | null): void {
    this.startSniffing()
    if (this.win && !this.win.isDestroyed()) {
      this.win.focus()
      return
    }
    const ses = this.ses()
    ses.setUserAgent(UA)
    this.win = new BrowserWindow({
      width: 520,
      height: 760,
      parent: parent ?? undefined,
      title: 'Sign in to F1 TV — RaceDeck Live Timing',
      autoHideMenuBar: true,
      backgroundColor: '#0a0b0f',
      webPreferences: {
        partition: F1_PARTITION,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true
      }
    })
    this.win.webContents.setUserAgent(UA)
    this.win.on('closed', () => (this.win = null))

    // Sign-in sets the `login-session` cookie directly, and the cookie listener
    // picks the token out of it — no need to bounce the user through f1tv.
    // (That detour existed only to provoke the API calls the old sniffer read.)
    this.win.webContents.on('did-navigate', () => {
      void this.ensureSubscriptionToken()
    })

    void this.win.loadURL(LOGIN_URL, { userAgent: UA })
  }

  closeLogin(): void {
    if (this.win && !this.win.isDestroyed()) this.win.close()
    this.win = null
  }

  /**
   * True once we hold a VALID subscription token — i.e. signing in actually
   * achieved something. Reporting "signed in" off any formula1.com cookie (as
   * this used to) marked users logged in when the token was expired or absent,
   * so the UI showed a green tick while telemetry stayed dark.
   */
  async isLoggedIn(): Promise<boolean> {
    const ctx = await this.getAuthContext()
    return ctx.hasSubscription
  }

  /**
   * Read the auth context from the F1 partition: the F1 TV subscription token
   * (unwrapped from the `login-session` cookie) plus all formula1.com cookies.
   *
   * The token is validated here rather than trusted blindly, so `hasSubscription`
   * means "this will actually unlock the gated feeds" and never merely "a string
   * was found". `tokenState` carries the reason when it won't.
   */
  async getAuthContext(): Promise<F1AuthContext> {
    const ses = this.ses()
    let cookieHeader = ''
    try {
      const cookies = await ses.cookies.get({})
      const relevant = cookies.filter((c) => (c.domain ?? '').includes('formula1.com'))
      cookieHeader = relevant.map((c) => `${c.name}=${c.value}`).join('; ')
    } catch {
      /* ignore */
    }

    // Prefer the live cookie jar over anything cached: it reflects a re-login
    // immediately, and F1 rotates this token roughly weekly.
    const bearer = (await this.readSubscriptionTokenFromCookies()) ?? this.capturedToken
    if (bearer) this.capturedToken = bearer
    const status = inspectF1Token(bearer)

    return {
      cookieHeader,
      bearer,
      hasSubscription: status.state === 'valid',
      hasAuth: Boolean(cookieHeader) || Boolean(bearer),
      tokenState: status.state,
      tokenExpiresAt: status.payload?.expiresAt?.toISOString() ?? null
    }
  }

  /**
   * Best-effort: pick up the subscription token without an interactive re-login.
   *
   * This used to open a hidden f1tv.formula1.com window and poll for up to 9s,
   * because the token was sniffed from that site's API calls. The token lives in
   * a cookie, so a jar read is all it takes — no window, no wait, no failure mode.
   */
  async ensureSubscriptionToken(): Promise<string | null> {
    const token = await this.readSubscriptionTokenFromCookies()
    if (token) this.capturedToken = token
    return this.capturedToken
  }

  destroy(): void {
    this.closeLogin()
  }
}
