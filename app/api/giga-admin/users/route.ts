export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { GIGA_COOKIE_NAME, verifyGigaRole } from '@/lib/giga-cookie'

// A2b: verify the HMAC-SIGNED giga cookie, not an unsigned static string.
function isSuperAdmin(req: NextRequest): boolean {
  return verifyGigaRole(req.cookies.get(GIGA_COOKIE_NAME)?.value) === 'super_admin'
}

/**
 * GET /api/giga-admin/users
 * Returns all platform users from Supabase profiles.
 */
export async function GET(req: NextRequest) {
  if (!isSuperAdmin(req)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const sb = createServerClient()
    const { data: profiles, error } = await sb
      .from('profiles')
      .select('id, email, full_name, role, status, organization, avatar_url, created_at')
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

    // Get survey completion status
    const { data: surveyStats } = await sb
      .from('survey_answers')
      .select('user_id, step')

    const surveyMap = new Map<string, Set<number>>()
    for (const s of surveyStats ?? []) {
      if (!surveyMap.has(s.user_id)) surveyMap.set(s.user_id, new Set())
      surveyMap.get(s.user_id)!.add(s.step)
    }

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
        widgets: [] as string[],
        surveyCompleted: steps ? steps.size >= 12 : false,
        surveySteps: steps ? Array.from(steps).sort() : [],
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
