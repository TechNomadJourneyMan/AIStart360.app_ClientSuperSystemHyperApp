export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { computeDataConfidence, type TrustSignals } from '@/lib/gri/trust'

/**
 * GET /api/v1/gri/trust → { ok, confidence }  (confidence may be null)
 *
 * "Доверие к данным": how complete the user's data is (B2). Signals gathered
 * from the user's own rows; each read guarded so a missing table degrades to
 * "signal absent" rather than 500. computeDataConfidence returns null when
 * there is too little to honestly assess.
 */
const DAY_MS = 86_400_000

export async function GET(_req: NextRequest) {
  const sb = createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const signals: TrustSignals = {
    surveyCompletion: null,
    hasFinancials: false,
    financialsConsistent: null,
    documentsCount: 0,
    hasCrm: false,
    hasMetrics: false,
    griHistoryCount: 0,
    dataFreshnessDays: null,
    marketConfirmedCount: 0,
  }

  // GRI history count + freshness of the current assessment.
  try {
    const { data, count } = await sb
      .from('gri_assessments')
      .select('created_at, is_current', { count: 'exact' })
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
    const rows = (data ?? []) as Array<{ created_at: string; is_current: boolean }>
    signals.griHistoryCount = count ?? rows.length
    const current = rows.find((r) => r.is_current) ?? rows[0]
    if (current?.created_at) {
      signals.dataFreshnessDays = Math.floor((Date.now() - new Date(current.created_at).getTime()) / DAY_MS)
    }
  } catch { /* skip */ }

  // Financials present? (any revenue answer, current or legacy form)
  try {
    const { count } = await sb
      .from('survey_answers')
      .select('question_key', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .in('question_key', ['s9n_revenue_2024', 's2_revenue_2024', 's2_revenue_2025'])
    signals.hasFinancials = (count ?? 0) > 0
  } catch { /* skip */ }

  // Confirmed market-analysis answers.
  try {
    const { count } = await sb
      .from('market_analysis_answers')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('status', 'confirmed')
    signals.marketConfirmedCount = count ?? 0
  } catch { /* skip */ }

  // CRM integration connected?
  try {
    const { count } = await sb
      .from('crm_integrations')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
    signals.hasCrm = (count ?? 0) > 0
  } catch { /* skip */ }

  const confidence = computeDataConfidence(signals)
  return NextResponse.json({ ok: true, confidence })
}
