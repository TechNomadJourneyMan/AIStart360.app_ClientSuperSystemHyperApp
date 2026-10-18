export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { gateFeature } from '@/lib/access/gate'
import { activeImpersonation } from '@/lib/impersonation/server'
import { getMetricById } from '@/lib/metrics/registry'
import { respondToCorrection } from '@/lib/point-b/plan/goals'
import { notifyGoalResponded } from '@/lib/point-b/plan/notify'
import { PlanError } from '@/lib/point-b/plan/store'
import { createServerClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'

/**
 * POST /api/v1/point-b/goals/:reviewId/respond { accept: boolean } — the owner answers an expert's
 * proposal to change a goal: accept → the proposed value is written into his goal, otherwise the goal
 * stays and goes back to the expert as «оспорено». The user comes from the session; a review of
 * another company, an unknown id or one that is no longer open is 404 / 409 and nothing is written.
 * Refused «от имени» (an admin must not answer for the owner). Staff are told of the answer.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const Body = z.object({ accept: z.boolean() })

export async function POST(req: NextRequest, { params }: { params: { reviewId: string } }) {
  const sb = createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  if (await activeImpersonation(user.id)) {
    return NextResponse.json({ ok: false, error: 'В режиме «от имени» отвечать на предложения эксперта нельзя.' }, { status: 403 })
  }
  const upgrade = await gateFeature(sb, user.id, 'point_b', { exemptStaff: true })
  if (upgrade) return upgrade

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Неверный запрос' }, { status: 400 })
  if (!UUID.test(params.reviewId)) return NextResponse.json({ ok: false, error: 'Корректировка не найдена' }, { status: 404 })

  const service = createServiceClient()
  try {
    const row = await respondToCorrection(service, { reviewId: params.reviewId, userId: user.id, accept: parsed.data.accept })
    await notifyGoalResponded(service, {
      userId: user.id,
      companyId: row.company_id,
      reviewId: row.id,
      metricLabel: getMetricById(row.metric_key)?.label ?? row.metric_key,
      accepted: parsed.data.accept,
      reviewerId: row.reviewer_id,
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof PlanError) {
      const status = err.code === 'not_found' ? 404 : 409
      return NextResponse.json({ ok: false, error: err.message, code: err.code }, { status })
    }
    console.error('[v1/point-b/goals/respond]', err instanceof Error ? err.message : err)
    return NextResponse.json({ ok: false, error: 'Не удалось отправить ответ' }, { status: 500 })
  }
}
