export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireGiga } from '@/lib/admin/giga-actor'
import { guardClientAccess } from '@/lib/admin/client-scope'
import { createServiceClient } from '@/lib/supabase-service'
import { loadPointBInputs } from '@/lib/point-b/inputs'
import { computePointB } from '@/lib/point-b/compute'
import { profanityResponse } from '@/lib/moderation/http'
import { latestPlanVersionLegacy } from '@/lib/point-b/plan/flow'
import { guarded, planContext, saveLegacyNotes } from '@/lib/point-b/plan/route-guard'

/**
 * GET  /api/giga-admin/users/:id/point-b — Точка Б клиента (тот же расчёт, что
 *      видит клиент) + последняя экспертная корректировка.
 * POST /api/giga-admin/users/:id/point-b { expert_notes, change_reason? } —
 *      сохранить корректировку (право clients.review, только для клиентов).
 *
 * Расчёт не сохраняется: хранением Точки Б владеет кабинет клиента.
 * Корректировка пишется ВЕРСИЕЙ ПЛАНА (lib/point-b/plan, единый путь записи) и сразу
 * уходит на одобрение: клиент увидит её после одобрения Admin / Super Admin
 * (…/point-b/plan/versions/:versionId/approve), единственного пути публикации.
 * Старая таблица point_b_versions больше не пишется; поле roadmap не принимается.
 */

const bodySchema = z.object({
  expert_notes: z.string().trim().min(1, 'Введите текст корректировки').max(8000, 'Слишком длинный текст'),
  change_reason: z.string().trim().max(1000, 'Не больше 1000 символов').nullable().optional(),
})

/** Последняя версия плана клиента в прежнем формате; прежняя строка point_b_versions, пока плана нет. */
async function latestVersion(sb: ReturnType<typeof createServiceClient>, userId: string, diagnosticId: string) {
  try {
    const latest = await latestPlanVersionLegacy(sb, userId)
    if (latest) return latest
  } catch (err) {
    console.error('[giga/point-b] plan version not read, using the legacy one', err instanceof Error ? err.message : err)
  }
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
  let inputs
  try {
    inputs = await loadPointBInputs(sb, params.id)
  } catch (err) {
    console.error('[giga/point-b] inputs not loaded', err instanceof Error ? err.message : err)
    return NextResponse.json({ ok: false, error: 'Не удалось загрузить данные Точки Б' }, { status: 500 })
  }
  // The same inputs and computation as the client's own page (lib/point-b).
  const pointB = computePointB(inputs)
  if (!pointB || !inputs.diagnostic) return NextResponse.json({ ok: true, data: { pointB: null, reason: 'no_diagnostic', version: null } })

  return NextResponse.json({ ok: true, data: { pointB, reason: null, version: await latestVersion(sb, params.id, String(inputs.diagnostic.id)) } })
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  return guarded('giga/point-b POST', async () => {
    const guard = await requireGiga(req, ['users.view', 'users.sensitive', 'clients.review'])
    if (guard.response) return guard.response
    const scopeDenied = await guardClientAccess(guard.actor, params.id, { clientOnly: true })
    if (scopeDenied) return scopeDenied

    const parsed = bodySchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message ?? 'Неверный запрос' }, { status: 400 })
    const profane = profanityResponse({ expert_notes: parsed.data.expert_notes, change_reason: parsed.data.change_reason })
    if (profane) return profane

    // Клиент видит подпись: имя эксперта, а не его рабочий email (planContext берёт отображаемое имя).
    const ctx = await planContext(guard.actor, params.id)
    return saveLegacyNotes(req, ctx, { notes: parsed.data.expert_notes, changeReason: parsed.data.change_reason })
  })
}
