export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'

function isSuperAdmin(req: NextRequest): boolean {
  return req.cookies.get('aistart360_role')?.value === 'super_admin'
}

/**
 * GET /api/giga-admin/users
 * Returns all platform users from Supabase profiles.
 */
export async function GET(req: NextRequest) {
  if (!isSuperAdmin(req)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const sb = createServerClient()
    const { data: profiles, error } = await sb
      .from('profiles')
      .select('id, email, full_name, role, status, organization, avatar_url, created_at, last_sign_in_at')
      .order('created_at', { ascending: false })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const users = (profiles ?? []).map((p) => ({
      id: p.id,
      name: p.full_name,
      email: p.email,
      role: (p.role ?? 'client').toUpperCase(),
      avatarUrl: p.avatar_url ?? null,
      lastLogin: p.last_sign_in_at ?? null,
      createdAt: p.created_at,
      org: p.organization ?? null,
      status: p.status === 'approved' ? 'active' : p.status === 'blocked' ? 'blocked' : 'pending',
      widgets: [] as string[],
    }))

    return NextResponse.json({ users })
  } catch (error) {
    console.error('[giga-admin/users] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
