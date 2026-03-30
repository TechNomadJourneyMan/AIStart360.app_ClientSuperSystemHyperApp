export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'

// GET /api/v1/diagnostics/current?user_id=xxx
export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('user_id')
  if (!userId) return NextResponse.json({ ok: false, error: 'user_id required' }, { status: 400 })

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
