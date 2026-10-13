export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'
import { isRateLimitedKey } from '@/lib/rate-limit'
import { recordAdminAction } from '@/lib/admin/audit'
import { badRequest, guardPointAExpert } from '@/lib/admin/point-a-expert'
import { buildPointASnapshot } from '@/lib/point-a/snapshot'

/**
 * POST /api/giga-admin/users/:id/point-a/v4/recalculate — «Пересчитать» from
 * the expert's tab: a new Point A snapshot now (trigger 'expert', written even
 * when nothing changed). Never two recalculations of one company at once —
 * a running one answers 409.
 */

const SKIPPED: Record<string, string> = {
  busy: 'Точка А уже пересчитывается — обновите вкладку через минуту',
  no_answers: 'Клиент ещё не ответил на анкету — считать не из чего',
  no_owner: 'У компании нет владельца — расчёт невозможен',
  not_migrated: 'Новая Точка А ещё не включена на платформе',
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await guardPointAExpert(req, params.id, 'write')
  if (g.response) return g.response
  const { actor, companyId } = g
  // Every forced run fans out AI and the diagnostic pipeline: no hammering.
  if (await isRateLimitedKey(actor.id, 'giga-point-a-recalc', { max: 6, windowMs: 60_000 })) {
    return NextResponse.json({ ok: false, error: 'Слишком часто — подождите минуту' }, { status: 429 })
  }

  let out: Awaited<ReturnType<typeof buildPointASnapshot>>
  try {
    out = await buildPointASnapshot(companyId, { trigger: 'expert', reasons: ['expert'], lock: true, force: true })
  } catch (err) {
    console.error('[giga-admin/point-a/recalculate] failed', err instanceof Error ? err.message : err)
    return badRequest('Не удалось пересчитать Точку А', 500)
  }
  if (out.status === 'skipped') return badRequest(SKIPPED[out.reason] ?? 'Пересчёт не выполнен', 409)

  await recordAdminAction(actor, {
    action: 'point_a.recalculated',
    entityType: 'company', entityId: companyId, targetUserId: params.id,
    metadata: { status: out.status, snapshotId: out.snapshotId, overall: out.status === 'written' ? out.v4.overall : null },
  }, req)

  return NextResponse.json({ ok: true, data: { status: out.status, snapshotId: out.snapshotId } })
}
