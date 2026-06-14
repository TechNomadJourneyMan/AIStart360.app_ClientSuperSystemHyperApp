import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'

// Supabase-session admin guard for the /api/v1/admin/* endpoints.
//
// These endpoints use Supabase auth (not NextAuth), so the NextAuth-based
// requireRole() in lib/api-utils.ts does not apply. This guard:
//   1. reads the authenticated user from the session cookie,
//   2. looks up their profiles.role via the service role (own id only — avoids
//      the RLS self-select recursion seen elsewhere on profiles),
//   3. allows only platform admins.
//
// The admin approval UI (/admin) is middleware-gated to role 'admin'; super_admin
// (ГИГА-Панель) is allowed too. See technical-audit A1.

const ADMIN_ROLES = new Set(['admin', 'super_admin'])

export interface AdminGuardOk {
  user: { id: string; email?: string | null }
  role: string
}
export interface AdminGuardErr {
  error: NextResponse
}
export type AdminGuardResult = AdminGuardOk | AdminGuardErr

export async function requireSupabaseAdmin(): Promise<AdminGuardResult> {
  const sb = createServerClient()
  const {
    data: { user },
  } = await sb.auth.getUser()
  if (!user) {
    return { error: NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 }) }
  }

  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '')
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

  let role = ''
  try {
    const res = await fetch(`${url}/rest/v1/profiles?id=eq.${user.id}&select=role`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      cache: 'no-store',
    })
    if (res.ok) {
      const rows = (await res.json()) as Array<{ role?: string }>
      role = rows[0]?.role ?? ''
    }
  } catch (err) {
    console.error('[admin-guard] role lookup failed', err)
  }

  if (!ADMIN_ROLES.has(role)) {
    return { error: NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 }) }
  }

  return { user: { id: user.id, email: user.email }, role }
}
