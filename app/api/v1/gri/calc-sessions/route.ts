export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { validateCalcSession } from '@/lib/gri-calculator/calc-session-validate'

export async function GET() {
  const sb = createServerClient()
  const { data: userData, error: userErr } = await sb.auth.getUser()
  if (userErr || !userData?.user) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const { data, error } = await sb
    .from('gri_calc_sessions')
    .select('*')
    .eq('user_id', userData.user.id)
    .order('created_at', { ascending: false })
    .limit(20)
  if (error) return NextResponse.json({ ok: false, error: 'db_error' }, { status: 500 })
  return NextResponse.json({ ok: true, data: { sessions: data ?? [] } })
}

export async function POST(request: NextRequest) {
  const sb = createServerClient()
  const { data: userData, error: userErr } = await sb.auth.getUser()
  if (userErr || !userData?.user) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 })
  }
  const parsed = validateCalcSession(body)
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 })
  const { data, error } = await sb
    .from('gri_calc_sessions')
    .insert({ user_id: userData.user.id, ...parsed.value })
    .select('*')
    .single()
  if (error || !data) return NextResponse.json({ ok: false, error: 'db_error' }, { status: 500 })
  return NextResponse.json({ ok: true, data: { session: data } })
}
