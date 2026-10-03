import { AI_PROVIDERS } from './ai'

/**
 * Pages the app itself links to from its own UI (Settings: "Get a key" and the
 * pinned Polymarket event). These open in the user's default browser; nothing
 * else is reachable through the external-open channel.
 */
const POLYMARKET_HOST = 'polymarket.com'
const MAX_EXTERNAL_URL_LENGTH = 2048

function hostOf(rawUrl: string): string | null {
  try {
    return new URL(rawUrl).hostname
  } catch {
    return null
  }
}

/**
 * Exact hostnames only (no suffix matching). Derived from the provider registry
 * so adding a provider with a `keyUrl` needs no second edit here.
 */
export const EXTERNAL_LINK_HOSTS: ReadonlySet<string> = new Set(
  [
    ...Object.values(AI_PROVIDERS)
      .map((provider) => (provider.keyUrl ? hostOf(provider.keyUrl) : null))
      .filter((host): host is string => host !== null),
    POLYMARKET_HOST
  ].map((host) => host.toLowerCase())
)

/** True only for an https URL on an allow-listed host, with no credentials or port. */
export function isAllowedExternalUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_EXTERNAL_URL_LENGTH) {
    return false
  }
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  return (
    url.protocol === 'https:' &&
    url.port === '' &&
    !url.username &&
    !url.password &&
    EXTERNAL_LINK_HOSTS.has(url.hostname.toLowerCase())
  )
}
