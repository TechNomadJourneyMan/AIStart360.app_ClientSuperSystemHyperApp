export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { requireGiga, forbidTarget } from '@/lib/admin/giga-actor'
import { guardClientAccess } from '@/lib/admin/client-scope'
import { createServiceClient } from '@/lib/supabase-service'
import { NOTE_MAX, getEffectivePlan, setPlan } from '@/lib/payments/billing'
import { billingErrorResponse } from '@/lib/payments/billing-http'
import { planPeriodEnd, proAssignment } from '@/lib/payments/plan-period'
import { claimAccessRequest, completePaidAccessGrant, releaseAccessRequest } from '@/lib/access/paid-access-grant'
import { featureLabel, isTariffAccessRequest, OPEN_REQUEST_STATUSES } from '@/lib/access/upgrade-requests'
import { decidesPaidRequests } from '@/lib/admin/rbac'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const invalid = (message: string) => NextResponse.json({ ok: false, error: 'invalid', message }, { status: 422 })

/**
 * POST /api/giga-admin/requests/:id/assign-pro — «Назначить Pro» right in a
 * request for paid access (GIGA «Заявки» → «Доступы»; R2-C, decision of the PO
 * on M-5 / Q7).
 *
 * Body: { periodEnd?: 'YYYY-MM-DD' | ISO, months?: 1..36, note? } — periodEnd
 * wins over months; neither = Pro without an end date (lib/payments/plan-period.ts).
 * Never shortens a live paid plan (review L-5, proAssignment): months are added
 * to the end of the current paid period (atomically in SQL via extendMonths),
 * an open-ended plan stays open-ended (`unchanged`), Enterprise stays
 * Enterprise; an earlier explicit date → 422. The request is CLAIMED (closed
 * while open) before the plan changes: a second concurrent press → 409.
 *
 * The same path and the same rights as User 360 → Биллинг
 * (PATCH /api/giga-admin/users/:id/billing): users.manage, the client scope of
 * the actor (guardClientAccess), the target guard (forbidTarget), setPlan with
 * the journal written BEFORE the change (source 'admin'). Then
 * completePaidAccessGrant: this request (and any other open access request of
 * the client) is closed as approved, and the client gets ONE notice
 * «Доступ открыт» in the feed. Nobody decides on his own request.
 * Only an OPEN request for paid access qualifies (registrations → 404).
 * R4 (WB-9, PO 2026-11-16): requests for paid access are decided by Admin and
 * Super Admin only — a CRM manager (who holds users.manage) gets 403.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireGiga(req, 'users.manage')
  if (guard.response) return guard.response
  const actor = guard.actor
  if (!decidesPaidRequests(actor.role)) {
    return NextResponse.json({ ok: false, error: 'paid_deciders_only', message: 'Заявки на оплату разбирают Admin и Super Admin' }, { status: 403 })
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== 'object') return invalid('body required')
  if (body.note !== undefined && body.note !== null && typeof body.note !== 'string') return invalid('note must be a string')
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, NOTE_MAX) : ''
  const period = planPeriodEnd(body)
  if ('error' in period) return invalid(period.error)

  let svc: ReturnType<typeof createServiceClient>
  try {
    svc = createServiceClient()
  } catch {
    return NextResponse.json({ ok: false, error: 'Сервер не сконфигурирован для этой операции (нет service-role ключа)' }, { status: 500 })
  }

  // admin_requests is Prisma-owned: quoted camelCase columns.
  const { data: row, error } = await svc
    .from('admin_requests')
    .select('id, type, source, status, payload')
    .eq('id', params.id)
    .maybeSingle()
  if (error) return NextResponse.json({ ok: false, error: 'Не удалось прочитать заявку' }, { status: 500 })
  const r = row as { id: string; type?: string | null; source?: string | null; status?: string | null; payload?: Record<string, unknown> | null } | null
  if (!r || !isTariffAccessRequest(r)) {
    return NextResponse.json({ ok: false, error: 'not_found', message: 'Заявка на платный доступ не найдена' }, { status: 404 })
  }
  if (!(OPEN_REQUEST_STATUSES as readonly string[]).includes(String(r.status ?? ''))) {
    return NextResponse.json({ ok: false, error: 'closed', message: 'Заявка уже закрыта' }, { status: 409 })
  }
  const userId = typeof r.payload?.userId === 'string' ? r.payload.userId : ''
  if (!UUID_RE.test(userId)) return NextResponse.json({ ok: false, error: 'not_found', message: 'В заявке нет клиента' }, { status: 404 })
  if (userId === actor.id) return NextResponse.json({ ok: false, error: 'Нельзя назначить тариф по своей заявке' }, { status: 403 })

  // The rights of User 360 → Биллинг: the client in the actor's scope, staff above the actor protected.
  const scoped = await guardClientAccess(actor, userId)
  if (scoped) return scoped
  const denied = await forbidTarget(actor, userId)
  if (denied) return denied

  const features = Array.isArray(r.payload?.features) ? (r.payload.features as unknown[]).filter((f): f is string => typeof f === 'string') : []
  let current: Awaited<ReturnType<typeof getEffectivePlan>>
  try {
    current = await getEffectivePlan({ userId }, svc)
  } catch (e) {
    return billingErrorResponse(e, 'giga-admin/requests/assign-pro')
  }
  const plan = proAssignment(current, { periodEnd: period.periodEnd, months: period.months, explicitDate: body.periodEnd !== undefined && body.periodEnd !== null && body.periodEnd !== '' })
  if ('error' in plan) return invalid(plan.error)

  // Verify (L-5 race): claim the request FIRST — of two concurrent presses one
  // wins, the other gets 409; the plan is assigned / extended once.
  const previousStatus = String(r.status ?? 'new')
  let claimed: boolean
  try {
    claimed = await claimAccessRequest(svc, r.id)
  } catch {
    return NextResponse.json({ ok: false, error: 'Не удалось закрыть заявку' }, { status: 500 })
  }
  if (!claimed) return NextResponse.json({ ok: false, error: 'closed', message: 'Заявка уже закрыта' }, { status: 409 })

  const grantOf = (before: Pick<typeof current, 'accessTier'>, after: Pick<typeof current, 'accessTier' | 'periodEnd'> | null) =>
    completePaidAccessGrant({ userId, actor, before, after, via: 'request', requestId: r.id, claimed: [r.id], ipAddress: req.headers.get('x-forwarded-for') ?? undefined, svc })

  // Already paid and open-ended: nothing to assign — the request is closed honestly (verify Info).
  if (plan.unchanged) {
    const grant = await grantOf(current, current)
    return NextResponse.json({ ok: true, userId, plan: current, unchanged: true, requestClosed: true, extended: false, closedRequests: grant.closed, notified: grant.notified })
  }

  try {
    const result = await setPlan({
      userId,
      tier: plan.tier,
      periodEnd: plan.periodEnd,
      ...(plan.extendMonths ? { extendMonths: plan.extendMonths } : {}),
      source: 'admin',
      actor,
      note: note || `По заявке на доступ${features.length ? `: ${features.map(featureLabel).join(', ')}` : ''}`,
      req,
      meta: { action: 'set', via: 'access_request', request_id: r.id, ...(period.months ? { months: period.months } : {}), ...(plan.extended ? { extended_from: current.periodEnd } : {}) },
    })
    if (!result.applied) {
      await releaseAccessRequest(svc, r.id, previousStatus)
      return NextResponse.json({ ok: false, error: 'not_applied', reason: result.reason ?? null, message: 'Тариф не изменён' }, { status: 409 })
    }
    const grant = await grantOf(result.before, result.after)
    return NextResponse.json({
      ok: true,
      userId,
      plan: result.after,
      requestClosed: grant.closed.includes(r.id),
      extended: plan.extended,
      closedRequests: grant.closed,
      notified: grant.notified,
    })
  } catch (e) {
    await releaseAccessRequest(svc, r.id, previousStatus)
    return billingErrorResponse(e, 'giga-admin/requests/assign-pro')
  }
}
