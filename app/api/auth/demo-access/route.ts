/**
 * POST /api/auth/demo-access
 *
 * Generates a fresh demo account on demand:
 *   1. Creates auth.users row via Supabase admin API (service-role).
 *   2. Profile is auto-created by the on_auth_user_created trigger.
 *   3. Forces profile status='approved' so the demo user skips the
 *      client/waiting-room and lands straight on /client/point-a.
 *
 * Returns { email, password } — the client then signs in normally
 * using useAuthStore.login(email, password), which sets cookies and
 * triggers the role-based redirect inside the login page useEffect.
 */

import { NextResponse } from 'next/server'
import { createClient as createSupabaseAdmin } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const DEMO_PASSWORD_LEN = 16

function randomToken(bytes = 12) {
  const arr = new Uint8Array(bytes)
  crypto.getRandomValues(arr)
  return Array.from(arr, (b) => b.toString(36)).join('').replace(/[^a-z0-9]/g, '').slice(0, bytes * 2)
}

function randomPassword(len = DEMO_PASSWORD_LEN) {
  // Mix of letters, digits, one symbol to satisfy Supabase default password policy.
  const alpha = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ'
  const nums = '23456789'
  const sym = '!@#$%&*'
  const all = alpha + nums + sym
  const arr = new Uint8Array(len)
  crypto.getRandomValues(arr)
  let out = ''
  // Guarantee at least one of each class
  out += alpha[arr[0] % alpha.length]
  out += nums[arr[1] % nums.length]
  out += sym[arr[2] % sym.length]
  for (let i = 3; i < len; i++) out += all[arr[i] % all.length]
  return out
}

export async function POST() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceKey) {
    return NextResponse.json(
      { ok: false, error: 'demo_access_unavailable', detail: 'Supabase admin credentials missing on server' },
      { status: 500 },
    )
  }

  const admin = createSupabaseAdmin(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const token = randomToken(8)
  const email = `demo-${token}@aistart360.app`
  const password = randomPassword()

  // 1) Create the auth user (email_confirm: true so they can immediately sign in).
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: 'Демо · гость',
      role: 'client',
      demo: true,
      created_via: 'demo_access_button',
    },
  })

  if (createErr || !created?.user) {
    return NextResponse.json(
      { ok: false, error: 'create_user_failed', detail: createErr?.message ?? 'unknown' },
      { status: 500 },
    )
  }

  const userId = created.user.id

  // 2) Approve the profile (trigger creates row with status='pending_approval').
  //    Retry a couple of times in case the trigger hasn't fired yet.
  let approved = false
  for (let attempt = 0; attempt < 5; attempt++) {
    const { error: updErr } = await admin
      .from('profiles')
      .update({
        status: 'approved',
        approved_at: new Date().toISOString(),
        full_name: 'Демо · гость',
        organization: 'AIStart360 Demo',
      })
      .eq('id', userId)
    if (!updErr) {
      approved = true
      break
    }
    await new Promise((r) => setTimeout(r, 150))
  }

  if (!approved) {
    // Best-effort: upsert profile directly if the trigger never fired.
    await admin.from('profiles').upsert({
      id: userId,
      email,
      full_name: 'Демо · гость',
      role: 'client',
      status: 'approved',
      organization: 'AIStart360 Demo',
      approved_at: new Date().toISOString(),
    })
  }

  return NextResponse.json(
    {
      ok: true,
      email,
      password,
      userId,
      // Demo users land directly in the onboarding flow ("что за бизнес"
      // questionnaire + document upload) instead of the empty /client/point-a
      // dashboard placeholder.
      redirect: '/client/onboarding',
      message: 'Demo account ready. Use these credentials to sign in.',
    },
    { status: 200 },
  )
}
