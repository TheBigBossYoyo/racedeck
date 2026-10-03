import { BrowserWindow, WebContentsView, shell, session, type Session } from 'electron'
import { is } from '@electron-toolkit/utils'
import type { SurfaceBounds, SetVideoModeRequest } from '@shared/ipc-contract'
import type { VideoMode, VideoModeState, Tristate, VideoPlaybackProbe } from '@shared/models'
import { DEFAULT_TOD_URL } from '@shared/constants'
import {
  isHardFailure,
  shouldFallback,
  fallbackReasonText,
  isTrustedTodUrl,
  isSafeExternalUrl
} from '@shared/video-fallback'

/**
 * VideoSurfaceManager — owns the TOD viewing surface and its fallback ladder.
 *
 *   Mode A  EMBEDDED  → a WebContentsView loaded as TOP-LEVEL navigation
 *                       (NOT an iframe, so X-Frame-Options / CSP frame-ancestors
 *                       do not block it) overlaid on the React video panel.
 *   Mode B  COMPANION → a separate BrowserWindow (same persistent session),
 *                       docked beside the main window. Full Chromium + Widevine.
 *   Mode C  EXTERNAL  → shell.openExternal in the user's default browser.
 *
 * LEGAL GUARDRAILS (structural, not incidental):
 *   • We NEVER intercept/modify media requests, license traffic, or keys.
 *   • We NEVER read/extract cookies or tokens — the persistent Chromium session
 *     stores the user's own login; we only point a browser surface at a URL.
 *   • Playback/sign-in signals come only from Chromium's own high-level
 *     lifecycle events (media-started-playing / did-navigate), never by
 *     inspecting protected content.
 *
 * The manager is the single authority for `VideoModeState`, which it pushes to
 * the renderer on every meaningful change.
 */

/** Shape returned by PROBE_JS from inside the TOD page. */
interface RawPlaybackReading {
  currentTime: number
  paused: boolean
  seekableEnd: number | null
  mediaKey: string | null
}

/**
 * Runs inside a TOD frame and reports its player's clock, or null if that frame
 * has no real media. Read-only by construction: it looks at four properties of
 * the largest ready `<video>` and returns primitives.
 *
 * `mediaKey` deliberately avoids the media URL (which can carry session tokens)
 * — the intrinsic duration plus the video's dimensions change together whenever
 * a different asset is loaded, which is all the anchor needs to notice.
 */
const PROBE_JS = `(() => {
  const videos = Array.from(document.querySelectorAll('video'))
    .filter((v) => v.readyState > 0 && Number.isFinite(v.currentTime));
  if (videos.length === 0) return null;
  const v = videos.sort((a, b) =>
    (b.videoWidth * b.videoHeight) - (a.videoWidth * a.videoHeight))[0];
  let seekableEnd = null;
  try { if (v.seekable && v.seekable.length > 0) seekableEnd = v.seekable.end(v.seekable.length - 1); } catch (_) {}
  const duration = Number.isFinite(v.duration) ? Math.round(v.duration) : 'live';
  return {
    currentTime: v.currentTime,
    paused: !!v.paused,
    seekableEnd: seekableEnd,
    mediaKey: duration + 'x' + v.videoWidth + 'x' + v.videoHeight
  };
})()`

const TOD_PARTITION = 'persist:tod'
const LOAD_TIMEOUT_MS = 20_000

export interface VideoSurfaceDeps {
  getMainWindow(): BrowserWindow | null
  sendState(state: VideoModeState): void
  drmReady(): boolean
}

export class VideoSurfaceManager {
  private deps: VideoSurfaceDeps
  private view: WebContentsView | null = null
  private companion: BrowserWindow | null = null
  private attached = false
  private lastBounds: SurfaceBounds = { x: 0, y: 0, width: 0, height: 0 }
  private loadWatchdog: NodeJS.Timeout | null = null
  private autoFallback = true
  private restrictiveHeaderSeen = false
  private boundsLogged = false

  private state: VideoModeState = {
    mode: 'none',
    url: DEFAULT_TOD_URL,
    playbackActive: 'unknown',
    embeddedSupported: 'unknown',
    fallbackReason: null,
    drmReady: false,
    lastEvent: null,
    updatedAt: new Date().toISOString()
  }

  constructor(deps: VideoSurfaceDeps) {
    this.deps = deps
  }

  /**
   * Configure the TOD session partition. MUST be called after `app.whenReady()`
   * — Electron's `session` API throws if touched before the app is ready.
   */
  init(): void {
    this.configureTodSession()
  }

  getState(): VideoModeState {
    return { ...this.state, drmReady: this.deps.drmReady() }
  }

