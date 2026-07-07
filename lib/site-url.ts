/**
 * Canonical public base URL of the portal.
 *
 * Single source of truth so email links, notifications, escalation links and
 * the OpenRouter HTTP-Referer never hardcode a stale deployment domain (the old
 * bug: several files defaulted to a friend's `aistart360.vercel.app` deploy,
 * so links pointed at the wrong app).
 *
 * Precedence: AUTH_URL → NEXT_PUBLIC_APP_URL → canonical production default.
 * Set AUTH_URL in the environment to override per deployment.
 *
 * NOTE: this does NOT control the Supabase OAuth "Site URL" — that redirect
 * target is configured in the Supabase dashboard, not here.
 */
const CANONICAL_SITE_URL = 'https://portal.aistart360.app'

export function getSiteUrl(path?: string): string {
  const raw = process.env.AUTH_URL || process.env.NEXT_PUBLIC_APP_URL || CANONICAL_SITE_URL
  const base = raw.replace(/\/+$/, '')
  if (!path) return base
  return `${base}/${path.replace(/^\/+/, '')}`
}
