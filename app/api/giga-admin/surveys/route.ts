export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { requireGiga } from '@/lib/admin/giga-actor'
import { createServiceClient } from '@/lib/supabase-service'
import { SURVEY_TOTAL_STEPS } from '@/lib/survey/steps'
import { hasPermission } from '@/lib/admin/rbac'

// GET /api/giga-admin/surveys — questionnaire analytics: completion
// distribution, which steps are filled least, recent edits (who/when).
export async function GET(req: NextRequest) {
  const guard = await requireGiga(req, 'survey.view')
  if (guard.response) return guard.response
  const sb = createServiceClient()
  const [stepsRes, rowsRes, historyRes] = await Promise.all([
    sb.rpc('admin_survey_steps'),
    sb.rpc('admin_survey_step_users'),
    sb.from('survey_answer_history').select('id, user_id, question_key, source, changed_by, updated_at').order('updated_at', { ascending: false }).limit(20),
  ])
  if (stepsRes.error) return NextResponse.json({ ok: false, error: 'Не удалось загрузить анкеты' }, { status: 500 })

  const perUser = (stepsRes.data ?? []) as Array<{ user_id: string; steps: number; first_at: string; last_at: string }>
  const distribution = Array.from({ length: SURVEY_TOTAL_STEPS + 1 }, (_, n) => ({ steps: n, users: perUser.filter((u) => u.steps === n).length }))
  // Aggregated in SQL: a row-level select would be capped at 1000 rows by PostgREST.
  const stepUsers = new Map(((rowsRes.data ?? []) as Array<{ step: number; users: number }>).map((r) => [Number(r.step), Number(r.users)]))
  const perStep = Array.from({ length: SURVEY_TOTAL_STEPS }, (_, i) => ({ step: i + 1, users: stepUsers.get(i + 1) ?? 0 }))

  const { count: clients } = await sb.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'client')
  const sensitive = hasPermission(guard.actor.role, 'users.sensitive')
  const history = sensitive ? historyRes.data ?? [] : []
  const ids = Array.from(new Set(history.flatMap((h) => [h.user_id, h.changed_by]).filter((v): v is string => !!v && /^[0-9a-f-]{36}$/i.test(v))))
  const { data: people } = ids.length
    ? await sb.from('profiles').select('id, email, full_name, organization').in('id', ids)
    : { data: [] as Array<{ id: string; email: string; full_name: string | null; organization: string | null }> }
  const byId = new Map((people ?? []).map((p) => [p.id, p.full_name || p.organization || p.email]))
  // A profile can be gone (deleted account, test fixture): show a short
  // readable marker instead of a raw UUID.
  const label = (id: string | null | undefined) => (id ? byId.get(id) ?? `Пользователь ${id.slice(0, 8)}` : null)

  return NextResponse.json({
    ok: true,
    data: {
      clients: clients ?? 0,
      started: perUser.filter((u) => u.steps > 0).length,
      completed: perUser.filter((u) => u.steps >= SURVEY_TOTAL_STEPS).length,
      avgSteps: perUser.length ? Math.round((perUser.reduce((a, u) => a + u.steps, 0) / perUser.length) * 10) / 10 : 0,
      distribution,
      perStep,
      recentEdits: history.map((h) => ({ ...h, user_label: label(h.user_id), actor_label: label(h.changed_by) })),
    },
  })
}