  // ── Public control surface (called from IPC) ─────────────────────────────

  async setMode(req: SetVideoModeRequest): Promise<VideoModeState> {
    if (typeof req.autoFallback === 'boolean') this.autoFallback = req.autoFallback
    if (req.url) this.state.url = this.trustedTodUrl(req.url)
    if (req.bounds) this.lastBounds = req.bounds

    switch (req.mode) {
      case 'embedded':
        await this.enterEmbedded(this.state.url, this.lastBounds)
        break
      case 'companion':
        this.enterCompanion(this.state.url, null)
        break
      case 'external':
        await this.enterExternal(this.state.url, null)
        break
      case 'none':
        this.teardown()
        this.patch({ mode: 'none', lastEvent: 'surface torn down' })
        break
    }
    return this.getState()
  }

  setBounds(bounds: SurfaceBounds): void {
    this.lastBounds = bounds
    if (this.view && this.state.mode === 'embedded') {
      const applied = {
        x: Math.round(bounds.x),
        y: Math.round(bounds.y),
        width: Math.round(bounds.width),
        height: Math.round(bounds.height)
      }
      if (!this.boundsLogged && applied.width > 0 && applied.height > 0) {
        this.debug('first NON-ZERO setBounds applied', applied)
        this.boundsLogged = true
      }
      this.view.setBounds(applied)
    }
  }

  setVisible(visible: boolean): void {
    if (this.view) this.view.setVisible(visible)
  }

  async setUrl(url: string): Promise<VideoModeState> {
    this.state.url = this.trustedTodUrl(url)
    if (this.state.mode === 'embedded' && this.view) {
      await this.loadEmbedded(this.state.url)
    } else if (this.state.mode === 'companion' && this.companion) {
      await this.companion.loadURL(this.state.url)
    }
    return this.getState()
  }

  reload(): void {
    if (this.state.mode === 'embedded') this.view?.webContents.reload()
    else if (this.state.mode === 'companion') this.companion?.webContents.reload()
  }

  back(): void {
    const wc =
      this.state.mode === 'embedded'
        ? this.view?.webContents
        : this.state.mode === 'companion'
          ? this.companion?.webContents
          : null
    if (wc?.navigationHistory.canGoBack()) wc.navigationHistory.goBack()
  }

  async openExternal(url?: string): Promise<void> {
    await shell.openExternal(this.trustedTodUrl(url ?? this.state.url))
  }

  /**
   * Read the TOD player's clock so the dashboard can follow it.
   *
   * The player lives in a third-party page RaceDeck only hosts, and it is
   * usually several frames deep, so every frame in the subtree is asked and the
   * first one holding real media wins. Nothing here touches playback or content
   * protection — it reads the same three properties any page can read of its own
   * `<video>` element, and returns numbers.
   */
  async probePlayback(): Promise<VideoPlaybackProbe> {
    const miss = (reason: string): VideoPlaybackProbe => ({
      ok: false,
      currentTime: 0,
      paused: true,
      seekableEnd: null,
      mediaKey: null,
      atMs: Date.now(),
      reason
    })

    const wc =
      this.state.mode === 'embedded'
        ? this.view?.webContents
        : this.state.mode === 'companion'
          ? this.companion?.webContents
          : null
    if (!wc || wc.isDestroyed()) {
      return miss(
        this.state.mode === 'external'
          ? 'TOD is open in an external browser, which RaceDeck cannot read.'
          : 'No TOD surface is open.'
      )
    }

    let frames: Electron.WebFrameMain[]
    try {
      frames = wc.mainFrame.framesInSubtree
    } catch {
      return miss('The TOD surface is still loading.')
    }

    for (const frame of frames) {
      let reading: RawPlaybackReading | null = null
      try {
        reading = (await frame.executeJavaScript(PROBE_JS, true)) as RawPlaybackReading | null
      } catch {
        continue // cross-origin frame we cannot reach, or one that just went away
      }
      if (!reading || typeof reading.currentTime !== 'number') continue
      return {
        ok: true,
        currentTime: reading.currentTime,
        paused: Boolean(reading.paused),
        seekableEnd: typeof reading.seekableEnd === 'number' ? reading.seekableEnd : null,
        mediaKey: typeof reading.mediaKey === 'string' ? reading.mediaKey : null,
        atMs: Date.now(),
        reason: null
      }
    }
    return miss('No video is playing in the TOD surface yet.')
  }

