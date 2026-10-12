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
import { dbError } from '@/lib/api-error'
import { createServiceClient } from '@/lib/supabase-service'
import { syncRevenueGoal } from '@/lib/goals/store'
import { emitPlatformEventSafely } from '@/lib/events/platform'

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
    return dbError('v1/companies/targets', error)
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
    return dbError('v1/companies/targets', error)
  }

  // The goals live in metric_targets (lib/goals/store.ts): mirror the revenue
  // targets there and let Point A / Point B recalculate. A failed mirror is
  // logged — the targets themselves are saved.
  if (data?.id) {
    const companyId = String(data.id)
    try {
      const service = createServiceClient()
      for (const [field, period] of [['target_revenue_12m_kzt', '12m'], ['target_revenue_3y_kzt', '3y']] as const) {
        if (field in patch) await syncRevenueGoal(service, companyId, period, patch[field], user.id)
      }
    } catch (err) {
      console.error('[v1/companies/targets] goal mirror failed', err instanceof Error ? err.message : err)
    }
    emitPlatformEventSafely({
      name: 'TARGET_CHANGED', companyId, subjectType: 'company', subjectId: companyId, actor: `user:${user.id}`,
      payload: { fields: Object.keys(patch) }, dedupeKey: `target_changed:${companyId}:${Date.now()}`,
    })
  }

  return NextResponse.json({
    ok: true,
    data: {
      target_revenue_12m_kzt: data?.target_revenue_12m_kzt != null ? Number(data.target_revenue_12m_kzt) : null,
      target_revenue_3y_kzt: data?.target_revenue_3y_kzt != null ? Number(data.target_revenue_3y_kzt) : null,
    },
  })
}
