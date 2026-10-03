/**
 * Which pages may talk to the privileged main process, and which may be shown in
 * the main window at all.
 *
 * Only the main window loads the preload bridge, and it only ever shows the app's
 * own document: the packaged `index.html` (file://) or, in dev, the electron-vite
 * server. These checks make that an enforced invariant rather than a happy path.
 */

function parse(url: string | null | undefined): URL | null {
  if (!url) return null
  try {
    return new URL(url)
  } catch {
    return null
  }
}

function devOrigin(devServerUrl: string | null | undefined): string | null {
  const dev = parse(devServerUrl)
  if (!dev || (dev.protocol !== 'http:' && dev.protocol !== 'https:')) return null
  return dev.origin
}

/** A local file, never one on a remote (UNC) host. */
function isLocalFile(url: URL): boolean {
  return url.protocol === 'file:' && url.host === ''
}

/**
 * True when an IPC message came from a frame showing the app's own UI.
 * `devServerUrl` must be passed only in dev builds; without it, only local
 * `file://` documents are trusted.
 */
export function isTrustedSender(
  url: string | null | undefined,
  devServerUrl?: string | null
): boolean {
  const parsed = parse(url)
  if (!parsed) return false
  if (isLocalFile(parsed)) return true
  const origin = devOrigin(devServerUrl)
  return origin !== null && parsed.origin === origin
}

/**
 * True when the main window may navigate to `url`: the exact app document
 * (any hash/query) or the dev-server origin. Stricter than `isTrustedSender`
 * because a navigation could otherwise load an arbitrary local file with the
 * preload bridge attached.
 */
export function isAppNavigation(
  url: string,
  devServerUrl: string | null | undefined,
  appFileUrl: string
): boolean {
  const parsed = parse(url)
  if (!parsed) return false
  const origin = devOrigin(devServerUrl)
  if (origin !== null && parsed.origin === origin) return true
  const app = parse(appFileUrl)
  if (!app || !isLocalFile(parsed) || !isLocalFile(app)) return false
  return parsed.pathname.toLowerCase() === app.pathname.toLowerCase()
}