  toggleDevTools(): void {
    // DevTools on the DRM surface has no production use and hands anyone with
    // access to the window a console inside the TOD session.
    if (!is.dev) return
    const wc =
      this.state.mode === 'embedded' ? this.view?.webContents : this.companion?.webContents
    if (!wc) return
    if (wc.isDevToolsOpened()) wc.closeDevTools()
    else wc.openDevTools({ mode: 'detach' })
  }

  destroy(): void {
    this.teardown()
  }

  // ── Mode A: embedded ─────────────────────────────────────────────────────

  private async enterEmbedded(url: string, bounds: SurfaceBounds): Promise<void> {
    const win = this.deps.getMainWindow()
    this.debug('enterEmbedded', { host: safeHost(url), bounds, hasWin: !!win })
    if (!win) return

    this.closeCompanion()
    this.ensureView()
    if (!this.view) return

    if (!this.attached) {
      win.contentView.addChildView(this.view)
      this.attached = true
    }
    this.view.setVisible(true)
    // Set mode BEFORE applying bounds so setBounds' mode guard passes.
    this.restrictiveHeaderSeen = false
    this.patch({
      mode: 'embedded',
      fallbackReason: null,
      lastEvent: 'entering embedded mode'
    })
    this.setBounds(bounds)
    await this.loadEmbedded(url)
  }

  private ensureView(): void {
    if (this.view) return
    const ses = session.fromPartition(TOD_PARTITION)
    this.view = new WebContentsView({
      webPreferences: {
        partition: TOD_PARTITION,
        // Remote, untrusted content: no Node, isolated context. RaceDeck never
        // injects scripts into the TOD surface.
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        backgroundThrottling: false,
        autoplayPolicy: 'no-user-gesture-required'
      }
    })
    this.view.setBackgroundColor('#0a0b0f')
    this.view.webContents.setUserAgent(this.chromeUserAgent())
    this.wireViewEvents(this.view.webContents)
    // Redundant safety: also scope permissions on the exact webContents session.
    void ses
  }

  private async loadEmbedded(url: string): Promise<void> {
    if (!this.view) return
    this.patch({
      embeddedSupported: 'unknown',
      playbackActive: 'unknown',
      fallbackReason: null,
      lastEvent: 'loading embedded surface'
    })
    this.armWatchdog('embedded load timed out')
    try {
      await this.view.webContents.loadURL(url, { userAgent: this.chromeUserAgent() })
      this.debug('loadURL resolved', { host: safeHost(url) })
    } catch (err) {
      this.debug('loadURL rejected', { name: (err as Error)?.name })
      // did-fail-load handler already covers the reason; loadURL rejects on
      // aborted navigations too, which we ignore here.
    }
  }

  private wireViewEvents(wc: Electron.WebContents): void {
    wc.on('did-start-loading', () => this.patch({ lastEvent: 'loading…' }))

    wc.on('did-finish-load', () => {
      this.clearWatchdog()
      this.debug('did-finish-load, bounds=', this.lastBounds, 'restrictiveHeaderSeen=', this.restrictiveHeaderSeen)
      // A successful top-level embed is a success — never surface a warning banner
      // for it, even if the site sends X-Frame-Options/frame-ancestors (our
      // WebContentsView is top-level, so those headers don't apply). Clear any
      // stale fallback reason so the banner doesn't pop up on every load.
      this.patch({
        embeddedSupported: 'yes',
        lastEvent: 'embedded surface loaded',
        fallbackReason: null
      })
    })

    wc.on('did-fail-load', (_e, errorCode, _errorDescription, validatedURL, isMainFrame) => {
      this.debug('did-fail-load', { errorCode, isMainFrame })
      if (!isMainFrame) return
      if (errorCode === -3) return // ERR_ABORTED — superseded nav, benign
      this.clearWatchdog()
      const reason = fallbackReasonText('embedded', errorCode)
      void validatedURL
      if (shouldFallback(errorCode, isMainFrame, this.autoFallback)) {
        this.onEmbeddedUnavailable(reason)
      } else if (isHardFailure(errorCode)) {
        // Hard failure but auto-fallback disabled → surface reason, hold mode.
        this.patch({ embeddedSupported: 'no', fallbackReason: reason, lastEvent: reason })
      } else {
        const soft = `Embedded load issue (code ${errorCode}).`
        this.patch({ embeddedSupported: 'no', fallbackReason: soft, lastEvent: soft })
      }
    })

    wc.on('render-process-gone', (_e, details) => {
      this.clearWatchdog()
      this.onEmbeddedUnavailable(`Embedded renderer stopped (${details.reason}).`)
    })

    wc.on('did-navigate', (_e, navUrl) => {
      this.patch({ lastEvent: `navigated: ${safeHost(navUrl)}` })
    })

    // High-level, non-invasive playback lifecycle signals (NOT DRM inspection).
    wc.on('media-started-playing', () => this.patch({ playbackActive: 'yes' }))
    wc.on('media-paused', () => this.patch({ playbackActive: 'no' }))

    this.configureWindowOpenHandler(wc)
  }

