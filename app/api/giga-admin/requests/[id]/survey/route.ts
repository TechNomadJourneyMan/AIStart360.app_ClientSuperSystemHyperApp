export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'

function isSuperAdmin(req: NextRequest): boolean {
  return req.cookies.get('aistart360_role')?.value === 'super_admin'
}

/**
 * GET /api/giga-admin/requests/[id]/survey
 * Returns onboarding survey answers and company data.
 * Resolves userId from admin_requests or treats id as profile UUID.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!isSuperAdmin(req)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const sb = createServerClient()

    // Resolve userId: try admin_requests first, then treat id as profile id
    let userId: string | null = null
    const { data: arRow } = await sb
      .from('admin_requests')
      .select('payload')
      .eq('id', params.id)
      .maybeSingle()

    if (arRow) {
      userId = (arRow.payload as Record<string, string>)?.userId ?? null
    } else {
      userId = params.id
    }

    if (!userId) {
      return NextResponse.json({ ok: true, data: { answers: {}, company: null, completedSteps: [] } })
    }

    // Fetch survey answers
    const { data: surveyRows } = await sb
      .from('survey_answers')
      .select('question_key, answer, step')
      .eq('user_id', userId)
      .order('step', { ascending: true })

    // Fetch company data
    const { data: company } = await sb
      .from('companies')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle()

    // Transform
    const answers: Record<string, unknown> = {}
    const completedSteps = new Set<number>()

    if (surveyRows) {
      for (const row of surveyRows) {
        const val = (row.answer as Record<string, unknown>)?.value ?? row.answer
        answers[row.question_key] = val
        completedSteps.add(row.step)
      }
    }

    return NextResponse.json({
      ok: true,
      data: {
        answers,
        company,
        completedSteps: Array.from(completedSteps).sort(),
      },
    })
  } catch (error) {
    console.error('[giga-admin/requests/[id]/survey] GET error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
