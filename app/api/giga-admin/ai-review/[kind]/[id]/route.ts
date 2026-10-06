import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireGiga } from '@/lib/admin/giga-actor'
import { recordAdminAction } from '@/lib/admin/audit'
import { apiError, dbError } from '@/lib/api-error'
import { reviewItem, reviewItemCompany, type ReviewKind, type ReviewResult } from '@/lib/reports/review'

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

  let target
  try {
    target = await reviewItemCompany(kind, params.id)
  } catch (err) {
    return dbError('giga-admin/ai-review', err as { message?: string; code?: string }, 'Не удалось загрузить элемент')
  }
  if (!target) return apiError('Элемент не найден', 404)

  try {
    await recordAdminAction(g.actor, {
      action: `ai_review.${kind}.${decision}`,
      entityType: kind === 'finding' ? 'diagnostic_finding' : 'diagnostic_recommendation',
      entityId: params.id,
      newValue: { decision, reason },
      metadata: { company_id: target.company_id, title: target.title.slice(0, 300) },
    }, req, { required: true })
  } catch {
    return apiError('Журнал аудита недоступен — решение не сохранено', 503)
  }

  let res: ReviewResult
  try {
    res = await reviewItem({ kind, id: params.id, decision, actorId: g.actor.id })
  } catch (err) {
    return dbError('giga-admin/ai-review', err as { message?: string; code?: string }, 'Не удалось сохранить решение')
  }
  if (!res.ok) {
    return res.reason === 'not_found'
      ? apiError('Элемент не найден', 404)
      : apiError('Решение по этому элементу уже принято', 409)
  }
  return NextResponse.json({ ok: true, item: res })
}
