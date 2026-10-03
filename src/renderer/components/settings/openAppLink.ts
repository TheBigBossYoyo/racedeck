import { hasBridge, bridge } from '@renderer/lib/ipc'

/**
 * Open one of the app's own outbound links in the default browser. This is NOT
 * the TOD `video.openExternal`, which rewrites any non-TOD URL to the TOD home
 * page. Main re-checks an https, exact-host allow-list and rejects the rest.
 */
export function openAppLink(url: string): void {
  if (!hasBridge()) return
  bridge()
    .app.openExternal(url)
    .catch((err: unknown) => {
      console.error('[settings] Could not open link:', err instanceof Error ? err.message : err)
    })
}
