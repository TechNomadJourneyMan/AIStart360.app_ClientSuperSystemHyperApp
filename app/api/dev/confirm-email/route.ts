import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { devAccessEnabledForRequest, devNotFound } from '@/lib/dev/dev-access'

// Dev-only: answers 404 unless lib/dev/dev-access.ts allows the request — a
// non-production build (in a production build that guard is the constant
// `false`), the explicit opt-in flag, a local host, no platform variable and
// a same-origin request. Off by default. See audit A4.

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

export async function POST(request: NextRequest) {
  if (!devAccessEnabledForRequest(request)) return devNotFound()

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

// Any other method: there is no such route (Next.js would answer 405 / 204).
export { devNotFound as GET, devNotFound as PUT, devNotFound as PATCH, devNotFound as DELETE, devNotFound as OPTIONS }
