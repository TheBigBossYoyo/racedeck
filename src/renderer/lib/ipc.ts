import type { RaceDeckApi } from '@shared/ipc-contract'

/**
 * Safe accessor for the preload bridge. In the browser-only test/storybook
 * context `window.racedeck` may be undefined, so callers can guard with
 * `hasBridge()`.
 */
export function hasBridge(): boolean {
  return typeof window !== 'undefined' && !!(window as Window).racedeck
}

export function bridge(): RaceDeckApi {
  const api = (window as Window).racedeck
  if (!api) {
    throw new Error(
      'RaceDeck IPC bridge unavailable. This build must run inside the Electron shell.'
    )
  }
  return api
}
