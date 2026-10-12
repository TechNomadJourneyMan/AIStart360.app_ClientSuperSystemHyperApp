export const dynamic = 'force-dynamic'

import { DIAGNOSTIC_POINT_A_COLUMNS, pointAFromDiagnosticRow } from '@/lib/point-a/from-row'
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { requireExpert } from '@/lib/expert-auth'
import { calculatePointA } from '@/lib/point-a-engine'
import { calculatePointB } from '@/lib/point-b-engine'
import { safeErrorMessage } from '@/lib/api-error'

/**
 * GET /api/clients/:id/analysis/point-b
 * Calculates Point B for a specific client using Supabase data.
 * Staff-only (expert/admin/super_admin) — reads another user's data by id, so a
 * session role gate is required to prevent cross-tenant IDOR.
 */
export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const viewer = await requireExpert()
  if (!viewer) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  try {
    const sb = createServerClient()

    // Get survey answers
    const { data: surveyRows } = await sb
      .from('survey_answers')
      .select('question_key, answer')
      .eq('user_id', params.id)

    if (!surveyRows?.length) {
      return NextResponse.json({ error: 'No survey data found' }, { status: 400 })
    }

    const answers: Record<string, unknown> = {}
    for (const row of surveyRows) {
      answers[row.question_key] = (row.answer as { value?: unknown })?.value ?? row.answer
    }

    // The client's stored Point A (the score they see), then Point B; the
    // survey-only engine only when no diagnostic exists yet.
    const { data: cur } = await sb
      .from('diagnostics')
      .select(DIAGNOSTIC_POINT_A_COLUMNS)
      .eq('user_id', params.id)
      .eq('is_current', true)
      .maybeSingle()
    const pointA = pointAFromDiagnosticRow(cur as Record<string, unknown> | null) ?? calculatePointA(answers)
    const pointB = calculatePointB(pointA, answers)

    return NextResponse.json(pointB)
  } catch (error: unknown) {
    const msg = safeErrorMessage(error, 'Не удалось загрузить анализ')
    console.error('[point-b-api] Error:', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
