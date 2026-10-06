export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { forbidTarget, requireGiga } from '@/lib/admin/giga-actor'
import { NOTE_MAX, addMonths, getEffectivePlan, isPlanTier, setPlan, type PlanTier } from '@/lib/payments/billing'
import { billingErrorResponse } from '@/lib/payments/billing-http'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_MONTHS = 36

/** GET /api/giga-admin/users/:id/billing — the client's effective plan (users.view). */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireGiga(req, 'users.view')
  if (guard.response) return guard.response
  if (!UUID_RE.test(params.id)) return NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 })
  try {
    const plan = await getEffectivePlan({ userId: params.id })
    return NextResponse.json({ ok: true, plan })
  } catch (e) {
    return billingErrorResponse(e, 'giga-admin/users/billing GET')
  }
}

function parseMonths(v: unknown): number | null | 'bad' {
  if (v === undefined || v === null || v === '') return null
  const n = typeof v === 'string' ? Number(v) : v
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > MAX_MONTHS) return 'bad'
  return n
}

function parseDate(v: unknown): Date | null | 'bad' {
  if (v === undefined || v === null || v === '') return null
  if (typeof v !== 'string') return 'bad'
  // A bare date means «through the end of that day» (UTC).
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T23:59:59.000Z` : v)
  return Number.isNaN(d.getTime()) ? 'bad' : d
}

const invalid = (message: string) => NextResponse.json({ ok: false, error: 'invalid', message }, { status: 422 })

/**
 * PATCH /api/giga-admin/users/:id/billing — change the client's plan (users.manage).
 *
 * Body, one of:
 *   { action: 'set', tier: 'free'|'pilot'|'pro'|'enterprise',
 *     periodEnd?: 'YYYY-MM-DD' | ISO, months?: 1..36, note? }
 *       periodEnd wins over months; neither = no end date (pro / enterprise);
 *       a trial (pilot) needs one of them.
 *   { action: 'extend', months: 1..36, note? }
 *       free-of-charge extension of the current plan from its end date (or
 *       from today when it has already ended).
 *
 * No payment is taken: the plan is assigned by the administrator (source
 * 'admin'), written to subscriptions + profiles.tier in one transaction and
 * journalled before the write (lib/payments/billing.ts).
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireGiga(req, 'users.manage')
  if (guard.response) return guard.response
  if (!UUID_RE.test(params.id)) return NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 })
  const denied = await forbidTarget(guard.actor, params.id)
  if (denied) return denied

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== 'object') return invalid('body required')
  const action = body.action ?? 'set'
  if (body.note !== undefined && body.note !== null && typeof body.note !== 'string') return invalid('note must be a string')
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, NOTE_MAX) : ''
  const months = parseMonths(body.months)
  if (months === 'bad') return invalid(`months must be an integer 1..${MAX_MONTHS}`)
  const now = new Date()

  try {
    let tier: PlanTier
    let periodEnd: Date | null
    const meta: Record<string, unknown> = { action }

    if (action === 'extend') {
      if (!months) return invalid('months required')
      const current = await getEffectivePlan({ userId: params.id })
      if (current.tier === 'free' || current.status === 'free' || current.status === 'canceled') {
        return invalid('Нечего продлевать: у клиента бесплатный доступ — назначьте тариф')
      }
      if (current.status !== 'expired' && current.periodEnd === null) {
        return invalid('Тариф бессрочный — продление не нужно')
      }
      const end = current.periodEnd ? new Date(current.periodEnd) : now
      tier = current.tier
      periodEnd = addMonths(end > now ? end : now, months)
      meta.months_added = months
      meta.comp = true
    } else if (action === 'set') {
      if (!isPlanTier(body.tier)) return invalid('tier must be free|pilot|pro|enterprise')
      tier = body.tier
      const date = parseDate(body.periodEnd)
      if (date === 'bad') return invalid('periodEnd must be a date')
      if (tier === 'free') {
        periodEnd = null
      } else {
        periodEnd = date ?? (months ? addMonths(now, months) : null)
        if (periodEnd && periodEnd.getTime() <= now.getTime()) return invalid('Дата окончания уже прошла')
        if (tier === 'pilot' && !periodEnd) return invalid('Для пробного периода укажите дату окончания или число месяцев')
      }
      if (months) meta.months = months
    } else {
      return invalid("action must be 'set' or 'extend'")
    }

    const result = await setPlan({
      userId: params.id,
      tier,
      periodEnd,
      source: 'admin',
      actor: guard.actor,
      note: note || null,
      req,
      meta,
    })
    return NextResponse.json({ ok: true, applied: result.applied, plan: result.after ?? result.before })
  } catch (e) {
    return billingErrorResponse(e, 'giga-admin/users/billing PATCH')
  }
}
