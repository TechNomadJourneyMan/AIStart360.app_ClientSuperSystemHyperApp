export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireGiga } from '@/lib/admin/giga-actor'
import { guardClientAccess } from '@/lib/admin/client-scope'
import { createServiceClient } from '@/lib/supabase-service'
import { loadPointBState } from '@/lib/point-b/model/load'
import { profanityResponse } from '@/lib/moderation/http'
import { latestPlanVersionLegacy } from '@/lib/point-b/plan/flow'
import { guarded, planContext, saveLegacyNotes } from '@/lib/point-b/plan/route-guard'

/**
 * GET  /api/giga-admin/users/:id/point-b — Точка Б клиента: R3 (M3) — состояние страницы клиента
 *      (loadPointBState: модель + только одобренная версия плана), в том же конверте, что
 *      GET /api/v1/point-b/state, — персонал видит ровно тот расчёт, что и клиент (не V2);
 *      `version` — последняя версия плана в прежнем формате.
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

/** Последняя версия плана клиента в прежнем формате; null, пока плана нет (или таблицы плана не читаются). */
async function latestVersion(sb: ReturnType<typeof createServiceClient>, userId: string) {
  try {
    return await latestPlanVersionLegacy(sb, userId)
  } catch (err) {
    console.error('[giga/point-b] plan version not read', err instanceof Error ? err.message : err)
    return null
  }
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireGiga(req, ['users.view', 'users.sensitive'])
  if (guard.response) return guard.response
  const scopeDenied = await guardClientAccess(guard.actor, params.id)
  if (scopeDenied) return scopeDenied

  const sb = createServiceClient()
  try {
    const [state, version] = await Promise.all([
      loadPointBState(sb, params.id),
      latestVersion(sb, params.id).catch(() => null),
    ])
    return NextResponse.json({ ok: true, data: state, version })
  } catch (err) {
    console.error('[giga/point-b] state not loaded', err instanceof Error ? err.message : err)
    return NextResponse.json({ ok: false, error: 'Не удалось загрузить данные Точки Б' }, { status: 500 })
  }
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