  private onEmbeddedUnavailable(reason: string): void {
    this.patch({ embeddedSupported: 'no', fallbackReason: reason, lastEvent: reason })
    if (this.autoFallback) {
      this.enterCompanion(this.state.url, reason)
    }
  }

  // ── Mode B: companion window ─────────────────────────────────────────────

  private enterCompanion(url: string, reason: string | null): void {
    const main = this.deps.getMainWindow()
    if (this.view) this.view.setVisible(false)

    if (!this.companion || this.companion.isDestroyed()) {
      const bounds = this.computeCompanionBounds(main)
      this.companion = new BrowserWindow({
        ...bounds,
        title: 'RaceDeck — TOD Companion',
        backgroundColor: '#0a0b0f',
        autoHideMenuBar: true,
        webPreferences: {
          partition: TOD_PARTITION,
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          backgroundThrottling: false,
          autoplayPolicy: 'no-user-gesture-required'
        }
      })

      const cwc = this.companion.webContents
      cwc.setUserAgent(this.chromeUserAgent())
      this.configureWindowOpenHandler(cwc)
      cwc.on('media-started-playing', () => this.patch({ playbackActive: 'yes' }))
      cwc.on('media-paused', () => this.patch({ playbackActive: 'no' }))
      cwc.on('did-navigate', (_e, navUrl) => {
        this.patch({ lastEvent: `companion navigated: ${safeHost(navUrl)}` })
      })
      cwc.on('did-fail-load', (_e, code, _desc, _u, isMain) => {
        if (isMain && code !== -3 && isHardFailure(code)) {
          // Companion couldn't load either → last resort external.
          void this.enterExternal(this.state.url, fallbackReasonText('companion', code))
        }
      })
      this.companion.on('closed', () => {
        this.companion = null
        if (this.state.mode === 'companion') {
          this.patch({ mode: 'none', lastEvent: 'companion window closed' })
        }
      })
    }

    void this.companion.loadURL(url)
    this.companion.show()
    this.patch({
      mode: 'companion',
      fallbackReason: reason,
      lastEvent: reason ? `Fell back to companion window: ${reason}` : 'companion window active'
    })
  }

  private computeCompanionBounds(main: BrowserWindow | null): {
    x: number
    y: number
    width: number
    height: number
  } {
    if (!main) return { x: 120, y: 120, width: 1000, height: 620 }
    const b = main.getBounds()
    return {
      x: b.x + Math.round(b.width * 0.55),
      y: b.y + 48,
      width: Math.max(720, Math.round(b.width * 0.45)),
      height: Math.max(480, b.height - 96)
    }
  }

  // ── Mode C: external ─────────────────────────────────────────────────────

  private async enterExternal(url: string, reason: string | null): Promise<void> {
    if (this.view) this.view.setVisible(false)
    this.closeCompanion()
    await shell.openExternal(url)
    this.patch({
      mode: 'external',
      fallbackReason: reason,
      lastEvent: reason ? `Opened externally: ${reason}` : 'opened TOD in default browser'
    })
  }

  // ── Session / permissions ────────────────────────────────────────────────

  /** Verbose diagnostics, only when RACEDECK_DEBUG is set. */
  private debug(...args: unknown[]): void {
    if (process.env.RACEDECK_DEBUG) console.log('[vsm]', ...args)
  }

  private trustedTodUrl(url: string): string {
    if (isTrustedTodUrl(url)) return url
    this.debug('rejected untrusted TOD URL', { host: safeHost(url) })
    return DEFAULT_TOD_URL
  }

