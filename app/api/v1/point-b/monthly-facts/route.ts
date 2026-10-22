export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'
import { gateFeature } from '@/lib/access/gate'
import { activeImpersonation } from '@/lib/impersonation/server'
import { companyOfUser } from '@/lib/point-b/plan/flow'
import { planFactFailure, saveFactsAndRefresh } from '@/lib/point-b/planfact/route'
import { isRateLimitedKey } from '@/lib/rate-limit'
import { createServerClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'

/**
 * PUT /api/v1/point-b/monthly-facts { period: 'YYYY-MM', values: { revenue?, leads?, conversion?, avg_check?, cash? }, note? }
 * — «Факт за месяц» of the monthly reconciliation, entered by the owner (spec §13). Only the KPIs of the APPROVED plan;
 * revenue / average check / cash in ₸, leads per month, conversion in percent; null clears a value. Saved with the
 * source «ежемесячная сверка»; the checkpoints of the company are recalculated right after.
 * The user and the company come from the session only. Refused «от имени» (403: impersonation is read-only).
 * Point B is a PRO feature (402 for a free client while the access gates are on). 400 with the field / profanity,
 * 409 without an approved plan, 429 more often than 20 times an hour, 503 before migration 132.
 *   → { ok, data: { period, saved, cleared, checkpoint: { status, overall, reason } } }
 */
export async function PUT(req: NextRequest) {
  const sb = createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  if (await activeImpersonation(user.id)) {
    return NextResponse.json({ ok: false, error: 'В режиме «от имени» факты пользователя не меняются.' }, { status: 403 })
  }
  const upgrade = await gateFeature(sb, user.id, 'point_b', { exemptStaff: true })
  if (upgrade) return upgrade

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== 'object') return NextResponse.json({ ok: false, error: 'Неверный запрос', code: 'invalid' }, { status: 400 })
  if (await isRateLimitedKey(user.id, 'pb-monthly-facts', { max: 20, windowMs: 3_600_000 })) {
    return NextResponse.json({ ok: false, error: 'Слишком часто — попробуйте позже' }, { status: 429 })
  }

  const service = createServiceClient()
  try {
    const company = await companyOfUser(service, user.id)
    if (!company) return NextResponse.json({ ok: false, error: 'Сначала заполните данные компании', code: 'no_company' }, { status: 409 })
    const r = await saveFactsAndRefresh(service, {
      companyId: company.id, userId: user.id, body: { period: body.period, values: body.values, note: body.note },
      enteredBy: user.id, role: 'owner', now: new Date(),
    })
    return NextResponse.json({ ok: true, data: { period: r.period, saved: r.saved, cleared: r.cleared, checkpoint: { status: r.checkpoint.status, overall: r.checkpoint.overall ?? null, reason: r.checkpoint.reason ?? null } } })
  } catch (err) {
    const failure = planFactFailure(err)
    if (failure) return failure
    console.error('[v1/point-b/monthly-facts]', err instanceof Error ? err.message : err)
    return NextResponse.json({ ok: false, error: 'Не удалось сохранить факт' }, { status: 500 })
  }
}
