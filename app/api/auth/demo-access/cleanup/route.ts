/**
 * POST /api/auth/demo-access/cleanup
 *
 * Deletes a demo auth.users row created by /api/auth/demo-access.
 * Safety: only deletes when the target user has
 * `user_metadata.demo === true` — protects real accounts even if their
 * UUID leaks. No additional auth required because demo users carry no
 * sensitive data and are throw-away by design.
 */

import { NextResponse } from 'next/server'
import { createClient as createSupabaseAdmin } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface Body { userId?: unknown }

export async function POST(req: Request) {
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
    // Already gone — treat as success.
    return NextResponse.json({ ok: true, note: 'not_found' }, { status: 200 })
  }
  const isDemo = target.user.user_metadata?.demo === true
  if (!isDemo) {
    return NextResponse.json(
      { ok: false, error: 'not_a_demo_user' },
      { status: 403 },
    )
  }

  const { error: delErr } = await admin.auth.admin.deleteUser(userId)
  if (delErr) {
    return NextResponse.json(
      { ok: false, error: 'delete_failed', detail: delErr.message },
      { status: 500 },
    )
  }

  return NextResponse.json({ ok: true, deleted: userId })
}
