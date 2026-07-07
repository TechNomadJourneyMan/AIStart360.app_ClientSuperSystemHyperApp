/**
 * Guard against open-redirect / off-origin navigation.
 *
 * Returns `raw` only when it is a safe *internal* path — one that a browser or
 * WHATWG URL parser cannot fold into an off-origin destination. Otherwise it
 * returns `fallback`.
 *
 * Rejected vectors:
 *   - absolute URLs (`https://evil.com`)                — has a scheme
 *   - protocol-relative URLs (`//evil.com`)             — leading `//`
 *   - backslash escapes (`/\evil.com`, `/\/evil.com`)   — special schemes fold `\`→`/`
 *   - non-slash-prefixed values (`dashboard`, `javascript:…`)
 *   - control characters / whitespace injection
 *
 * Accepted: any value beginning with a single `/` followed by a non-slash,
 * non-backslash char (query string and hash are preserved), plus the bare `/`.
 *
 * Used by the OAuth callback (`?next=`) and the `?from=` post-auth redirects
 * on /login and /2fa.
 */
function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i)
    // C0 controls (incl. tab / newline / null) and DEL.
    if (c < 0x20 || c === 0x7f) return true
  }
  return false
}

export function safeInternalPath(
  raw: string | null | undefined,
  fallback = '/dashboard',
): string {
  if (!raw || typeof raw !== 'string') return fallback

  const value = raw.trim()
  if (value === '') return fallback

  // Reject control characters (covers newline / tab / null injection).
  if (hasControlChar(value)) return fallback

  // The bare root is safe.
  if (value === '/') return value

  // Must be a rooted path: exactly one leading slash, and the next char must
  // not be another slash or a backslash (both fold to a protocol-relative
  // host under WHATWG URL parsing for special schemes).
  if (value[0] !== '/') return fallback
  if (value[1] === '/' || value[1] === '\\') return fallback

  return value
}
