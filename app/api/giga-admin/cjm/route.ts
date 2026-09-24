export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { requireGiga } from '@/lib/admin/giga-actor'
import { createServiceClient } from '@/lib/supabase-service'
import { buildJourney, JOURNEY_STAGES, type JourneyStageKey } from '@/lib/admin/journey'
import { hasPermission } from '@/lib/admin/rbac'
import { maskEmail } from '@/lib/admin/mask'
import { isSurveyCompleted } from '@/lib/survey/completion'

// GET /api/giga-admin/cjm?stage=&page=&stalledDays=14
// Funnel with conversions, where people stop, and who is stuck at a stage.
const PAGE = 25

interface Row {
  user_id: string; registered_at: string | null; approved_at: string | null; survey_started_at: string | null
  survey_steps: number; survey_updated_at: string | null
  /** Единое определение «анкета заполнена» (lib/survey/completion.ts, миграция 090). */
  survey_completed_at?: string | null
  point_a_at: string | null; gri_started_at: string | null
  gri_completed_at: string | null; point_b_at: string | null; content_viewed_at: string | null; last_seen_at: string | null
}

export async function GET(req: NextRequest) {
  const guard = await requireGiga(req, 'cjm.view')
  if (guard.response) return guard.response
  const sp = req.nextUrl.searchParams
  const stageFilter = sp.get('stage') as JourneyStageKey | null
  const page = Math.max(1, Number(sp.get('page')) || 1)
  const stalledDays = Math.min(180, Math.max(1, Number(sp.get('stalledDays')) || 14))

  const sb = createServiceClient()
  const { data, error } = await sb.rpc('admin_journey_stages')
  if (error) return NextResponse.json({ ok: false, error: 'Не удалось построить CJM' }, { status: 500 })
  const rows = (data ?? []) as Row[]

  const now = Date.now()
  const journeys = rows.map((r) => ({
    userId: r.user_id,
    lastSeenAt: r.last_seen_at,
    journey: buildJourney({
      registered: r.registered_at,
      approved: r.approved_at,
      survey_started: r.survey_started_at,
      survey_completed: r.survey_completed_at !== undefined
        ? r.survey_completed_at ?? null
        // До применения 090 у RPC нет колонки — старое правило как фолбэк.
        : isSurveyCompleted({ filledSteps: r.survey_steps }) ? r.survey_updated_at : null,
      point_a: r.point_a_at,
      gri_started: r.gri_started_at,
      gri_completed: r.gri_completed_at,
      point_b: r.point_b_at,
      content: r.content_viewed_at,
    }, now),
  }))

  const funnel = JOURNEY_STAGES.map((s) => ({
    key: s.key,
    label: s.label,
    count: journeys.filter((j) => j.journey.stages.find((x) => x.key === s.key)?.done).length,
    current: journeys.filter((j) => j.journey.current?.key === s.key).length,
  }))
  const stalled = journeys.filter((j) => j.journey.next && (j.journey.daysInStage ?? 0) >= stalledDays)
  const dropOff = JOURNEY_STAGES.map((s) => ({
    key: s.key,
    label: s.label,
    stalled: stalled.filter((j) => j.journey.current?.key === s.key).length,
  }))

  let list = stageFilter ? journeys.filter((j) => j.journey.current?.key === stageFilter) : stalled
  list = list.sort((a, b) => (b.journey.daysInStage ?? 0) - (a.journey.daysInStage ?? 0))
  const pageRows = list.slice((page - 1) * PAGE, page * PAGE)
  const ids = pageRows.map((j) => j.userId)
  const { data: people } = ids.length
    ? await sb.from('profiles').select('id, email, full_name, organization').in('id', ids)
    : { data: [] as Array<{ id: string; email: string; full_name: string | null; organization: string | null }> }
  const sensitive = hasPermission(guard.actor.role, 'users.sensitive')
  const byId = new Map((people ?? []).map((p) => [p.id, { ...p, email: sensitive ? p.email : maskEmail(p.email) }]))

  return NextResponse.json({
    ok: true,
    data: {
      total: journeys.length,
      funnel,
      dropOff,
      stalledDays,
      stalledTotal: stalled.length,
      list: pageRows.map((j) => ({
        user: byId.get(j.userId) ?? { id: j.userId },
        current: j.journey.current,
        next: j.journey.next,
        completed: j.journey.completed,
        daysInStage: j.journey.daysInStage,
        lastSeenAt: j.lastSeenAt,
      })),
      listTotal: list.length,
      page,
      pageSize: PAGE,
    },
  })
}
