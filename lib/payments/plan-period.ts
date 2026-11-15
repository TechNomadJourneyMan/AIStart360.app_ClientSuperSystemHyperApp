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
 * R2-C (product review L-5, verify): «Назначить Pro» never SHORTENS what the
 * client already has, and never adds a period twice. With a live paid plan
 * (trial, Kaspi, an earlier assignment):
 *   • a paid period with an end (active / past due) + N months → `extendMonths`:
 *     the SQL of billing_set_plan adds the months to the end of the live period
 *     under the row locks (two concurrent presses cannot read the same end);
 *   • a trial with an end + N months → N months from the trial's end;
 *   • an open-ended paid plan, or no period asked on a live plan → `unchanged`
 *     (nothing to assign: the plan is already paid and open-ended);
 *   • an explicit date earlier than the current end → an error;
 *   • Enterprise stays Enterprise (Pro would be a downgrade).
 * Without a live paid plan — the period as asked (from today).
 */
export type ProAssignment =
  | { tier: PlanTier; periodEnd: Date | null; extendMonths: number | null; extended: boolean; unchanged: false }
  | { tier: PlanTier; unchanged: true; extended: false }

export function proAssignment(
  current: Pick<EffectivePlan, 'tier' | 'status' | 'periodEnd' | 'accessTier'> | null,
  asked: { periodEnd: Date | null; months: number | null; explicitDate: boolean },
  now: Date = new Date(),
): ProAssignment | { error: string } {
  const live = !!current && current.accessTier === 'pro' && current.tier !== 'free' && current.status !== 'expired' && current.status !== 'canceled'
  const tier: PlanTier = live && current!.tier === 'enterprise' ? 'enterprise' : 'pro'
  if (!live) return { tier, periodEnd: asked.periodEnd, extendMonths: null, extended: false, unchanged: false }
  const end = current!.periodEnd ? new Date(current!.periodEnd) : null
  if (!end || Number.isNaN(end.getTime())) {
    // open-ended already: any end date would shorten it, «N months» changes nothing
    if (asked.explicitDate) return { error: 'У клиента уже бессрочный платный тариф — дата окончания его укоротила бы' }
    return { tier: current!.tier === 'enterprise' ? 'enterprise' : (current!.tier as PlanTier), unchanged: true, extended: false }
  }
  if (asked.explicitDate) {
    if (asked.periodEnd && asked.periodEnd.getTime() < end.getTime()) {
      return { error: `Оплаченный период клиента идёт до ${ruDay(end)} — новая дата его укоротила бы` }
    }
    return { tier, periodEnd: asked.periodEnd, extendMonths: null, extended: true, unchanged: false }
  }
  if (asked.months) {
    if (current!.status === 'trialing') {
      const base = end.getTime() > now.getTime() ? end : now
      return { tier, periodEnd: addMonths(base, asked.months), extendMonths: null, extended: true, unchanged: false }
    }
    return { tier, periodEnd: null, extendMonths: asked.months, extended: true, unchanged: false }
  }
  // no period asked on a live plan with an end → open-ended (longer, never shorter)
  return { tier, periodEnd: null, extendMonths: null, extended: false, unchanged: false }
}

function ruDay(d: Date): string {
  return new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' }).format(d)
}
