/**
 * lib/point-b/planfact/batch.ts — the companies a scheduled pass goes through (spec §14) and the monthly
 * reconciliation of one company (spec §13). Service-role client.
 *
 *   listPlanCompanies      companies with a PUBLISHED plan, by company id after a cursor, at most `limit` (one indexed
 *                          read of pb_plans; the next cursor when there are more)
 *   monthlyReconciliation  one company on the 1st of a month: the client is asked for «Факт за месяц» (only with
 *                          Point B and when the month is not filled yet; the client's notification settings decide the
 *                          channels) and the assigned expert gets the task «проверить сверку»
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { hasPointB } from '../invites/access'
import { reconciliationTask, remindReconciliation } from './notify'
import { isMissingTable } from './store'

export const RECOMPUTE_BATCH = 10

export interface PlanCompany { companyId: string; userId: string }

export async function listPlanCompanies(sb: SupabaseClient, input: { after: string | null; limit?: number }): Promise<{ companies: PlanCompany[]; next: string | null }> {
  const limit = Math.max(1, Math.min(input.limit ?? RECOMPUTE_BATCH, RECOMPUTE_BATCH))
  let q = sb.from('pb_plans').select('company_id, user_id').not('published_version_id', 'is', null)
  if (input.after) q = q.gt('company_id', input.after)
  const { data, error } = await q.order('company_id', { ascending: true }).limit(limit + 1)
  if (error) {
    if (isMissingTable(`(${error.code ?? ''})`)) return { companies: [], next: null }
    throw new Error(`point-b plan-fact: list plans failed (${error.code ?? 'unknown'})`)
  }
  const rows = ((data ?? []) as Array<{ company_id: string; user_id: string }>).map((r) => ({ companyId: r.company_id, userId: r.user_id }))
  const page = rows.slice(0, limit)
  return { companies: page, next: rows.length > limit ? page[page.length - 1].companyId : null }
}

export interface ReconciliationOutcome {
  companyId: string
  reminded: boolean
  task: 'created' | 'exists' | 'no_assignee' | 'failed'
  filled: boolean
  skipped?: 'no_point_b'
}

export async function monthlyReconciliation(
  sb: SupabaseClient, input: PlanCompany & { period: string; now: Date },
): Promise<ReconciliationOutcome> {
  let filled = false
  try {
    const { data, error } = await sb.from('pb_monthly_facts').select('metric').eq('company_id', input.companyId).eq('period', input.period).limit(1)
    if (error && !isMissingTable(`(${error.code ?? ''})`)) throw new Error(`read failed (${error.code ?? 'unknown'})`)
    filled = ((data ?? []) as unknown[]).length > 0
  } catch (err) {
    console.error('[point-b/planfact] reconciliation state not read', err instanceof Error ? err.message : err)
  }
  if (!(await hasPointB(sb, input.userId))) return { companyId: input.companyId, reminded: false, task: 'no_assignee', filled, skipped: 'no_point_b' }
  const reminded = filled ? false : await remindReconciliation({ userId: input.userId, period: input.period, now: input.now })
  const dueAt = new Date(input.now.getTime() + 7 * 86_400_000).toISOString()
  const task = await reconciliationTask(sb, { userId: input.userId, period: input.period, dueAt })
  return { companyId: input.companyId, reminded, task, filled }
}
