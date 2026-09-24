export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireGiga } from '@/lib/admin/giga-actor'
import { guardClientAccess } from '@/lib/admin/client-scope'
import { recordAdminAction } from '@/lib/admin/audit'
import { createServiceClient } from '@/lib/supabase-service'
import { calculatePointBV2 } from '@/lib/point-b/engine'
import { diagToPointA, mapGriTop5 } from '@/lib/admin/expert-client-data'

/**
 * GET  /api/giga-admin/users/:id/point-b — Точка Б клиента (тот же расчёт, что
 *      видит клиент) + последняя экспертная корректировка.
 * POST /api/giga-admin/users/:id/point-b { expert_notes, roadmap? } —
 *      сохранить корректировку (право clients.review, только для клиентов).
 *
 * Расчёт не сохраняется: хранением Точки Б владеет кабинет клиента. Порядок
 * публикации корректировки (черновик → одобрение) — зона пакета 1b; пока
 * поведение прежнее, как в старом портале эксперта: корректировка сразу видна
 * клиенту.
 */

const bodySchema = z.object({
  expert_notes: z.string().trim().min(1, 'Введите текст корректировки').max(8000, 'Слишком длинный текст'),
  roadmap: z.unknown().optional(),
})

async function currentDiagnostic(sb: ReturnType<typeof createServiceClient>, userId: string) {
  const { data } = await sb.from('diagnostics').select('*').eq('user_id', userId).eq('is_current', true).order('calculated_at', { ascending: false }).limit(1)
  return ((data ?? [])[0] ?? null) as Record<string, unknown> | null
}

async function latestVersion(sb: ReturnType<typeof createServiceClient>, diagnosticId: string) {
  const { data } = await sb
    .from('point_b_versions')
    .select('id, expert_notes, author_name, is_approved, created_at')
    .eq('diagnostic_id', diagnosticId)
    .order('created_at', { ascending: false })
    .limit(1)
  return (data ?? [])[0] ?? null
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireGiga(req, ['users.view', 'users.sensitive'])
  if (guard.response) return guard.response
  const scopeDenied = await guardClientAccess(guard.actor, params.id)
  if (scopeDenied) return scopeDenied

  const sb = createServiceClient()
  const diag = await currentDiagnostic(sb, params.id)
  if (!diag) return NextResponse.json({ ok: true, data: { pointB: null, reason: 'no_diagnostic', version: null } })

  const [answersRes, griRes, companyRes] = await Promise.all([
    sb.from('survey_answers').select('question_key, answer').eq('user_id', params.id),
    sb.from('gri_assessments').select('top_5_limits').eq('user_id', params.id).eq('is_current', true).limit(1),
    sb.from('companies').select('id, target_revenue_12m_kzt, target_revenue_3y_kzt').eq('user_id', params.id).maybeSingle(),
  ])

  const answers: Record<string, unknown> = {}
  for (const row of (answersRes.data ?? []) as Array<{ question_key: string; answer: unknown }>) {
    const a = row.answer
    answers[row.question_key] = a && typeof a === 'object' && 'value' in a ? (a as { value?: unknown }).value : a
  }

  let currentRevenueYear: number | null = null
  const companyId = (diag.company_id as string | null) ?? null
  if (companyId) {
    const { data: rev } = await sb
      .from('metrics')
      .select('metric_value')
      .eq('company_id', companyId)
      .eq('metric_key', 'revenue')
      .gt('metric_value', 0)
      .order('period_year', { ascending: false })
      .limit(1)
    const v = (rev ?? [])[0]?.metric_value
    if (v != null && Number.isFinite(Number(v))) currentRevenueYear = Number(v)
  }
  const comp = companyRes.data as { target_revenue_12m_kzt?: number | null; target_revenue_3y_kzt?: number | null } | null
  const goal = (v: unknown) => (v != null && Number.isFinite(Number(v)) ? Number(v) : null)

  const pointB = calculatePointBV2(diagToPointA(diag), answers, {
    diagnosticId: String(diag.id),
    griTop5: mapGriTop5(((griRes.data ?? [])[0] as { top_5_limits?: unknown } | undefined)?.top_5_limits),
    currentRevenueYear,
    goal12mYear: goal(comp?.target_revenue_12m_kzt),
    goal3yYear: goal(comp?.target_revenue_3y_kzt),
  })

  return NextResponse.json({ ok: true, data: { pointB, reason: null, version: await latestVersion(sb, String(diag.id)) } })
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireGiga(req, ['users.view', 'users.sensitive', 'clients.review'])
  if (guard.response) return guard.response
  const scopeDenied = await guardClientAccess(guard.actor, params.id, { clientOnly: true })
  if (scopeDenied) return scopeDenied

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message ?? 'Неверный запрос' }, { status: 400 })

  const sb = createServiceClient()
  const diag = await currentDiagnostic(sb, params.id)
  if (!diag) return NextResponse.json({ ok: false, error: 'У клиента ещё нет Точки А — корректировать нечего' }, { status: 400 })

  // Клиент видит подпись: имя эксперта, а не его рабочий email.
  const { data: me } = await sb.from('profiles').select('full_name').eq('id', guard.actor.id).maybeSingle()
  const authorName = (me as { full_name?: string | null } | null)?.full_name?.trim() || 'Эксперт AIStart360'

  const { data, error } = await sb
    .from('point_b_versions')
    .insert({
      diagnostic_id: String(diag.id),
      authored_by: guard.actor.id,
      author_name: authorName,
      expert_notes: parsed.data.expert_notes,
      roadmap: parsed.data.roadmap ?? null,
      is_approved: true,
    })
    .select('id, expert_notes, author_name, is_approved, created_at')
    .maybeSingle()
  if (error) return NextResponse.json({ ok: false, error: 'Не удалось сохранить корректировку' }, { status: 500 })

  await recordAdminAction(guard.actor, {
    action: 'expert.point_b_version_created',
    entityType: 'user', entityId: params.id, targetUserId: params.id,
    metadata: { versionId: (data as { id?: string } | null)?.id ?? null, preview: parsed.data.expert_notes.slice(0, 120) },
  }, req)

  return NextResponse.json({ ok: true, data })
}
