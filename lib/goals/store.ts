/**
 * lib/goals/store.ts — goals of a company in public.metric_targets (085, 112).
 *
 * The one source of goals. The revenue goals («12m», «3y» on
 * biz.finansy.vyruchka_god) are mirrored into companies.target_revenue_12m_kzt
 * / _3y_kzt, which older readers (Point B, the dashboard hero, step 1 of the
 * questionnaire) still use — both ways: a goal written here updates the
 * column, PATCH /api/v1/companies/targets updates the goal.
 *
 * Writes need the service role (metric_targets has no write policy for API
 * roles); callers authorise the company first.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { getMetricById } from '@/lib/metrics/registry'
import type { Goal, GoalDirection } from './evaluate'

export const REVENUE_GOAL_METRIC = 'biz.finansy.vyruchka_god'
const REVENUE_COLUMN: Readonly<Record<string, 'target_revenue_12m_kzt' | 'target_revenue_3y_kzt'>> = {
  '12m': 'target_revenue_12m_kzt',
  '3y': 'target_revenue_3y_kzt',
}

function missingTable(e: { code?: string } | null | undefined): boolean {
  return !!e && (e.code === '42P01' || e.code === 'PGRST205')
}
function missingColumn(e: { code?: string } | null | undefined): boolean {
  return !!e && (e.code === 'PGRST204' || e.code === '42703')
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function defaultLabel(metricId: string, periodLabel: string): string {
  const label = getMetricById(metricId)?.label ?? metricId
  const horizon = periodLabel === '12m' ? 'через 12 месяцев' : periodLabel === '3y' ? 'через 3 года' : `к ${periodLabel}`
  return `${label} ${horizon}`
}

export function goalFromRow(r: Record<string, unknown>): Goal {
  const metricId = String(r.metric_key)
  const periodLabel = String(r.period_label ?? '12m')
  return {
    id: String(r.id),
    metricId,
    label: (r.label as string | null) || defaultLabel(metricId, periodLabel),
    unit: getMetricById(metricId)?.unit ?? '',
    targetValue: Number(r.target_value),
    direction: (['higher_is_better', 'lower_is_better', 'range'].includes(String(r.direction)) ? r.direction : 'higher_is_better') as GoalDirection,
    periodLabel,
    deadline: (r.deadline as string | null) ?? null,
    baselineValue: num(r.baseline_value),
    baselinePeriod: (r.baseline_period as string | null) ?? null,
    source: (['owner', 'expert', 'agent', 'survey'].includes(String(r.source)) ? r.source : 'owner') as Goal['source'],
    note: (r.note as string | null) ?? null,
    createdAt: (r.created_at as string | null) ?? null,
  }
}

/** Goals of the company; the revenue columns of companies fill in a goal metric_targets does not have yet. */
export async function loadGoals(client: SupabaseClient, companyId: string): Promise<Goal[]> {
  const [targets, company] = await Promise.all([
    client.from('metric_targets').select('*').eq('company_id', companyId).order('created_at', { ascending: true }),
    client.from('companies').select('target_revenue_12m_kzt, target_revenue_3y_kzt, created_at').eq('id', companyId).maybeSingle(),
  ])
  if (targets.error && !missingTable(targets.error)) throw new Error(`goals: read failed (${targets.error.code ?? 'unknown'})`)
  if (company.error) throw new Error(`goals: company read failed (${company.error.code ?? 'unknown'})`)
  const goals = ((targets.error ? [] : targets.data ?? []) as Array<Record<string, unknown>>).map(goalFromRow).filter((g) => Number.isFinite(g.targetValue))
  for (const [period, column] of Object.entries(REVENUE_COLUMN)) {
    const v = num((company.data as Record<string, unknown> | null)?.[column])
    if (v === null || v <= 0) continue
    if (goals.some((g) => g.metricId === REVENUE_GOAL_METRIC && g.periodLabel === period)) continue
    goals.push(goalFromRow({
      id: `company-${period}`, metric_key: REVENUE_GOAL_METRIC, target_value: v, direction: 'higher_is_better', period_label: period,
      source: 'survey', created_at: (company.data as Record<string, unknown> | null)?.created_at ?? null,
    }))
  }
  return goals
}

