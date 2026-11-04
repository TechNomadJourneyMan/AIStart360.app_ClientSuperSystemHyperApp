export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { getSessionUserId } from '@/lib/api-auth'

// GET /api/v1/diagnostics/current — current user's latest diagnostic (auth required)
export async function GET() {
  const userId = await getSessionUserId()
  if (!userId) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const sb = createServerClient()
  const { data, error } = await sb
    .from('diagnostics')
    .select('*')
    .eq('user_id', userId)
    .eq('is_current', true)
    .single()

  if (error && error.code !== 'PGRST116') {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, data: data ?? null })
}
