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
  if (months === 'bad') return { error: `months must be an integer 1..${MAX_PLAN_MONTHS}` }
  const date = parsePlanDate(body.periodEnd)
  if (date === 'bad') return { error: 'periodEnd must be a date' }
  const periodEnd = date ?? (months ? addMonths(now, months) : null)
  if (periodEnd && periodEnd.getTime() <= now.getTime()) return { error: 'Дата окончания уже прошла' }
  return { periodEnd, months }
}
