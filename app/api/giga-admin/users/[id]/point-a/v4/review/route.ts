export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { recordAdminAction } from '@/lib/admin/audit'
import { badRequest, guardPointAExpert, staffDisplayName } from '@/lib/admin/point-a-expert'

/**
 * POST /api/giga-admin/users/:id/point-a/v4/review — «Отметить как
 * проверенное»: the latest snapshot of the company gets the expert's name and
 * the time. The client sees «Проверено экспертом {имя}, {дата}»; after the
 * next recalculation the badge turns into «Проверено ранее, есть изменения».
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await guardPointAExpert(req, params.id, 'write')
  if (g.response) return g.response
  const { actor, sb, companyId } = g

  const latest = await sb.from('point_a_snapshots').select('id, overall').eq('company_id', companyId).order('created_at', { ascending: false }).limit(1)
  if (latest.error) return badRequest('Не удалось прочитать Точку А', 500)
  const snap = ((latest.data ?? []) as Array<{ id: string; overall: number | null }>)[0]
  if (!snap) return badRequest('Точка А ещё не рассчитана — проверять нечего', 409)

  const name = await staffDisplayName(sb, actor)
  const at = new Date().toISOString()
  const { error } = await sb
    .from('point_a_snapshots')
    .update({ reviewed_by: actor.id, reviewed_by_name: name, reviewed_at: at })
    .eq('id', snap.id)
    .eq('company_id', companyId)
  if (error) {
    console.error('[giga-admin/point-a/review] update failed', error.code ?? '')
    return badRequest('Не удалось отметить Точку А как проверенную', 500)
  }

  await recordAdminAction(actor, {
    action: 'point_a.reviewed',
    entityType: 'company', entityId: companyId, targetUserId: params.id,
    metadata: { snapshotId: snap.id, overall: snap.overall },
  }, req)

  return NextResponse.json({ ok: true, data: { snapshotId: snap.id, by: name, at } })
}
