/**
 * lib/point-b/plan/types.ts — types of the Point B plan workflow (migration 125).
 *
 * A plan (pb_plans) has versions (pb_plan_versions): draft → in_review → approved,
 * the previous approved one becomes superseded. The goals of the owner live in
 * public.metric_targets; a version keeps their SNAPSHOT (PlanGoalsSnapshot) with
 * the verification status of every goal (pb_goal_reviews).
 */

export type PlanVersionStatus = 'draft' | 'in_review' | 'approved' | 'superseded'

/** Status of a goal by its latest review row; no rows = 'owner_draft'. */
export type GoalReviewStatus = 'owner_draft' | 'verified' | 'corrected' | 'agreed' | 'disputed'

/** Status stored in a pb_goal_reviews row. */
export type StoredGoalReviewStatus = Exclude<GoalReviewStatus, 'owner_draft'>

export type PlanAuthorKind = 'owner' | 'expert' | 'admin' | 'system'

export interface PlanGoalItem {
  metricKey: string
  periodLabel: string
  label: string | null
  baselineValue: number | null
  baselinePeriod: string | null
  targetValue: number
  deadline: string | null
  reviewStatus: GoalReviewStatus
  /** The expert's correction was applied after 14 days without the owner's answer (visible in the version). */
  appliedWithoutAgreement?: boolean
  /**
   * When the horizon of the goal started (a label like «12m» counts from here). NOT part of the stored
   * snapshot: lib/point-b/model/load.ts adds it in memory so the model can date the goal exactly.
   */
  baselineAt?: string | null
}

export interface PlanGoalsSnapshot {
  primary: { metricKey: string; periodLabel: string } | null
  items: PlanGoalItem[]
}

export const EMPTY_GOALS_SNAPSHOT: PlanGoalsSnapshot = { primary: null, items: [] }

/** pb_plans row. */
export interface PlanRow {
  id: string
  company_id: string
  user_id: string
  current_version_id: string | null
  published_version_id: string | null
  settings: Record<string, unknown>
  created_at: string
  updated_at: string
}

/** pb_plan_versions row. */
export interface PlanVersionRow {
  id: string
  plan_id: string
  version: number
  status: PlanVersionStatus
  base_snapshot_id: string | null
  goals: PlanGoalsSnapshot
  assumptions: Record<string, unknown>
  scenarios: unknown[]
  selected_scenario: string | null
  strategy: Record<string, unknown>
  risks: unknown[]
  expert_notes: string | null
  change_reason: string | null
  author_id: string | null
  author_name: string | null
  author_kind: PlanAuthorKind
  submitted_at: string | null
  approved_by: string | null
  approved_at: string | null
  approval_exception: string | null
  rejected_by: string | null
  rejected_at: string | null
  rejected_reason: string | null
  created_at: string
}

/** pb_goal_reviews row. */
export interface GoalReviewRow {
  id: string
  company_id: string
  metric_key: string
  period_label: string
  status: StoredGoalReviewStatus
  proposed_value: number | null
  proposed_deadline: string | null
  previous_value: number | null
  reason: string | null
  reviewer_id: string | null
  reviewer_name: string | null
  owner_agreed_at: string | null
  applied_without_agreement: boolean
  reminded_at: string | null
  created_at: string
}
