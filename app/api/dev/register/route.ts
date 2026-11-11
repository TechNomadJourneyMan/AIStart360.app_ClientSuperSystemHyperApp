import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { devAccessEnabledForRequest, devNotFound } from '@/lib/dev/dev-access'

type RegisterPayload = {
  email: string
  password: string
  metadata: {
    full_name: string
    role: 'admin' | 'expert' | 'client' | 'super_admin'
    organization?: string
    position?: string
  }
}

const ALLOWED_ROLES = new Set(['admin', 'expert', 'client', 'super_admin'])

// Dev-only backdoor: can mint accounts of ANY role (incl. admin/super_admin),
// so it must be impossible to reach in production. It answers 404 unless
// lib/dev/dev-access.ts allows the request — a non-production build (in a
// production build that guard is the constant `false`), the explicit opt-in
// flag, a local host, no platform variable and a same-origin request. Off by
// default everywhere. See audit A4.

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

function validatePayload(body: unknown): RegisterPayload | null {
  if (!body || typeof body !== 'object') return null

  const input = body as Partial<RegisterPayload>
  if (typeof input.email !== 'string' || typeof input.password !== 'string') {
    return null
  }

  if (!input.metadata || typeof input.metadata !== 'object') {
    return null
  }

  const metadata = input.metadata as RegisterPayload['metadata']
  if (typeof metadata.full_name !== 'string' || typeof metadata.role !== 'string') {
    return null
  }

  if (!ALLOWED_ROLES.has(metadata.role)) {
    return null
  }

  return {
    email: input.email,
    password: input.password,
    metadata: {
      full_name: metadata.full_name,
      role: metadata.role,
      organization: typeof metadata.organization === 'string' ? metadata.organization : undefined,
      position: typeof metadata.position === 'string' ? metadata.position : undefined,
    },
  }
}

export async function POST(request: NextRequest) {
  if (!devAccessEnabledForRequest(request)) return devNotFound()

  try {
    const body = await request.json()
    const payload = validatePayload(body)

    if (!payload) {
      return NextResponse.json({ error: 'INVALID_PAYLOAD' }, { status: 400 })
    }

    const admin = getAdminClient()

    const created = await admin.auth.admin.createUser({
      email: payload.email,
      password: payload.password,
      email_confirm: true,
      user_metadata: payload.metadata,
    })

    if (created.error) {
      return NextResponse.json({ error: created.error.message }, { status: 400 })
    }

    if (!created.data.user) {
      return NextResponse.json({ error: 'USER_CREATE_FAILED' }, { status: 500 })
    }

    const profileUpsert = await admin.from('profiles').upsert(
      {
        id: created.data.user.id,
        full_name: payload.metadata.full_name,
        role: payload.metadata.role,
        organization: payload.metadata.organization,
        position: payload.metadata.position,
      },
      { onConflict: 'id' },
    )

    if (profileUpsert.error && !profileUpsert.error.message.includes("Could not find the table 'public.profiles'")) {
      return NextResponse.json({ error: profileUpsert.error.message }, { status: 400 })
    }

    return NextResponse.json({ ok: true }, { status: 200 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// Any other method: there is no such route (Next.js would answer 405 / 204).
export { devNotFound as GET, devNotFound as PUT, devNotFound as PATCH, devNotFound as DELETE, devNotFound as OPTIONS }
