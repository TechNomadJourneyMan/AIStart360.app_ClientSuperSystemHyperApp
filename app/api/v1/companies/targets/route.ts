// ============================================================
// GET  /api/v1/companies/targets — return current revenue targets
// PATCH /api/v1/companies/targets — set revenue targets
//
// Body (PATCH): { target_revenue_12m_kzt?: number|null, target_revenue_3y_kzt?: number|null }
// Auth: Supabase session cookie. RLS scopes companies row to the user.
// ============================================================

export const dynamic = 'force-dynamic'

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

interface TargetsBody {
  target_revenue_12m_kzt?: number | null
  target_revenue_3y_kzt?: number | null
}

function unauthorized() {
  return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return unauthorized()

  const { data, error } = await supabase
    .from('companies')
    .select('id, target_revenue_12m_kzt, target_revenue_3y_kzt')
    .eq('user_id', user.id)
    .maybeSingle()

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    data: {
      target_revenue_12m_kzt: data?.target_revenue_12m_kzt != null ? Number(data.target_revenue_12m_kzt) : null,
      target_revenue_3y_kzt: data?.target_revenue_3y_kzt != null ? Number(data.target_revenue_3y_kzt) : null,
      company_id: data?.id ?? null,
    },
  })
}

export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return unauthorized()

  let body: TargetsBody
  try {
    body = await req.json() as TargetsBody
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 })
  }

  const patch: Record<string, number | null> = {}
  if ('target_revenue_12m_kzt' in body) {
    const v = body.target_revenue_12m_kzt
    if (v === null || (typeof v === 'number' && Number.isFinite(v) && v >= 0)) {
      patch.target_revenue_12m_kzt = v
    } else {
      return NextResponse.json({ ok: false, error: 'target_revenue_12m_kzt must be a non-negative number or null' }, { status: 400 })
    }
  }
  if ('target_revenue_3y_kzt' in body) {
    const v = body.target_revenue_3y_kzt
    if (v === null || (typeof v === 'number' && Number.isFinite(v) && v >= 0)) {
      patch.target_revenue_3y_kzt = v
    } else {
      return NextResponse.json({ ok: false, error: 'target_revenue_3y_kzt must be a non-negative number or null' }, { status: 400 })
    }
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: false, error: 'No fields to update' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('companies')
    .update(patch)
    .eq('user_id', user.id)
    .select('id, target_revenue_12m_kzt, target_revenue_3y_kzt')
    .maybeSingle()

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    data: {
      target_revenue_12m_kzt: data?.target_revenue_12m_kzt != null ? Number(data.target_revenue_12m_kzt) : null,
      target_revenue_3y_kzt: data?.target_revenue_3y_kzt != null ? Number(data.target_revenue_3y_kzt) : null,
    },
  })
}
