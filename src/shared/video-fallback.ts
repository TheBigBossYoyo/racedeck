import type { VideoMode } from './models'

const TRUSTED_TOD_HOSTS = ['tod.tv', 'bein.com', 'beinsports.com'] as const

/**
 * Pure TOD fallback-ladder logic, shared by the main-process VideoSurfaceManager
 * and the renderer/tests. Keeping it here (framework-free) makes the fallback
 * behavior unit-testable without spinning up Electron.
 *
 * Ladder:  embedded → companion → external  (external is terminal)
 */

/** did-fail-load error codes that mean "this surface cannot load here". */
export const HARD_FAILURE_CODES: readonly number[] = [
  -20, // ERR_BLOCKED_BY_CLIENT
  -27, // ERR_BLOCKED_BY_ADMINISTRATOR
  -30, // ERR_BLOCKED_BY_RESPONSE
  -7, // ERR_TIMED_OUT
  -102, // ERR_CONNECTION_REFUSED
  -105, // ERR_NAME_NOT_RESOLVED
  -106, // ERR_INTERNET_DISCONNECTED
  -137, // ERR_NAME_RESOLUTION_FAILED
  -501 // ERR_INSECURE_RESPONSE
]

/** ERR_ABORTED (-3) is benign (a superseded navigation), never a failure. */
export const BENIGN_ABORT_CODE = -3

export function isHardFailure(code: number): boolean {
  return HARD_FAILURE_CODES.includes(code)
}

/**
 * Decide whether a did-fail-load should trigger a fallback. Only main-frame,
 * non-benign, hard failures fall back — and only when auto-fallback is enabled.
 */
export function shouldFallback(
  errorCode: number,
  isMainFrame: boolean,
  autoFallback: boolean
): boolean {
  if (!isMainFrame) return false
  if (errorCode === BENIGN_ABORT_CODE) return false
  if (!autoFallback) return false
  return isHardFailure(errorCode)
}

/** The next mode down the ladder. `external` is terminal. */
export function nextFallbackMode(current: VideoMode): VideoMode {
  switch (current) {
    case 'embedded':
      return 'companion'
    case 'companion':
      return 'external'
    case 'external':
      return 'external'
    default:
      return 'external'
  }
}

/**
 * Choose the starting mode. A DRM-ready runtime always starts inside RaceDeck;
 * without Widevine, the user's normal browser is the truthful safe fallback.
 */
export function decideInitialMode(drmReady: boolean): VideoMode {
  return drmReady ? 'embedded' : 'external'
}

/**
 * Exact HTTPS host check for provider-owned browser surfaces and permission
 * requests. Suffix matching permits real subdomains without accepting lookalike
 * domains such as `tod.tv.example.com` or `evilbein.com`.
 */
export function isTrustedTodUrl(value: string | undefined): boolean {
  if (!value) return false
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:') return false
    const hostname = url.hostname.toLowerCase()
    return TRUSTED_TOD_HOSTS.some(
      (trusted) => hostname === trusted || hostname.endsWith(`.${trusted}`)
    )
  } catch {
    return false
  }
}

/** URLs handed to the operating system must use normal HTTPS navigation. */
export function isSafeExternalUrl(value: string | undefined): boolean {
  if (!value) return false
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

export function describeMode(mode: VideoMode): { label: string; short: string; blurb: string } {
  switch (mode) {
    case 'embedded':
      return {
        label: 'TOD embedded mode active',
        short: 'Embedded',
        blurb: 'TOD is playing inside RaceDeck via a secure, top-level browser surface.'
      }
    case 'companion':
      return {
        label: 'TOD companion window mode active',
        short: 'Companion',
        blurb: 'TOD runs in a docked companion window managed by RaceDeck.'
      }
    case 'external':
      return {
        label: 'TOD external mode active',
        short: 'External',
        blurb: 'TOD opens in your default browser; RaceDeck keeps the data in sync.'
      }
    default:
      return {
        label: 'TOD not connected',
        short: 'Off',
        blurb: 'No TOD surface is active yet.'
      }
  }
}

export function fallbackReasonText(from: VideoMode, code?: number): string {
  const detail = code != null ? ` (code ${code})` : ''
  if (from === 'embedded') {
    return `TOD playback cannot run in embedded mode on this system due to platform or content-protection restrictions${detail}. RaceDeck has switched to Companion Window mode.`
  }
  if (from === 'companion') {
    return `TOD could not load in the companion window${detail}. RaceDeck has opened TOD in your default browser.`
  }
  return `TOD surface changed${detail}.`
}
