export const dynamic = 'force-dynamic'

import { getOfficialPointA, pointAFromOfficial } from '@/lib/point-a/official'
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { requireExpert } from '@/lib/expert-auth'
import { calculatePointB } from '@/lib/point-b-engine'
import { safeErrorMessage } from '@/lib/api-error'
import { unwrapAnswer } from '@/lib/survey/answer-value'

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
      answers[row.question_key] = unwrapAnswer(row.answer)
    }

    // The client's OFFICIAL Point A (R-033), then Point B. No official score →
    // an honest answer, never a v1 recalculation of an incomplete survey (I2).
    const official = await getOfficialPointA(sb, params.id)
    const scored = pointAFromOfficial(official)
    if (!scored) {
      return NextResponse.json(
        { error: 'Точка Б строится после оценки Точки А: клиент ещё не отправил полную анкету или данных мало для общего балла', state: official.state },
        { status: 409 },
      )
    }
    const pointB = { ...calculatePointB(scored.pointA, answers, { blocksWithoutData: scored.blocksWithoutData }), blocks_without_data: scored.blocksWithoutData }

    return NextResponse.json(pointB)
  } catch (error: unknown) {
    const msg = safeErrorMessage(error, 'Не удалось загрузить анализ')
    console.error('[point-b-api] Error:', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
