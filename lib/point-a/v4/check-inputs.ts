/**
 * lib/point-a/v4/check-inputs.ts — was a check of Point A answered at all?
 *
 * v1 scores an unanswered question as 0 («тихий ноль»): a yes/no toggle
 * that was never touched reads as «нет», an empty budget as 0 %. v4 separates
 * «answered badly» from «not answered»:
 *
 *   • a check with `missing` set is not answered;
 *   • a check listed below is answered when one of its keys was answered —
 *     or, for a form toggle (`toggle`), when the owner saved the step it is
 *     on (an untouched toggle on a saved step is a deliberate «нет»);
 *   • any other check is answered when it earned points or found an issue.
 */
import { present, type PointACheck, type PointAResolvedInputs } from '@/lib/point-a-engine'
import { stepForQuestionKey } from '@/lib/survey/steps'
import type { BlockKey } from './config'

interface CheckInput {
  keys: readonly string[]
  /**
   * Number fields the form writes as 0 when cleared (`Number(v) || 0`): only
   * a positive number is an answer.
   */
  positive?: readonly string[]
  /** Form toggle / slider with a default: a saved step counts as an answer. */
  toggle?: boolean
  resolved?: ReadonlyArray<keyof PointAResolvedInputs>
}

const GOAL_3Y = ['s6_goal_3years', 's2n_goal_3y_what', 's2n_goal_3y_metrics', 's1_goal_3y_revenue_year', 's1_goal_3y_revenue_month']
const GOAL_12M = ['s6_goal_12months', 's2n_goal_12m_what', 's2n_goal_12m_metrics', 's1_goal_12m_revenue_year', 's1_goal_12m_revenue_month']

export const CHECK_INPUTS: Partial<Record<BlockKey, Record<string, CheckInput>>> = {
  sales: {
    loyalty: { keys: ['s3_has_loyalty'] },
  },
  finance: {
    breakeven: { keys: ['s2_knows_breakeven', 's9n_breakeven_point'] },
    revenue_trend: { keys: [] },
  },
  operations: {
    org_chart: { keys: ['s4_has_org_chart'], toggle: true },
    dept_kpi: { keys: ['s4_has_dept_kpi', 's4n_staffing_table', 's4m_control_method'], toggle: true },
    meetings: { keys: ['s4_has_regular_meetings'], toggle: true },
    reporting: { keys: ['s4_reporting_tool', 's4m_report_automated'] },
    task_manager: { keys: ['s4_task_manager', 's12_project_mgmt'] },
  },
  marketing: {
    budget: { keys: ['s5_marketing_budget_pct'], positive: ['s5_marketing_budget_pct'] },
    channels: { keys: ['s5_marketing_channels', 's3_promo_channels'] },
    audience: { keys: ['s5_target_audience', 's3n_client_portrait'] },
    competitors: { keys: ['s5_has_competitor_analysis', 's7n_competitor_1_analysis', 's7n_competitor_2_analysis', 's7n_competitor_3_analysis'], toggle: true },
    usp: { keys: ['s5_usp', 's3n_competitor_why_us'] },
    loyalty: { keys: ['s3_has_loyalty'] },
  },
  strategy: {
    goal_3y: { keys: GOAL_3Y, positive: GOAL_3Y.filter((k) => k.startsWith('s1_')) },
    goal_12m: { keys: GOAL_12M, positive: GOAL_12M.filter((k) => k.startsWith('s1_')) },
    main_pain: { keys: ['s6_main_pain'] },
    growth_blockers: { keys: ['s6_growth_blockers', 's2n_what_blocks_growth'] },
  },
}

/** Steps (1..12) the owner saved at least one answer of. */
export function answeredSteps(answers: Record<string, unknown>): Set<number> {
  const steps = new Set<number>()
  for (const [k, v] of Object.entries(answers)) {
    if (!present(v)) continue
    const s = stepForQuestionKey(k)
    if (s !== null) steps.add(s)
  }
  return steps
}

export function isAnswered(
  block: BlockKey,
  check: PointACheck,
  answers: Record<string, unknown>,
  steps: ReadonlySet<number>,
  resolved: PointAResolvedInputs = {},
): boolean {
  if (check.excluded) return false
  if (check.missing) return false
  const input = CHECK_INPUTS[block]?.[check.id]
  if (!input) return check.earned > 0 || Boolean(check.issue)
  if (input.resolved?.some((k) => resolved[k] !== null && resolved[k] !== undefined)) return true
  const positive = new Set(input.positive ?? [])
  const answered = (k: string) => {
    if (!present(answers[k])) return false
    if (!positive.has(k)) return true
    const n = Number(answers[k])
    return !Number.isFinite(n) || n > 0
  }
  if (input.keys.some(answered)) return true
  if (input.toggle) return input.keys.some((k) => {
    const s = stepForQuestionKey(k)
    return s !== null && steps.has(s)
  })
  // revenue_trend and the like: answered when the check found something.
  return input.keys.length === 0 && (check.earned > 0 || Boolean(check.issue))
}

export { CHECK_LABELS } from './check-labels'
