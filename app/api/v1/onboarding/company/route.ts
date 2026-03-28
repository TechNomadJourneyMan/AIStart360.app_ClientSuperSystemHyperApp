export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'

// POST /api/v1/onboarding/company — upsert company record
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { user_id, ...companyData } = body

    if (!user_id) return NextResponse.json({ ok: false, error: 'user_id required' }, { status: 400 })

    const sb = createServerClient()

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

// GET /api/v1/onboarding/company?user_id=xxx
export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('user_id')
  if (!userId) return NextResponse.json({ ok: false, error: 'user_id required' }, { status: 400 })

  const sb = createServerClient()
  const { data, error } = await sb
    .from('companies')
    .select('*')
    .eq('user_id', userId)
    .single()

  if (error && error.code !== 'PGRST116') {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, data: data ?? null })
}
