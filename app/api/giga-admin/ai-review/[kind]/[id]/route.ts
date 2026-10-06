import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireGiga } from '@/lib/admin/giga-actor'
import { recordAdminAction } from '@/lib/admin/audit'
import { apiError, dbError } from '@/lib/api-error'
import type { ReviewKind } from '@/lib/reports/review'
import { reviewAiItem } from '@/lib/admin/staff-actions'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const KINDS = new Set<ReviewKind>(['finding', 'recommendation'])

const Schema = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('approve'), reason: z.string().trim().max(500).optional() }).strict(),
  z.object({ decision: z.literal('dismiss'), reason: z.string().trim().min(3).max(500) }).strict(),
])

/**
 * POST /api/giga-admin/ai-review/:kind/:id { decision: approve | dismiss, reason }
 *   finding         approve → reviewed + visible to the client; dismiss → status 'dismissed'
 *   recommendation  approve → 'accepted' + visible; dismiss → 'rejected'
 * A reason is required to dismiss. The audit entry is written before the change.
 */
export async function POST(req: NextRequest, { params }: { params: { kind: string; id: string } }) {
  const g = await requireGiga(req, 'insights.moderate')
  if (g.response) return g.response
  const kind = params.kind as ReviewKind
  if (!KINDS.has(kind) || !UUID.test(params.id)) return apiError('Элемент не найден', 404)
  const parsed = Schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return apiError('Неверные данные: чтобы отклонить, укажите причину (от 3 символов)', 400)
  const { decision } = parsed.data
  const reason = parsed.data.reason?.trim() || null

  const res = await reviewAiItem({
    kind,
    id: params.id,
    decision,
    reason,
    actorId: g.actor.id,
    audit: (entry, opts) => recordAdminAction(g.actor, entry, req, opts),
  })
  if (!res.ok) {
    switch (res.code) {
      case 'db_load': return dbError('giga-admin/ai-review', res.err, 'Не удалось загрузить элемент')
      case 'db_write': return dbError('giga-admin/ai-review', res.err, 'Не удалось сохранить решение')
      case 'audit_unavailable': return apiError('Журнал аудита недоступен — решение не сохранено', 503)
      case 'not_found': return apiError('Элемент не найден', 404)
      default: return apiError('Решение по этому элементу уже принято', 409)
    }
  }
  return NextResponse.json({ ok: true, item: res.item })
}
