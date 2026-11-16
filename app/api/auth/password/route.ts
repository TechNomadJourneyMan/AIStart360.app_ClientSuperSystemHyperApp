import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { friendlyAuthError } from '@/lib/auth/login-links'
import { checkRateLimit, clientIp } from '@/lib/rate-limit'
import { getSiteUrl } from '@/lib/site-url'
import { INVITE_ONLY_MESSAGE, isSignupBlocked } from '@/lib/auth/invite-only-shared'

export const dynamic = 'force-dynamic'

const credentials = z.object({
  email: z.string().trim().email().max(320),
  // Existing accounts may have passwords older than the registration policy.
  password: z.string().min(1).max(4096),
})

function denied(code: string, error: string, retryAfterSeconds?: number) {
  // Invalid credentials are an expected form result, not a failed resource.
  // Authentication is still denied; neither tokens nor user data are returned.
  return NextResponse.json(
    { ok: false, code, error },
    { headers: {
      'Cache-Control': 'no-store',
      ...(retryAfterSeconds ? { 'Retry-After': String(retryAfterSeconds) } : {}),
    } },
  )
}

/**
 * Keep GoTrue's expected 400 for a wrong password on the server. The browser
 * receives a typed form outcome and installs a session only after GoTrue has
 * actually authenticated it. Uses the public anon key, never the admin API.
 */
export async function POST(request: Request) {
  try {
    const origin = request.headers.get('origin')
    // A reverse proxy may address Next on an internal host/port. Trust only
    // the actual request origin or the configured public portal origin,
    // never client-supplied forwarded-host headers.
    const trustedOrigins = new Set([
      new URL(request.url).origin,
      new URL(getSiteUrl()).origin,
    ])
    if (request.headers.get('sec-fetch-site') === 'cross-site'
      || (origin && !trustedOrigins.has(origin))) {
      return denied('invalid_origin', 'Откройте страницу входа на этом сайте и попробуйте снова.')
    }

    const ipLimit = await checkRateLimit(clientIp(request), 'password-login-ip', {
      max: 20, windowMs: 60_000, failClosed: true,
    })
    if (ipLimit.limited) {
      return denied('rate_limited', friendlyAuthError('rate limit'), ipLimit.retryAfterSeconds)
    }

    const parsed = credentials.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return denied('invalid_input', 'Введите корректную электронную почту и пароль.')
    }
    const { email, password } = parsed.data
    const accountLimit = await checkRateLimit(email.toLowerCase(), 'password-login-account', {
      max: 10, windowMs: 60_000, failClosed: true,
    })
    if (accountLimit.limited) {
      return denied('rate_limited', friendlyAuthError('rate limit'), accountLimit.retryAfterSeconds)
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!url || !anonKey) {
      return denied('unavailable', 'Сервис входа временно недоступен. Попробуйте ещё раз позже.')
    }

    const supabase = createClient(url, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
      global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }) },
    })
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error || !data.session || !data.user) {
      return denied('authentication_failed', friendlyAuthError(error?.message))
    }

    // R4 B3 (review W3A-1 / W3A-2, verify NV3-2): an account created around
    // the invitation (app_metadata.signup_blocked) — e.g. a password set
    // through recovery — gets a session here only as everywhere else: staff
    // approved it, or it has been invited (GoTrue invited_at or a
    // platform_invitations row — inviteOnlyDecision, as in /auth/callback and
    // /auth/verify). Then the mark goes and the browser gets a token without it.
    let session = data.session
    if (isSignupBlocked(data.user)) {
      const { createServiceClient } = await import('@/lib/supabase-service')
      const { clearSignupBlocked, inviteOnlyDecision } = await import('@/lib/auth/invite-only-gate')
      const admin = createServiceClient()
      const { data: prof } = await admin.from('profiles').select('status').eq('id', data.user.id).maybeSingle()
      if ((prof as { status?: string } | null)?.status === 'approved') {
        await clearSignupBlocked(admin, data.user.id)
      } else if ((await inviteOnlyDecision(admin, data.user)).decision !== 'allow') {
        await supabase.auth.signOut().catch(() => undefined)
        return denied('invite_only', INVITE_ONLY_MESSAGE)
      }
      // Approved, or invited (inviteOnlyDecision cleared the mark): a token without it.
      const refreshed = await supabase.auth.refreshSession()
      if (refreshed.data.session) session = refreshed.data.session
    }

    // The browser SSR client writes its usual session cookies via setSession,
    // keeping its in-memory state and every authenticated query in sync.
    return NextResponse.json({
      ok: true,
      session: {
        access_token: session.access_token,
        refresh_token: session.refresh_token,
      },
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    // Never expose provider internals or credentials in the response/logs.
    return denied('unavailable', 'Нет связи с сервером. Попробуйте войти ещё раз.')
  }
}
