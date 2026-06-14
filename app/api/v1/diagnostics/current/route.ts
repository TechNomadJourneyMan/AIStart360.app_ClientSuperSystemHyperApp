export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'

// GET /api/v1/diagnostics/current
// The user is taken from the authenticated session — never from the query —
// so one user can't read another's diagnostics. RLS scopes the row too; we
// enforce ownership at the handler as defense in depth. See technical-audit A5.
export async function GET(_req: NextRequest) {
  const sb = createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await sb
    .from('diagnostics')
    .select('*')
    .eq('user_id', user.id)
    .eq('is_current', true)
    .single()

  if (error && error.code !== 'PGRST116') {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, data: data ?? null })
}
