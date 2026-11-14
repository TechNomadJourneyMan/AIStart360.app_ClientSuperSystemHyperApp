/**
 * POST /api/auth/demo-access/cleanup
 *
 * Deletes a demo auth.users row created by /api/auth/demo-access.
 * Safety: only deletes when the target user has
 * `user_metadata.demo === true` — protects real accounts even if their
 * UUID leaks. No additional auth required because demo users carry no
 * sensitive data and are throw-away by design.
 *
 * R-224: the route is anonymous, so its answer must not tell whether a UUID exists or belongs to a
 * real account. Not found / not a demo user / deleted / delete failed all return the same
 * `200 { ok: true }` (the cause is logged server-side), and calls are rate-limited by the trusted
 * client IP (lib/net/client-ip via lib/rate-limit).
 */

import { NextResponse } from 'next/server'
import { createClient as createSupabaseAdmin } from '@supabase/supabase-js'
import { checkRateLimitForRequest, rateLimitResponse } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface Body { userId?: unknown }

/** The one answer for every well-formed UUID (R-224). */
const done = () => NextResponse.json({ ok: true }, { status: 200 })

export async function POST(req: Request) {
  const rl = await checkRateLimitForRequest(req, 'demo-access-cleanup', { max: 10, windowMs: 60_000 })
  if (rl.limited) return rateLimitResponse(rl)

  let body: Body
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 })
  }

  const userId = typeof body.userId === 'string' ? body.userId.trim() : ''
  if (!userId || !/^[0-9a-f-]{36}$/i.test(userId)) {
    return NextResponse.json({ ok: false, error: 'invalid_user_id' }, { status: 400 })
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    return NextResponse.json(
      { ok: false, error: 'admin_unavailable' },
      { status: 500 },
    )
  }

  const admin = createSupabaseAdmin(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // Verify the user is actually a demo account before deletion.
  const { data: target, error: fetchErr } = await admin.auth.admin.getUserById(userId)
  if (fetchErr || !target?.user) {
    // Already gone (or never existed) — same answer as a successful delete.
    return done()
  }
  // app_metadata is server-only; user_metadata could be set by the user, so it
  // only counts together with the generated demo e-mail address.
  const isDemo = target.user.app_metadata?.demo === true
    || (target.user.user_metadata?.demo === true && /^demo-[a-z0-9]+@aistart360\.app$/.test(target.user.email ?? ''))
  if (!isDemo) {
    // A real account is never deleted here, and the caller is not told it exists.
    console.warn('[demo-access/cleanup] refused: target is not a demo account')
    return done()
  }

  const { error: delErr } = await admin.auth.admin.deleteUser(userId)
  if (delErr) {
    // The daily demo sweep (lib/functions/demo-cleanup) retries; do not reveal the difference.
    console.error('[demo-access/cleanup] delete failed:', delErr.message?.slice(0, 200))
  }

  return done()
}
