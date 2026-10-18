/**
 * lib/point-b/plan/client-view.ts — what the OWNER sees of the plan workflow
 * (GET /api/v1/point-b/plan): the published version only, never a draft or a version in review,
 * and the expert's review of his own goals.
 *
 *   status  'none'       nothing to show (no company, no goals, no diagnostic, no plan)
 *           'preparing'  there is something to plan on (goals, a diagnostic or a version in the
 *                        works) but no approved version yet
 *           'published'  an approved version exists
 *
 * Service-role client, scoped to the company of the session user (the caller passes the session
 * user's id; nothing from the request selects the company).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { expertDisplayName } from '@/lib/expert-review/blocks'
import { loadGoals } from '@/lib/goals/store'
import { getMetricById } from '@/lib/metrics/registry'
import { companyOfUser } from './flow'
import { loadLatestReviews } from './goals'
import { loadPlanBundle } from './store'
import type { GoalReviewStatus, PlanGoalsSnapshot } from './types'

export type ClientPlanStatus = 'none' | 'preparing' | 'published'

export interface ClientPlanGoalReview {
  id: string
  metricKey: string
  metricLabel: string
  status: GoalReviewStatus
  from: number | null
  to: number | null
  reason: string | null
  createdAt: string
}

export interface ClientPlanView {
  status: ClientPlanStatus
  version: { number: number; approvedAt: string; expertNotes: string | null; authorName: string; goals: PlanGoalsSnapshot } | null
  goalReviews: ClientPlanGoalReview[]
}

export const NO_CLIENT_PLAN: ClientPlanView = { status: 'none', version: null, goalReviews: [] }

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export async function loadClientPlanView(sb: SupabaseClient, userId: string): Promise<ClientPlanView> {
  const company = await companyOfUser(sb, userId)
  if (!company) return NO_CLIENT_PLAN

  const [bundle, reviews, goals, diag] = await Promise.all([
    loadPlanBundle(sb, company.id),
    loadLatestReviews(sb, company.id),
    loadGoals(sb, company.id),
    sb.from('diagnostics').select('id').eq('user_id', userId).eq('is_current', true).limit(1),
  ])

  const labelOf = new Map(goals.map((g) => [`${g.metricId}|${g.periodLabel}`, g.label]))
  const goalReviews = [...reviews.values()]
    .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0))
    .map((r): ClientPlanGoalReview => ({
      id: r.id,
      metricKey: r.metric_key,
      metricLabel: getMetricById(r.metric_key)?.label ?? labelOf.get(`${r.metric_key}|${r.period_label}`) ?? r.metric_key,
      status: r.status,
      from: num(r.previous_value),
      to: num(r.proposed_value),
      reason: r.reason,
      createdAt: r.created_at,
    }))

  const published = bundle.published
  if (published) {
    return {
      status: 'published',
      version: {
        number: published.version,
        approvedAt: published.approved_at ?? published.created_at,
        expertNotes: published.expert_notes,
        authorName: expertDisplayName(published.author_name),
        goals: published.goals,
      },
      goalReviews,
    }
  }
  const hasDiagnostic = ((diag.data ?? []) as unknown[]).length > 0
  const preparing = goals.length > 0 || hasDiagnostic || !!bundle.open
  return { status: preparing ? 'preparing' : 'none', version: null, goalReviews }
}
