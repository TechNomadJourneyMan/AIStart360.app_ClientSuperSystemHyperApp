/**
 * GET /api/v1/admin/ai/budget
 *
 * Returns today's AI spend vs. configured daily limit. Admin-only.
 * Powers the admin-dashboard budget widget + warning banner when
 * utilization > 90%.
 */

export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'

import { createServerClient } from '@/lib/supabase-server'
import { getBudgetState } from '@/lib/ai/budget'

export async function GET() {
  const sb = createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user?.id) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const { data: profile } = await sb
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()
  if (!profile || !['admin', 'super_admin'].includes(profile.role)) {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
  }

  try {
    const state = await getBudgetState()
    return NextResponse.json({ ok: true, data: state })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
