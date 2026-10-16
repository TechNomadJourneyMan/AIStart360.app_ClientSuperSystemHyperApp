export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { recordAdminAction } from '@/lib/admin/audit'
import { badRequest, guardPointAExpert, zodMessage } from '@/lib/admin/point-a-expert'
import { getMetricById } from '@/lib/metrics/registry'
import { isPlausibleFor } from '@/lib/metrics/resolver'
import { parsePeriodKey } from '@/lib/data-layer/period-key'
import { emitPlatformEventSafely } from '@/lib/events/platform'
import { profanityResponse } from '@/lib/moderation/http'

/**
 * POST /api/giga-admin/users/:id/point-a/v4/value { metricId, period, value, note? }
 *
 * The expert corrects a fact: the value becomes the manual value of that
 * period (public.metric_overrides — source «вручную», set_by = the expert),
 * which wins over the survey and documents. MANUAL_VALUE_SET recalculates
 * Point A.
 */

const Body = z.object({
  metricId: z.string().trim().min(3).max(120),
  period: z.string().trim().min(4).max(10),
  value: z.number({ invalid_type_error: 'Значение — число' }).finite('Значение — число'),
  note: z.string().trim().max(500, 'Комментарий длиннее 500 символов').optional(),
})

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await guardPointAExpert(req, params.id, 'write')
  if (g.response) return g.response
  const { actor, sb, companyId } = g

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return badRequest(zodMessage(parsed.error.issues))
  const profane = profanityResponse({ note: parsed.data.note })
  if (profane) return profane
  const { metricId, period, value } = parsed.data
  const metric = getMetricById(metricId)
  if (!metric) return badRequest('Неизвестная метрика')
  if (!parsePeriodKey(period)) return badRequest('Неверный период: 2025, 2025-Q3 или 2025-09')
  if (!isPlausibleFor(metric, value)) return badRequest('Значение вне допустимого диапазона для этой метрики')

  const prev = await sb.from('metric_overrides').select('value, note').eq('company_id', companyId).eq('metric_key', metric.id).eq('period_key', period).maybeSingle()
  const note = parsed.data.note || 'Исправлено экспертом'
  const { error } = await sb.from('metric_overrides').upsert({
    company_id: companyId, metric_key: metric.id, period_key: period, value,
    note, set_by: actor.id, updated_at: new Date().toISOString(),
    // A plain expert value: no longer the answer to an old discrepancy.
    discrepancy_id: null, basis_signature: null,
  }, { onConflict: 'company_id,metric_key,period_key' })
  if (error) {
    console.error('[giga-admin/point-a/value] upsert failed', error.code ?? '')
    return badRequest('Не удалось сохранить значение', 500)
  }

  await recordAdminAction(actor, {
    action: 'point_a.value_set',
    entityType: 'company', entityId: companyId, targetUserId: params.id,
    oldValue: prev.error ? null : prev.data ?? null,
    newValue: { metricId: metric.id, period, value, note },
  }, req)

  emitPlatformEventSafely({
    name: 'MANUAL_VALUE_SET', companyId, subjectType: 'metric', subjectId: metric.id, actor: `giga:${actor.id}`,
    payload: { metric: metric.id, period, value, via: 'giga_point_a' },
  })

  return NextResponse.json({ ok: true, data: { metricId: metric.id, period, value } })
}
