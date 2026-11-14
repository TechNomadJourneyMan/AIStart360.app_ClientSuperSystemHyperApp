import type { SupabaseClient } from '@supabase/supabase-js'
import { mfaFlagsEnrolled } from '@/lib/mfa/flags'
import { MFA_COOKIE_NAME, verifyStepUpEdge } from '@/lib/mfa/step-up-edge'
import { stepUpSessionKeyFromCookies } from '@/lib/mfa/session-binding'
import { edgeSettings } from '@/lib/settings/edge'
import { devAccessConfigured, devModeOnForRequest } from '@/lib/dev/dev-access'

/**
 * R-005 — second factor for staff rights on /api/v1/*.
 *
 * Loaded ONLY through `await import()` from lib/api-identity.ts, which is
 * shared with a client component (components/point-b/pointBAccess.ts imports
 * isStaffRole). Therefore this module must stay client-compilable: no static
 * `next/headers` (it is imported dynamically below), no node:crypto (Web Crypto
 * verifier), no service-role SDK client (plain fetch to PostgREST).
 *
 * The rule is the one of staffMfaGate (lib/admin/giga-actor.ts), which guards
 * the GIGA and expert API:
 *  - enrolled (JWT flags OR user_security.totp_enabled OR a passkey) → the
 *    step-up proof of THIS session is required;
 *  - not enrolled → allowed, unless the platform requires 2FA for staff;
 *  - the localhost developer login counts as the second factor (never in a
 *    production build);
 *  - anything unreadable → 'unavailable' (callers fail closed).
 */
export type StaffApiGate = 'ok' | 'step_up' | 'enroll' | 'unavailable'

type CookieJar = { getAll(): Array<{ name: string; value: string }>; get(name: string): { value: string } | undefined }

async function requestContext(): Promise<{ jar: CookieJar; headers: Headers } | null> {
  try {
    const mod = await import('next/headers')
    return { jar: mod.cookies() as unknown as CookieJar, headers: mod.headers() as unknown as Headers }
  } catch {
    return null
  }
}

function devMode(jar: CookieJar, headers: Headers): boolean {
  if (process.env.NODE_ENV === 'production') return false
  if (!devAccessConfigured()) return false
  try {
    return devModeOnForRequest({
      method: 'GET',
      nextUrl: { host: headers.get('host') ?? '' },
      headers,
      cookies: jar,
    })
  } catch {
    return false
  }
}

async function restRows(path: string): Promise<unknown[] | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, '')
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  try {
    const res = await fetch(`${url}/rest/v1/${path}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(4_000),
    })
    if (!res.ok) return null
    const rows = (await res.json()) as unknown
    return Array.isArray(rows) ? rows : null
  } catch {
    return null
  }
}

/** Is the staff session of `userId` admitted to act with staff rights? */
export async function staffApiSecondFactor(sb: SupabaseClient, userId: string): Promise<StaffApiGate> {
  const ctx = await requestContext()
  if (!ctx) return 'unavailable'
  if (devMode(ctx.jar, ctx.headers)) return 'ok'

  let user: { id: string; app_metadata?: Record<string, unknown>; user_metadata?: Record<string, unknown> } | null = null
  try {
    user = (await sb.auth.getUser()).data.user
  } catch {
    return 'unavailable'
  }
  if (!user || user.id !== userId) return 'unavailable'

  let enrolled = mfaFlagsEnrolled(user)
  if (!enrolled) {
    const id = encodeURIComponent(userId)
    const [sec, keys] = await Promise.all([
      restRows(`user_security?user_id=eq.${id}&select=totp_enabled`),
      restRows(`webauthn_credentials?user_id=eq.${id}&select=user_id&limit=1`),
    ])
    if (!sec || !keys) return 'unavailable'
    enrolled = (sec[0] as { totp_enabled?: boolean } | undefined)?.totp_enabled === true || keys.length > 0
  }

  if (enrolled) {
    const sessionKey = stepUpSessionKeyFromCookies(ctx.jar.getAll())
    return (await verifyStepUpEdge(ctx.jar.get(MFA_COOKIE_NAME)?.value, userId, sessionKey)) ? 'ok' : 'step_up'
  }
  return (await edgeSettings()).staff_require_mfa ? 'enroll' : 'ok'
}
