// ============================================================
// GET  /api/v1/goals[?companyId=] — the company's goals with their evaluation
//      (gap А→Б, pace, realism, status — lib/goals/evaluate.ts)
// POST /api/v1/goals[?companyId=] — set a goal on any catalog metric
//      Body: { metricId, targetValue, periodLabel ('12m' | '3y' | '2026-Q4' | '2027'),
//              direction?, deadline? (YYYY-MM-DD), label?, note? }
//
// One goal per metric and period (public.metric_targets — the one source of
// goals; revenue goals are mirrored into companies.target_revenue_*). Reads
// with the session (RLS); writes after a manage check with the service role.
// A change emits TARGET_CHANGED → Point A / Point B are recalculated.
// ============================================================
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase-service'
import { resolveTenantWith, tenantErrorMessage } from '@/lib/tenancy'
import { apiError } from '@/lib/api-error'
import { getMetricById } from '@/lib/metrics/registry'
import { loadCompanyMetrics } from '@/lib/metrics/company-metrics'
import { evaluateGoal } from '@/lib/goals/evaluate'
import { loadGoalsWithEvaluation, valuePeriod } from '@/lib/goals/current'
import { upsertGoal } from '@/lib/goals/store'
import { emitPlatformEventSafely } from '@/lib/events/platform'

export const dynamic = 'force-dynamic'

const Body = z.object({
  metricId: z.string().min(3).max(120),
  targetValue: z.number().finite(),
  periodLabel: z.string().trim().regex(/^([1-9]\d{0,2}m|[1-9]\d?y|\d{4}-Q[1-4]|\d{4})$/i),
  direction: z.enum(['higher_is_better', 'lower_is_better', 'range']).optional(),
  deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  label: z.string().trim().max(200).nullable().optional(),
  note: z.string().trim().max(1000).nullable().optional(),
})

type TenantOk = { supabase: Awaited<ReturnType<typeof createClient>>; user: { id: string }; tenant: { companyId: string; role: string } }

async function tenantFor(req: Request, access: 'read' | 'manage'): Promise<TenantOk | { error: NextResponse }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: apiError(tenantErrorMessage('unauthenticated'), 401) }
  const tenant = await resolveTenantWith(supabase, user.id, { companyId: new URL(req.url).searchParams.get('companyId'), access })
  if (!tenant.ok) return { error: apiError(tenantErrorMessage(tenant.error), tenant.status) }
  return { supabase, user, tenant: tenant.tenant }
}

export async function GET(req: Request): Promise<NextResponse> {
  const t = await tenantFor(req, 'read')
  if ('error' in t) return t.error
  try {
    const items = await loadGoalsWithEvaluation(t.supabase, t.tenant.companyId)
    return NextResponse.json({ ok: true, data: { items } })
  } catch (err) {
    console.error('[api/v1/goals] read failed', err instanceof Error ? err.message : err)
    return apiError('Не удалось загрузить цели', 500)
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  const t = await tenantFor(req, 'manage')
  if ('error' in t) return t.error
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return apiError('Неверный запрос', 400)
  const entry = getMetricById(parsed.data.metricId)
  if (!entry) return apiError('Неизвестная метрика', 400)

  const { companyId, role } = t.tenant
  try {
    const service = createServiceClient()
    const metrics = await loadCompanyMetrics(service, companyId, [entry.id])
    const current = metrics.get(entry.id)
    const goal = await upsertGoal(service, companyId, { ...parsed.data, source: role === 'staff' || role === 'partner_expert' ? 'expert' : 'owner' }, {
      actorId: t.user.id,
      baseline: { value: current?.value ?? null, period: valuePeriod(current) },
    })
    emitPlatformEventSafely({
      name: 'TARGET_CHANGED', companyId, subjectType: 'goal', subjectId: goal.id, actor: `user:${t.user.id}`,
      payload: { metric: goal.metricId, target: goal.targetValue, period: goal.periodLabel }, dedupeKey: `target_changed:${goal.id}:${Date.now()}`,
    })
    const evaluation = evaluateGoal(goal, { value: current?.value ?? null, period: valuePeriod(current) }, new Date())
    return NextResponse.json({ ok: true, data: { goal, evaluation } })
  } catch (err) {
    console.error('[api/v1/goals] write failed', err instanceof Error ? err.message : err)
    return apiError('Не удалось сохранить цель', 500)
  }
}
