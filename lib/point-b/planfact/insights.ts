/**
 * lib/point-b/planfact/insights.ts — the invite rules of the plan-fact (spec §12.1): «отклонение факта от плана» and
 * «контрольная точка наступила». Deterministic, pure; the texts are templates, the numbers come from the checkpoint.
 *
 *   plan_deviation   the checkpoint of the last finished month is «отстаём» (priority 2) or «риск» (priority 3);
 *                    one per month and verdict
 *   checkpoint_due   a milestone of the approved strategy whose date came within the last 14 days (priority 3);
 *                    one per milestone
 */
import type { InsightCandidate } from '../insights/rules'
import { POINT_B_HREF } from '../insights/scenario'
import type { Milestone } from '../strategy/types'
import { periodLabel } from './kpis'
import type { Checkpoint } from './types'

export const HISTORY_HREF = `${POINT_B_HREF}?tab=history`
export const MILESTONE_WINDOW_DAYS = 14
const DAY = 86_400_000

export function planFactCandidates(input: { checkpoint: Checkpoint | null; milestones: Milestone[]; now: Date }): InsightCandidate[] {
  const out: InsightCandidate[] = []
  const cp = input.checkpoint
  if (cp && (cp.overall === 'behind' || cp.overall === 'risk')) {
    const behind = cp.overall === 'behind'
    const month = periodLabel(cp.period)
    out.push({
      ruleKey: 'plan_deviation',
      dedupeKey: `plan_deviation:${cp.period}:${cp.overall}`,
      kind: 'insight',
      title: behind ? `Факт за ${month} отстаёт от плана` : `Есть риск отстать от плана (${month})`,
      body: `${cp.reason} Посмотрите план-факт и обсудите с экспертом, что поменять.`,
      href: HISTORY_HREF,
      priority: behind ? 2 : 3,
      display: 'card',
      why: `Факт за ${month} сравнили с планом одобренной версии по ключевым показателям.`,
      sourceRefs: [{ type: 'model', ref: `checkpoint:${cp.period}`, label: `План-факт за ${month}` }],
      expiresInDays: 30,
    })
  }
  // Calendar days (UTC): a milestone of today counts, one of 14 days ago still counts, 15 days ago does not.
  const today = Date.parse(`${input.now.toISOString().slice(0, 10)}T00:00:00Z`)
  for (const m of input.milestones) {
    const at = Date.parse(`${m.date}T00:00:00Z`)
    if (!Number.isFinite(at) || at > today || today - at > MILESTONE_WINDOW_DAYS * DAY) continue
    out.push({
      ruleKey: 'checkpoint_due',
      dedupeKey: `checkpoint_due:${m.key}`,
      kind: 'insight',
      title: `Контрольная точка «${m.title}» наступила`.slice(0, 200),
      body: `${m.kpi ? `Ожидаемый результат: ${m.kpi}. ` : ''}Сверьте результат с планом и внесите факт за месяц.`,
      href: HISTORY_HREF,
      priority: 3,
      display: 'card',
      why: 'Срок контрольной точки из дорожной карты вашего плана.',
      sourceRefs: [{ type: 'model', ref: `milestone:${m.key}`, label: `Контрольная точка «${m.title}»` }],
      expiresInDays: 14,
    })
  }
  return out
}
