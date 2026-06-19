// ─────────────────────────────────────────────────────────────────────────────
// Portal locale module — the single source of truth for which language the UI
// (and AI-generated content) renders in.
//
// SCOPE (this phase): only AI INSIGHTS and NEW-MODULE labels follow this locale.
// Russian is the default and stays the default. Built to be EXTENSIBLE — adding
// a new language later (e.g. 'kz') is a one-line change to the Locale union and
// the LOCALES array; everything downstream keys off these.
//
// This module is PURE: no framework imports, no side effects at import time.
// The client helpers guard `typeof window` so the file is import-safe on the
// server. Server route handlers do NOT call getClientLocale/setClientLocale —
// they read the cookie off the request (see localeFromRequestCookie below).
// ─────────────────────────────────────────────────────────────────────────────

export type Locale = 'ru' | 'en'

// To add a language later: extend the Locale union above and append it here.
export const LOCALES: Locale[] = ['ru', 'en']

export const DEFAULT_LOCALE: Locale = 'ru'

export const LOCALE_COOKIE = 'aistart360_locale'

/**
 * Coerce an arbitrary string (cookie value, header, query param) into a known
 * Locale. Unknown / empty / nullish values fall back to DEFAULT_LOCALE.
 */
export function normalizeLocale(v: string | null | undefined): Locale {
  if (!v) return DEFAULT_LOCALE
  const lower = v.toLowerCase().trim()
  return (LOCALES as string[]).includes(lower) ? (lower as Locale) : DEFAULT_LOCALE
}

/**
 * Client-only: read the persisted locale from document.cookie.
 * Returns DEFAULT_LOCALE on the server (no window) or when no cookie is set.
 */
export function getClientLocale(): Locale {
  if (typeof window === 'undefined') return DEFAULT_LOCALE
  const match = document.cookie
    .split('; ')
    .find((row) => row.startsWith(`${LOCALE_COOKIE}=`))
  const value = match ? decodeURIComponent(match.slice(LOCALE_COOKIE.length + 1)) : null
  return normalizeLocale(value)
}

/**
 * Client-only: persist the locale to a cookie (path=/, 1-year max-age) and
 * reload so server route handlers (which read the cookie off the request) pick
 * up the new value. No-op on the server.
 */
export function setClientLocale(l: Locale): void {
  if (typeof window === 'undefined') return
  const locale = normalizeLocale(l)
  const oneYear = 60 * 60 * 24 * 365
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=${oneYear}; SameSite=Lax`
  window.location.reload()
}

/**
 * Server helper: extract the locale from a request-like object whose cookies
 * expose `.get(name)`. Works with NextRequest (`req.cookies`) and the
 * ReadonlyRequestCookies returned by next/headers `cookies()`.
 */
export function localeFromRequestCookie(req: {
  cookies: { get(name: string): { value?: string } | undefined }
}): Locale {
  return normalizeLocale(req.cookies.get(LOCALE_COOKIE)?.value)
}
