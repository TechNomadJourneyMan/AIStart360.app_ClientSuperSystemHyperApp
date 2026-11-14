// ─────────────────────────────────────────────────────────────────────────────
// Which Supabase Auth session a request belongs to (R-132, R-008).
//
// Edge-safe and dependency-free (no node:crypto, no next/headers): middleware,
// route handlers and the client-shared lib/api-identity.ts path may all use it.
//
// The step-up cookie (lib/mfa/step-up*.ts) and the impersonation binding are
// tied to the GoTrue session id — the `session_id` claim of the access token.
// It is the same for the whole life of a sign-in (token refreshes keep it) and
// new for every sign-in, so a proof made in one session is worthless in the
// next one: after a sign-out, a sign-in as another user, or on another device.
//
// Trust: the claim is read WITHOUT checking the JWT signature. Callers use it
// only after Supabase verified the very same session (`auth.getUser()` in
// middleware / the route), or only to ADD a restriction. A forged token never
// passes getUser(), so a forged session id cannot grant anything.
// ─────────────────────────────────────────────────────────────────────────────

/** Stand-in key when GoTrue issues tokens without `session_id` (very old GoTrue). */
export const NO_SESSION_ID = 'nosid'

export interface AuthSessionClaims {
  sub: string | null
  /** GoTrue session id, or NO_SESSION_ID when the token has none. */
  sessionKey: string
  /** `exp` in ms, or null. */
  expMs: number | null
  /** Authentication methods (`amr[].method`). */
  amr: string[]
}

function base64UrlDecodeToString(input: string): string {
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/')
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
  const bin = atob(padded)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

const SAFE_KEY = /^[A-Za-z0-9-]{1,64}$/

/** Claims of an access token (no signature check — see the header). */
export function authSessionFromAccessToken(token: string | null | undefined): AuthSessionClaims | null {
  if (!token || typeof token !== 'string') return null
  const parts = token.split('.')
  if (parts.length !== 3 || !parts[1]) return null
  try {
    const p = JSON.parse(base64UrlDecodeToString(parts[1])) as Record<string, unknown>
    const sid = typeof p.session_id === 'string' && SAFE_KEY.test(p.session_id) ? p.session_id : NO_SESSION_ID
    const amr = Array.isArray(p.amr)
      ? p.amr.map((a) => (a && typeof a === 'object' ? (a as { method?: unknown }).method : a)).filter((m): m is string => typeof m === 'string')
      : []
    return {
      sub: typeof p.sub === 'string' ? p.sub : null,
      sessionKey: sid,
      expMs: typeof p.exp === 'number' ? p.exp * 1000 : null,
      amr,
    }
  } catch {
    return null
  }
}

interface CookieLike { name: string; value: string }

const AUTH_COOKIE = /^(sb-.+-auth-token)(?:\.(\d+))?$/

/** `sb-<first label of the Supabase host>-auth-token` — supabase-js' default storage key. */
export function expectedAuthCookieName(supabaseUrl: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_URL): string | null {
  if (!supabaseUrl) return null
  try {
    return `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`
  } catch {
    return null
  }
}

/**
 * The access token stored by @supabase/ssr in the request cookies: the
 * `sb-<ref>-auth-token` cookie, possibly split into `.0`, `.1`… chunks, its
 * value `base64-<base64url JSON>` (ssr ≥ 0.4) or plain / URI-encoded JSON.
 */
export function accessTokenFromCookies(cookies: readonly CookieLike[], supabaseUrl?: string): string | null {
  const groups = new Map<string, { whole?: string; chunks: Map<number, string> }>()
  for (const c of cookies) {
    const m = AUTH_COOKIE.exec(c.name)
    if (!m || m[1].endsWith('-code-verifier')) continue
    const g = groups.get(m[1]) ?? { chunks: new Map<number, string>() }
    if (m[2] === undefined) g.whole = c.value
    else g.chunks.set(Number(m[2]), c.value)
    groups.set(m[1], g)
  }
  if (groups.size === 0) return null
  const expected = expectedAuthCookieName(supabaseUrl)
  const group = (expected && groups.get(expected)) ?? (groups.size === 1 ? Array.from(groups.values())[0] : null)
  if (!group) return null

  let raw = group.whole
  if (!raw && group.chunks.size > 0) {
    const parts: string[] = []
    for (let i = 0; group.chunks.has(i); i++) parts.push(group.chunks.get(i)!)
    raw = parts.join('')
  }
  if (!raw) return null

  try {
    let json: string
    if (raw.startsWith('base64-')) json = base64UrlDecodeToString(raw.slice('base64-'.length))
    else if (raw.startsWith('%')) json = decodeURIComponent(raw)
    else json = raw
    const parsed = JSON.parse(json) as unknown
    // Older formats stored [access_token, refresh_token, …].
    if (Array.isArray(parsed)) return typeof parsed[0] === 'string' ? parsed[0] : null
    const t = (parsed as { access_token?: unknown } | null)?.access_token
    return typeof t === 'string' ? t : null
  } catch {
    return null
  }
}

/** Claims of the session held in the request cookies, or null. */
export function authSessionFromCookies(cookies: readonly CookieLike[], supabaseUrl?: string): AuthSessionClaims | null {
  return authSessionFromAccessToken(accessTokenFromCookies(cookies, supabaseUrl))
}

/**
 * The step-up binding key of the current session (its `session_id`), or null
 * when no session can be read from the cookies — callers fail closed then.
 */
export function stepUpSessionKeyFromCookies(cookies: readonly CookieLike[], supabaseUrl?: string): string | null {
  return authSessionFromCookies(cookies, supabaseUrl)?.sessionKey ?? null
}
