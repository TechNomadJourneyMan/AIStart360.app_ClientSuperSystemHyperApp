export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'

/**
 * POST /api/v1/diagnostics/point-b/current-revenue
 * Body: { revenue_year: number }
 *
 * Lets the owner supply/confirm current annual revenue directly from the
 * Point B page when the survey did not capture it. Stored as a survey answer
 * (s1_current_revenue_year/_month) for the SESSION user — the Point B engine
 * reads these keys with top priority. No cross-tenant write (user from session).
 */
export async function POST(req: NextRequest) {
  const sb = createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const year = Number(body?.revenue_year)
  if (!Number.isFinite(year) || year <= 0) {
    return NextResponse.json({ ok: false, error: 'revenue_year must be a positive number' }, { status: 400 })
  }
  const month = Math.round(year / 12)

  // Reuse the diagnostic's company_id for scoping consistency, if present.
  const { data: diag } = await sb
    .from('diagnostics')
    .select('company_id')
    .eq('user_id', user.id)
    .eq('is_current', true)
    .maybeSingle()
  const companyId = (diag?.company_id as string | null) ?? null

  const rows = [
    { user_id: user.id, company_id: companyId, step: 1, question_key: 's1_current_revenue_year', answer: { value: year } },
    { user_id: user.id, company_id: companyId, step: 1, question_key: 's1_current_revenue_month', answer: { value: month } },
  ]

  const { error } = await sb
    .from('survey_answers')
    .upsert(rows, { onConflict: 'user_id,question_key' })

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true, data: { revenue_year: year, revenue_month: month } })
}
