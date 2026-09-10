export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { isGigaSuperAdmin } from '@/lib/admin/giga-actor'
import { completedStepsFromRows, type SurveyStepRow } from '@/lib/survey/steps'

/**
 * GET /api/giga-admin/users
 * Returns all platform users from Supabase profiles.
 */
export async function GET(req: NextRequest) {
  if (!(await isGigaSuperAdmin(req))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    // Service-role: same reason as /api/giga-admin/clients — the giga cookie
    // has no Supabase session, so profiles' RLS returns [] with the anon client.
    const sb = createServiceClient()
    const { data: profiles, error } = await sb
      .from('profiles')
      .select('id, email, full_name, role, status, organization, avatar_url, created_at, widget_config')
      .order('created_at', { ascending: false })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Get diagnostics for all users
    const { data: diagnostics } = await sb
      .from('diagnostics')
      .select('user_id, overall_score, health_index, stage, finance_score, sales_score, operations_score, marketing_score, strategy_score, calculated_at')
      .order('calculated_at', { ascending: false })

    const diagMap = new Map<string, Record<string, unknown>>()
    for (const d of diagnostics ?? []) {
      if (!diagMap.has(d.user_id)) diagMap.set(d.user_id, d)
    }

    // Get survey completion status. PostgREST caps a response at 1000 rows and
    // survey_answers already holds ~1.5k, so an unpaginated read silently
    // showed 0/12 for most clients. Page through everything.
    const PAGE = 1000
    const surveyStats: SurveyStepRow[] & Array<{ user_id: string }> = []
    for (let from = 0; from < 200_000; from += PAGE) {
      const { data: page, error: pageErr } = await sb
        .from('survey_answers')
        .select('user_id, step, question_key, answer')
        .order('id', { ascending: true })
        .range(from, from + PAGE - 1)
      if (pageErr || !page) break
      surveyStats.push(...(page as Array<SurveyStepRow & { user_id: string }>))
      if (page.length < PAGE) break
    }

    const rowsByUser = new Map<string, SurveyStepRow[]>()
    for (const s of surveyStats) {
      const list = rowsByUser.get(s.user_id) ?? []
      list.push(s)
      rowsByUser.set(s.user_id, list)
    }
    const surveyMap = new Map<string, Set<number>>()
    for (const [uid, list] of rowsByUser) surveyMap.set(uid, new Set(completedStepsFromRows(list)))

    const users = (profiles ?? []).map((p) => {
      const diag = diagMap.get(p.id) as Record<string, unknown> | undefined
      const steps = surveyMap.get(p.id)
      return {
        id: p.id,
        name: p.full_name,
        email: p.email,
        role: (p.role ?? 'client').toUpperCase(),
        avatarUrl: p.avatar_url ?? null,
        lastLogin: null,
        createdAt: p.created_at,
        org: p.organization ?? null,
        status: p.status === 'approved' ? 'active' : p.status === 'blocked' ? 'blocked' : 'pending',
        widgets: (Array.isArray((p as { widget_config?: unknown }).widget_config)
          ? ((p as { widget_config?: string[] }).widget_config as string[])
          : []),
        surveyCompleted: steps ? steps.size >= 12 : false,
        surveySteps: steps ? Array.from(steps).sort((x, y) => x - y) : [],
        diagnostics: diag ? {
          overallScore: diag.overall_score,
          healthIndex: diag.health_index,
          stage: diag.stage,
          calculatedAt: diag.calculated_at,
          blocks: {
            finance: (diag.finance_score as { score?: number } | null)?.score ?? 0,
            sales: (diag.sales_score as { score?: number } | null)?.score ?? 0,
            operations: (diag.operations_score as { score?: number } | null)?.score ?? 0,
            marketing: (diag.marketing_score as { score?: number } | null)?.score ?? 0,
            strategy: (diag.strategy_score as { score?: number } | null)?.score ?? 0,
          },
        } : null,
      }
    })

    return NextResponse.json({ users })
  } catch (error) {
    console.error('[giga-admin/users] Error:', error)
    return NextResponse.json({ users: [] })
  }
}