export interface GoalInput {
  metricId: string
  targetValue: number
  periodLabel: string
  direction?: GoalDirection
  deadline?: string | null
  label?: string | null
  note?: string | null
  source?: Goal['source']
}

/** Write a goal (one per metric and period). The baseline is the metric's current value. */
export async function upsertGoal(
  service: SupabaseClient,
  companyId: string,
  input: GoalInput,
  opts: { actorId: string; baseline?: { value: number | null; period: string | null } },
): Promise<Goal> {
  if (!getMetricById(input.metricId)) throw new Error('goals: unknown metric')
  const row: Record<string, unknown> = {
    company_id: companyId,
    metric_key: input.metricId,
    target_value: input.targetValue,
    direction: input.direction ?? 'higher_is_better',
    period_label: input.periodLabel,
    source: input.source ?? 'owner',
    set_by: opts.actorId,
    note: input.note ?? null,
    updated_at: new Date().toISOString(),
  }
  const extended: Record<string, unknown> = {
    ...row,
    deadline: input.deadline ?? null,
    label: input.label ?? null,
    updated_by: opts.actorId,
    ...(opts.baseline ? { baseline_value: opts.baseline.value, baseline_period: opts.baseline.period } : {}),
  }
  let res = await service.from('metric_targets').upsert(extended, { onConflict: 'company_id,metric_key,period_label' }).select('*').single()
  // Before migration 112: the goal without deadline / baseline / label.
  if (res.error && missingColumn(res.error)) {
    res = await service.from('metric_targets').upsert(row, { onConflict: 'company_id,metric_key,period_label' }).select('*').single()
  }
  if (res.error || !res.data) throw new Error(`goals: write failed (${res.error?.code ?? 'unknown'})`)
  await syncRevenueColumn(service, companyId, input.metricId, input.periodLabel, input.targetValue)
  return goalFromRow(res.data as Record<string, unknown>)
}

export async function deleteGoal(service: SupabaseClient, companyId: string, goalId: string): Promise<boolean> {
  if (goalId.startsWith('company-')) {
    const period = goalId.slice('company-'.length)
    if (!REVENUE_COLUMN[period]) return false
    await syncRevenueColumn(service, companyId, REVENUE_GOAL_METRIC, period, null)
    return true
  }
  const { data, error } = await service.from('metric_targets').delete().eq('company_id', companyId).eq('id', goalId).select('metric_key, period_label')
  if (error) throw new Error(`goals: delete failed (${error.code ?? 'unknown'})`)
  const row = ((data ?? []) as Array<{ metric_key: string; period_label: string }>)[0]
  if (!row) return false
  await syncRevenueColumn(service, companyId, row.metric_key, row.period_label, null)
  return true
}

/** Mirror a revenue goal into companies.target_revenue_*. */
export async function syncRevenueColumn(service: SupabaseClient, companyId: string, metricId: string, periodLabel: string, value: number | null): Promise<void> {
  const column = metricId === REVENUE_GOAL_METRIC ? REVENUE_COLUMN[periodLabel] : undefined
  if (!column) return
  const { error } = await service.from('companies').update({ [column]: value }).eq('id', companyId)
  if (error) throw new Error(`goals: company revenue target not synced (${error.code ?? 'unknown'})`)
}

/** Mirror the other way: a revenue column written by PATCH /companies/targets becomes the goal. */
export async function syncRevenueGoal(service: SupabaseClient, companyId: string, periodLabel: '12m' | '3y', value: number | null, actorId: string): Promise<void> {
  if (value === null || value <= 0) {
    const { error } = await service.from('metric_targets').delete().eq('company_id', companyId).eq('metric_key', REVENUE_GOAL_METRIC).eq('period_label', periodLabel)
    if (error && !missingTable(error)) throw new Error(`goals: revenue goal not removed (${error.code ?? 'unknown'})`)
    return
  }
  const { error } = await service.from('metric_targets').upsert(
    { company_id: companyId, metric_key: REVENUE_GOAL_METRIC, target_value: value, direction: 'higher_is_better', period_label: periodLabel, source: 'owner', set_by: actorId, updated_at: new Date().toISOString() },
    { onConflict: 'company_id,metric_key,period_label' },
  )
  if (error && !missingTable(error)) throw new Error(`goals: revenue goal not synced (${error.code ?? 'unknown'})`)
}
