import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Dev-only: requires non-prod NODE_ENV AND an explicit opt-in flag, so a
// misconfigured NODE_ENV alone can never open it. Off by default. See audit A4.
function isDevMode() {
  return process.env.NODE_ENV !== 'production' && process.env.ENABLE_DEV_AUTH_ROUTES === '1'
}

function getAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('SUPABASE_ADMIN_CONFIG_MISSING')
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}

function getEmail(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null
  const email = (body as { email?: unknown }).email
  if (typeof email !== 'string' || !email.trim()) return null
  return email.trim().toLowerCase()
}

export async function POST(request: Request) {
  if (!isDevMode()) {
    return NextResponse.json({ error: 'NOT_AVAILABLE' }, { status: 403 })
  }

  try {
    const email = getEmail(await request.json())
    if (!email) {
      return NextResponse.json({ error: 'INVALID_PAYLOAD' }, { status: 400 })
    }

    const admin = getAdminClient()
    const usersRes = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })

    if (usersRes.error) {
      return NextResponse.json({ error: usersRes.error.message }, { status: 400 })
    }

    const matchedUser = usersRes.data.users.find((u) => (u.email ?? '').toLowerCase() === email)
    if (!matchedUser) {
      return NextResponse.json({ error: 'USER_NOT_FOUND' }, { status: 404 })
    }

    const updateRes = await admin.auth.admin.updateUserById(matchedUser.id, {
      email_confirm: true,
    })

    if (updateRes.error) {
      return NextResponse.json({ error: updateRes.error.message }, { status: 400 })
    }

    return NextResponse.json({ ok: true }, { status: 200 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
