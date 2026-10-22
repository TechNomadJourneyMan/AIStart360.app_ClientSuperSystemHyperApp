/**
 * Canonical public base URL of the portal.
 *
 * Single source of truth so email links, notifications, escalation links and
 * the OpenRouter HTTP-Referer never hardcode a stale deployment domain (the old
 * bug: several files defaulted to a friend's `aistart360.vercel.app` deploy,
 * so links pointed at the wrong app).
 *
 * Precedence: AUTH_URL → NEXT_PUBLIC_APP_URL → canonical production default;
 * a stale / unsafe value is skipped (see usableBase).
 * Set AUTH_URL in the environment to override per deployment.
 *
 * NOTE: this does NOT control the Supabase OAuth "Site URL" — that redirect
 * target is configured in the Supabase dashboard, not here.
 */
const CANONICAL_SITE_URL = 'https://portal.aistart360.app'

/** Hosts that must never appear in links we send (the friend's old deploy). */
const STALE_HOSTS = new Set(['aistart360.vercel.app'])

/**
 * A configured base URL we can put into an email: a valid http(s) URL, not a
 * known stale host, and in production https and not a loopback address. An
 * unusable value is skipped (the next candidate is tried) — a left-over
 * AUTH_URL from the NextAuth era must not send recovery links elsewhere.
 */
function usableBase(raw: string | undefined): string | null {
  const value = raw?.trim()
  if (!value) return null
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (STALE_HOSTS.has(url.hostname)) return null
  if (process.env.NODE_ENV === 'production') {
    if (url.protocol !== 'https:') return null
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]') return null
  }
  return value
}

export function getSiteUrl(path?: string): string {
  const raw = usableBase(process.env.AUTH_URL) ?? usableBase(process.env.NEXT_PUBLIC_APP_URL) ?? CANONICAL_SITE_URL
  const base = raw.replace(/\/+$/, '')
  if (!path) return base
  return `${base}/${path.replace(/^\/+/, '')}`
}
