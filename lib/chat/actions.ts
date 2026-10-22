/**
 * lib/chat/actions.ts — what the AI chat proposed, decided by the user
 * (public.ai_pending_actions, migration 116).
 *
 * Applying re-checks everything at that moment: the action is the caller's,
 * still pending and not expired, and the caller still manages the company.
 * Then it runs the same code as the UI paths (metric_overrides, the
 * discrepancy resolution, the goals store), emits the event that
 * recalculates Point A and leaves an audit record.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveDiscrepancy, type ResolveChoice } from '@/lib/data-layer/resolve'
import { upsertGoal, type GoalInput } from '@/lib/goals/store'
import { mirrorGoalToSurvey } from '@/lib/goals/survey-sync'
import { loadCompanyMetrics } from '@/lib/metrics/company-metrics'
import { valuePeriod } from '@/lib/goals/current'
import { getMetricById } from '@/lib/metrics/registry'
import { isPlausibleFor } from '@/lib/metrics/resolver'

export type ApplyOutcome =
  | { ok: true; status: 'applied' | 'rejected'; companyId: string; kind: string; event: string | null }
  | { ok: false; status: 400 | 403 | 404 | 409 | 410 | 500; error: string }

interface PendingRow {
  id: string
  user_id: string
  company_id: string
  kind: 'set_value' | 'resolve_discrepancy' | 'set_goal'
  payload: Record<string, unknown>
  status: string
  expires_at: string
}

export async function loadPending(service: SupabaseClient, id: string, userId: string): Promise<PendingRow | null> {
  const { data } = await service.from('ai_pending_actions').select('id, user_id, company_id, kind, payload, status, expires_at').eq('id', id).eq('user_id', userId).maybeSingle()
  return (data as PendingRow | null) ?? null
}

async function finish(service: SupabaseClient, id: string, status: 'applied' | 'expired' | 'failed', result: Record<string, unknown> | null, from: 'pending' | 'applying' = 'applying') {
  await service.from('ai_pending_actions').update({ status, result, decided_at: new Date().toISOString() }).eq('id', id).eq('status', from)
}

/**
 * Moves a still-pending, unexpired action to `to` in one statement: of two
 * parallel «Применить» (double click, two tabs) only one gets the row.
 */
async function claim(service: SupabaseClient, id: string, to: 'applying' | 'rejected'): Promise<boolean> {
  const patch: Record<string, unknown> = { status: to }
  if (to === 'rejected') patch.decided_at = new Date().toISOString()
  const { data, error } = await service.from('ai_pending_actions').update(patch).eq('id', id).eq('status', 'pending').gt('expires_at', new Date().toISOString()).select('id').maybeSingle()
  if (error) throw new Error(error.code ?? 'claim')
  return Boolean(data)
}

/**
 * `canManage` / `expert` come from the caller's tenant resolution for the
 * action's company (done by the route).
 */
export async function decideAction(
  service: SupabaseClient,
  row: PendingRow,
  decision: 'apply' | 'reject',
  actor: { userId: string; canManage: boolean; expert: boolean },
): Promise<ApplyOutcome> {
  if (row.status !== 'pending') return { ok: false, status: 409, error: 'already_decided' }
  if (Date.parse(row.expires_at) < Date.now()) {
    await finish(service, row.id, 'expired', null, 'pending')
    return { ok: false, status: 410, error: 'expired' }
  }
  if (decision === 'reject') {
    if (!(await claim(service, row.id, 'rejected'))) return { ok: false, status: 409, error: 'already_decided' }
    return { ok: true, status: 'rejected', companyId: row.company_id, kind: row.kind, event: null }
  }
  if (!actor.canManage) return { ok: false, status: 403, error: 'forbidden' }
  if (!(await claim(service, row.id, 'applying'))) return { ok: false, status: 409, error: 'already_decided' }

  const p = row.payload
  try {
    if (row.kind === 'set_value') {
      const metric = getMetricById(String(p.metric_id))
      const value = Number(p.value)
      if (!metric || !Number.isFinite(value) || !isPlausibleFor(metric, value)) {
        await finish(service, row.id, 'failed', { error: 'bad_value' })
        return { ok: false, status: 400, error: 'bad_value' }
      }
      const { error } = await service.from('metric_overrides').upsert({
        company_id: row.company_id, metric_key: metric.id, period_key: String(p.period_key), value,
        note: (p.note as string | null) ?? 'Подтверждено в AI-чате', set_by: actor.userId, updated_at: new Date().toISOString(),
      }, { onConflict: 'company_id,metric_key,period_key' })
      if (error) throw new Error(error.code ?? 'override')
      await finish(service, row.id, 'applied', { metric: metric.id, period: p.period_key, value })
      return { ok: true, status: 'applied', companyId: row.company_id, kind: row.kind, event: 'MANUAL_VALUE_SET' }
    }
    if (row.kind === 'resolve_discrepancy') {
      const out = await resolveDiscrepancy(service, row.company_id, String(p.discrepancy_id), p.body as ResolveChoice, { userId: actor.userId, expert: actor.expert })
      if (!out.ok) {
        await finish(service, row.id, 'failed', { error: out.error })
        return { ok: false, status: out.status === 500 ? 500 : 409, error: out.error }
      }
      await finish(service, row.id, 'applied', { status: out.status, value: out.value })
      return { ok: true, status: 'applied', companyId: row.company_id, kind: row.kind, event: 'DISCREPANCY_RESOLVED' }
    }
    // set_goal
    const input = p as unknown as GoalInput
    const metrics = await loadCompanyMetrics(service, row.company_id, [input.metricId])
    const current = metrics.get(input.metricId)
    const goal = await upsertGoal(service, row.company_id, { ...input, source: actor.expert ? 'expert' : 'owner' }, {
      actorId: actor.userId, baseline: { value: current?.value ?? null, period: valuePeriod(current) },
    })
    // A revenue goal (12m / 3y) is also the step-1 answer of the questionnaire (never throws).
    await mirrorGoalToSurvey(service, {
      companyId: row.company_id, metricId: goal.metricId, periodLabel: goal.periodLabel, valueYear: goal.targetValue,
      actor: { id: actor.userId, role: actor.expert ? 'expert' : 'owner' },
    })
    await finish(service, row.id, 'applied', { goal: goal.id })
    return { ok: true, status: 'applied', companyId: row.company_id, kind: row.kind, event: 'TARGET_CHANGED' }
  } catch (err) {
    console.error('[chat/actions] apply failed', row.kind, err instanceof Error ? err.message : err)
    await finish(service, row.id, 'failed', { error: 'apply_failed' })
    return { ok: false, status: 500, error: 'apply_failed' }
  }
}
