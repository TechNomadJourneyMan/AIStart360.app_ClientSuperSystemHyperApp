export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { gateFeature } from '@/lib/access/gate'
import { activeImpersonation } from '@/lib/impersonation/server'
import {
  loadRevenueTable, RevenueHistoryError, saveRevenueHistory, validateRevenueHistory,
} from '@/lib/point-b/finmodel/revenue-history'
import { companyOfUser } from '@/lib/point-b/plan/flow'
import { isRateLimitedKey } from '@/lib/rate-limit'
import { createServerClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'

/**
 * «Выручка по месяцам» of the «Финмодель» tab (R3, M2) — the owner's revenue of the last 24 finished months, BEFORE the
 * plan is approved, so the overview can forecast «при текущем ходе» (12 months in a row are needed).
 *
 * GET → { ok, data: { months: [{ period, revenue, source: 'owner'|'reconciliation'|'data'|null }], run, needed, stale, minMonths } }
 * PUT { months: [{ period: 'YYYY-MM', revenue: number | string | null }] } — null clears a month. Saved to
 *     pb_monthly_facts (metric revenue, source revenue_history): the same history the overview, the recompute and the
 *     plan-fact read. → the table as GET returns it.
 * The user and the company come from the session only. PUT refused «от имени» (403: impersonation is read-only).
 * Point B is a PRO feature (402 for a free client while the access gates are on). 400 with the field, 409 without a
 * company, 429 more often than 20 times an hour, 503 before migrations 132 / 151.
 */
function failure(err: unknown): NextResponse | null {
  if (err instanceof RevenueHistoryError) {
    if (err.code === 'not_ready') return NextResponse.json({ ok: false, error: 'Выручка по месяцам ещё не включена на сервере', code: 'not_ready' }, { status: 503 })
    return NextResponse.json({ ok: false, error: err.message, code: 'invalid', ...(err.field ? { field: err.field } : {}) }, { status: 400 })
  }
  return null
}

const noCompany = (): NextResponse => NextResponse.json({ ok: false, error: 'Сначала заполните данные компании', code: 'no_company' }, { status: 409 })

export async function GET() {
  const sb = createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  const upgrade = await gateFeature(sb, user.id, 'point_b', { exemptStaff: true })
  if (upgrade) return upgrade
  const service = createServiceClient()
  try {
    const company = await companyOfUser(service, user.id)
    if (!company) return noCompany()
    return NextResponse.json({ ok: true, data: await loadRevenueTable(service, company.id, new Date()) })
  } catch (err) {
    const f = failure(err)
    if (f) return f
    console.error('[v1/point-b/revenue-history GET]', err instanceof Error ? err.message : err)
    return NextResponse.json({ ok: false, error: 'Не удалось загрузить выручку по месяцам' }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  const sb = createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  if (await activeImpersonation(user.id)) {
    return NextResponse.json({ ok: false, error: 'В режиме «от имени» данные пользователя не меняются.' }, { status: 403 })
  }
  const upgrade = await gateFeature(sb, user.id, 'point_b', { exemptStaff: true })
  if (upgrade) return upgrade

  const body = await req.json().catch(() => null)
  if (await isRateLimitedKey(user.id, 'pb-revenue-history', { max: 20, windowMs: 3_600_000 })) {
    return NextResponse.json({ ok: false, error: 'Слишком часто — попробуйте позже' }, { status: 429 })
  }
  const service = createServiceClient()
  try {
    const now = new Date()
    const months = validateRevenueHistory(body, now)
    const company = await companyOfUser(service, user.id)
    if (!company) return noCompany()
    await saveRevenueHistory(service, { companyId: company.id, enteredBy: user.id, role: 'owner', months })
    return NextResponse.json({ ok: true, data: await loadRevenueTable(service, company.id, now) })
  } catch (err) {
    const f = failure(err)
    if (f) return f
    console.error('[v1/point-b/revenue-history PUT]', err instanceof Error ? err.message : err)
    return NextResponse.json({ ok: false, error: 'Не удалось сохранить выручку по месяцам' }, { status: 500 })
  }
}