  private configureWindowOpenHandler(wc: Electron.WebContents): void {
    wc.setWindowOpenHandler(({ url }) => {
      if (isTrustedTodUrl(url)) {
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            title: 'RaceDeck — TOD',
            backgroundColor: '#0a0b0f',
            autoHideMenuBar: true,
            webPreferences: {
              partition: TOD_PARTITION,
              nodeIntegration: false,
              contextIsolation: true,
              sandbox: true,
              webSecurity: true,
              backgroundThrottling: false,
              autoplayPolicy: 'no-user-gesture-required'
            }
          }
        }
      }
      if (isSafeExternalUrl(url)) void shell.openExternal(url)
      else this.debug('blocked unsafe external URL', { host: safeHost(url) })
      return { action: 'deny' }
    })

    wc.on('did-create-window', (child) => {
      const childContents = child.webContents
      childContents.setUserAgent(this.chromeUserAgent())
      childContents.on('will-navigate', (event, url) => {
        if (isTrustedTodUrl(url)) return
        event.preventDefault()
        if (isSafeExternalUrl(url)) void shell.openExternal(url)
      })
      this.configureWindowOpenHandler(childContents)
    })
  }

  /**
   * A clean desktop-Chrome User-Agent (no "Electron"/app tokens). Many broadcast
   * players — TOD included — gate their web player on the UA and render a blank
   * or stripped page for non-standard browsers. This only changes how the
   * surface identifies itself; it does not touch DRM, tokens, or content.
   */
  private chromeUserAgent(): string {
    const chrome = process.versions.chrome?.split('.')[0] ?? '130'
    const platform =
      process.platform === 'darwin'
        ? 'Macintosh; Intel Mac OS X 10_15_7'
        : process.platform === 'win32'
          ? 'Windows NT 10.0; Win64; x64'
          : 'X11; Linux x86_64'
    return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome}.0.0.0 Safari/537.36`
  }

  private configureTodSession(): void {
    const ses: Session = session.fromPartition(TOD_PARTITION)

    // Present as plain desktop Chrome so the TOD player renders normally.
    ses.setUserAgent(this.chromeUserAgent())

    // Grant ONLY EME/fullscreen permissions, and only to exact provider hosts.
    // Playback does not need camera/microphone (`media`) or clipboard access.
    ses.setPermissionRequestHandler((_wc, permission, callback, details) => {
      const allowed = new Set(['mediaKeySystem', 'fullscreen'])
      const granted = allowed.has(permission) && isTrustedTodUrl(details.requestingUrl)
      if (!granted) {
        this.debug('permission denied', {
          permission,
          host: safeHost(details.requestingUrl ?? '')
        })
      }
      callback(granted)
    })
    ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
      const allowed = new Set(['mediaKeySystem', 'fullscreen'])
      return allowed.has(permission) && isTrustedTodUrl(requestingOrigin)
    })

    // READ-ONLY diagnostic: note whether the site *would* restrict iframe
    // embedding. We do NOT modify or strip any headers — top-level navigation
    // already ignores these, so this is purely informational for the UI.
    ses.webRequest.onHeadersReceived((details, cb) => {
      if (details.resourceType === 'mainFrame' && details.responseHeaders) {
        const headers = normalizeHeaderKeys(details.responseHeaders)
        const xfo = headers['x-frame-options']
        const csp = headers['content-security-policy']
        if (xfo || (csp && /frame-ancestors/i.test(csp.join(' ')))) {
          this.restrictiveHeaderSeen = true
        }
      }
      cb({}) // pass through unchanged
    })
  }

  // ── Watchdog + teardown + state ──────────────────────────────────────────

  private armWatchdog(reason: string): void {
    this.clearWatchdog()
    this.loadWatchdog = setTimeout(() => {
      // If we never got did-finish-load or a hard failure, assume the embed is
      // stuck/blocked and fall back (only if the user opted into auto-fallback).
      if (this.state.mode === 'embedded' && this.state.embeddedSupported !== 'yes') {
        this.onEmbeddedUnavailable(reason)
      }
    }, LOAD_TIMEOUT_MS)
  }

  private clearWatchdog(): void {
    if (this.loadWatchdog) {
      clearTimeout(this.loadWatchdog)
      this.loadWatchdog = null
    }
  }

  private closeCompanion(): void {
    if (this.companion && !this.companion.isDestroyed()) {
      this.companion.destroy()
    }
    this.companion = null
  }

  private teardown(): void {
    this.clearWatchdog()
    this.closeCompanion()
    const win = this.deps.getMainWindow()
    if (this.view && this.attached && win && !win.isDestroyed()) {
      win.contentView.removeChildView(this.view)
    }
    this.attached = false
    if (this.view) {
      // WebContentsView cleanup: closing its webContents frees the surface.
      this.view.webContents.close()
      this.view = null
    }
    this.patch({ playbackActive: 'unknown' })
  }

  private patch(partial: Partial<VideoModeState>): void {
    this.state = {
      ...this.state,
      ...partial,
      drmReady: this.deps.drmReady(),
      updatedAt: new Date().toISOString()
    }
    this.deps.sendState(this.state)
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

function safeHost(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return '<invalid-url>'
  }
}

function normalizeHeaderKeys(
  headers: Record<string, string[] | string>
): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const [k, v] of Object.entries(headers)) {
    out[k.toLowerCase()] = Array.isArray(v) ? v : [v]
  }
  return out
}

export type { VideoMode }
