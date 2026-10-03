/**
 * Host matching for the F1 sign-in flow. Deliberately exact: a substring test
 * such as `domain.includes('formula1.com')` also matches `evilformula1.com`, and
 * the cookies gathered under it are replayed to F1 as the user's credentials.
 */

const F1_ROOT = 'formula1.com'

/** `formula1.com` itself or any subdomain of it. */
export function isFormula1Host(host: string): boolean {
  const h = host.toLowerCase()
  return h === F1_ROOT || h.endsWith(`.${F1_ROOT}`)
}

/**
 * A cookie's `domain` may carry a leading dot (domain cookies); that dot is not
 * part of the host, so it is removed before matching.
 */
export function isFormula1CookieDomain(domain: string | null | undefined): boolean {
  if (!domain) return false
  return isFormula1Host(domain.replace(/^\.+/, ''))
}

export function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Where the F1 sign-in window may navigate. Just https (plus the inert
 * about:blank that popups start on), not a host allow-list: the login flow can
 * hop through F1's own domains, social sign-in providers and a bot-protection
 * challenge host, and enumerating those without running the flow would break
 * sign-in. What this rules out is the dangerous set: file:, data:, javascript:,
 * custom protocol handlers and plaintext http.
 */
export function isLoginNavigationAllowed(value: string): boolean {
  return value === 'about:blank' || isHttpsUrl(value)
}
