export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'

// POST /api/v1/onboarding/company — upsert the caller's own company record.
// user_id comes from the session, never the body. See technical-audit A5.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { user_id: _ignored, ...companyData } = body

    const sb = createServerClient()
    const { data: { user } } = await sb.auth.getUser()
    if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
    const user_id = user.id

    // Check if company already exists
    const { data: existing } = await sb
      .from('companies')
      .select('id')
      .eq('user_id', user_id)
      .single()

    let result
    if (existing) {
      const { data, error } = await sb
        .from('companies')
        .update({ ...companyData, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
        .select()
        .single()
      result = { data, error }
    } else {
      const { data, error } = await sb
        .from('companies')
        .insert({ user_id, ...companyData })
        .select()
        .single()
      result = { data, error }
    }

    if (result.error) return NextResponse.json({ ok: false, error: result.error.message }, { status: 500 })

    return NextResponse.json({ ok: true, data: result.data })
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 })
  }
}

// GET /api/v1/onboarding/company — the caller's own company (session user only).
export async function GET(_req: NextRequest) {
  const sb = createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await sb
    .from('companies')
    .select('*')
    .eq('user_id', user.id)
    .single()

  if (error && error.code !== 'PGRST116') {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, data: data ?? null })
}
