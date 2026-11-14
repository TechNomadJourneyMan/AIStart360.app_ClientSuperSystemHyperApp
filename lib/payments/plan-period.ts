/**
 * lib/payments/plan-period.ts — the period of a plan a staff member assigns in
 * GIGA, parsed the same way everywhere: User 360 → Биллинг
 * (PATCH /api/giga-admin/users/:id/billing) and «Назначить Pro» from an access
 * request (POST /api/giga-admin/requests/:id/assign-pro, R2-C).
 *
 *   periodEnd 'YYYY-MM-DD' | ISO — wins; a bare date means «through the end of
 *             that day» (UTC);
 *   months    1..36 from now;
 *   neither   — no end date.
 */
import { addMonths } from './billing'
import type { EffectivePlan, PlanTier } from './plan-state'

export const MAX_PLAN_MONTHS = 36

export function parsePlanMonths(v: unknown): number | null | 'bad' {
  if (v === undefined || v === null || v === '') return null
  const n = typeof v === 'string' ? Number(v) : v
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > MAX_PLAN_MONTHS) return 'bad'
  return n
}

export function parsePlanDate(v: unknown): Date | null | 'bad' {
  if (v === undefined || v === null || v === '') return null
  if (typeof v !== 'string') return 'bad'
  // A bare date means «through the end of that day» (UTC).
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T23:59:59.000Z` : v)
  return Number.isNaN(d.getTime()) ? 'bad' : d
}

/** End of a paid period from the request body; an error text (Russian, for the 422) when invalid. */
export function planPeriodEnd(body: { periodEnd?: unknown; months?: unknown }, now: Date = new Date()): { periodEnd: Date | null; months: number | null } | { error: string } {
  const months = parsePlanMonths(body.months)
  if (months === 'bad') return { error: `Срок — целое число месяцев от 1 до ${MAX_PLAN_MONTHS}` }
  const date = parsePlanDate(body.periodEnd)
  if (date === 'bad') return { error: 'Дата окончания указана неверно' }
  const periodEnd = date ?? (months ? addMonths(now, months) : null)
  if (periodEnd && periodEnd.getTime() <= now.getTime()) return { error: 'Дата окончания уже прошла' }
  return { periodEnd, months }
}

/**
 * R2-C (product review L-5): «Назначить Pro» never SHORTENS what the client
 * already has. With a live paid plan (trial, Kaspi, an earlier assignment):
 *   • N months are added from the END of the current paid period (not from today);
 *   • an open-ended paid plan stays open-ended;
 *   • an explicit date earlier than the current end → an error;
 *   • Enterprise stays Enterprise (Pro would be a downgrade).
 * Without a live paid plan — the period as asked (from today).
 */
export function proAssignment(
  current: Pick<EffectivePlan, 'tier' | 'status' | 'periodEnd' | 'accessTier'> | null,
  asked: { periodEnd: Date | null; months: number | null; explicitDate: boolean },
  now: Date = new Date(),
): { tier: PlanTier; periodEnd: Date | null; extended: boolean } | { error: string } {
  const live = !!current && current.accessTier === 'pro' && current.tier !== 'free' && current.status !== 'expired' && current.status !== 'canceled'
  const tier: PlanTier = live && current!.tier === 'enterprise' ? 'enterprise' : 'pro'
  if (!live) return { tier, periodEnd: asked.periodEnd, extended: false }
  const end = current!.periodEnd ? new Date(current!.periodEnd) : null
  if (!end || Number.isNaN(end.getTime())) {
    // open-ended already: any end date would shorten it
    if (asked.explicitDate) return { error: 'У клиента уже бессрочный платный тариф — дата окончания его укоротила бы' }
    return { tier, periodEnd: null, extended: false }
  }
  if (asked.explicitDate) {
    if (asked.periodEnd && asked.periodEnd.getTime() < end.getTime()) {
      return { error: `Оплаченный период клиента идёт до ${end.toISOString().slice(0, 10)} — новая дата его укоротила бы` }
    }
    return { tier, periodEnd: asked.periodEnd, extended: true }
  }
  if (asked.months) {
    const base = end.getTime() > now.getTime() ? end : now
    return { tier, periodEnd: addMonths(base, asked.months), extended: true }
  }
  return { tier, periodEnd: null, extended: false }
}
