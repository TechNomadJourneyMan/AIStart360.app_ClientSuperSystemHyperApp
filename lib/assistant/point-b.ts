/**
 * lib/assistant/point-b.ts — the Точка Б slice of the assistant snapshot (R3-PB review M3): the smart assistant and
 * the mascot Гри read Point B from the SAME calculation as «Обзор» — the model and the APPROVED plan version
 * (lib/point-b/report.ts, the compatibility layer of the PDF / share / chat) — never the old V2 engine. Only the data
 * changes: the shape of AssistantPointB, the prompts and the mascot's look and behaviour stay as they were.
 *
 * How the fields are filled (no number is invented):
 *   gap                multiplier, required CAGR — the model's gap; the monthly growth is that CAGR per month;
 *                      data_complete — the model has a goal and a base (level ≥ 1)
 *   realism            the verdict the client sees on «Обзор»: on_track → realistic, at_risk → ambitious,
 *                      behind → aggressive, no_data → unknown; an APPROVED plan whose chosen pace cannot reach the goal
 *                      → unrealistic. No score is made up (null); the rationale is the verdict's reason
 *   data_sufficiency   sufficient = level ≥ 1; confidence = level / 2 (0, 0.5, 1); missing — the model's list;
 *                      have — what the model has (goal, base, monthly history, funnel, money)
 *   levers             only of the APPROVED plan's pace (current → target) — automatic scenarios are not shown before
 *                      the approval (решение PO), so before it there are none
 *   top5_limits        the GRI TOP-5 (the same assessment the snapshot carries)
 * Weak blocks are the official Point A blocks below 50 (data, not a guess).
 */
import { fmtMoney, fmtNum, fmtPct } from '@/lib/point-b/model/format'
import type { PointBReport } from '@/lib/point-b/report'
import type { AssistantGri, AssistantPointB } from './types'

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)

const REALISM: Record<PointBReport['verdict']['key'], string> = {
  on_track: 'realistic',
  at_risk: 'ambitious',
  behind: 'aggressive',
  no_data: 'unknown',
}

function leverValue(lever: string, v: number | null): string {
  if (!finite(v)) return '—'
  if (lever === 'leads') return `${fmtNum(v)} в месяц`
  if (lever === 'avgCheck') return fmtMoney(v)
  return fmtPct(v, 1)
}

export interface AssistantPointBExtras {
  /** companies.target_revenue_12m / 3y_kzt — the goals the model's goals store keeps in sync (migration 130). */
  goal12m: number | null
  goal3y: number | null
  griTop5: AssistantGri['top_5_limits']
  /** Official Point A blocks (label, score) — the weak ones are named. */
  blocks: Array<{ label: string; score: number | null }>
}

export function assistantPointBFrom(r: PointBReport, x: AssistantPointBExtras): AssistantPointB {
  const cagr = r.gap.requiredCagrPct
  const mom = finite(cagr) ? ((1 + cagr / 100) ** (1 / 12) - 1) * 100 : null
  const selected = r.plan.status === 'published' ? r.plan.scenarios.find((s) => s.selected) ?? null : null
  const level = selected && !selected.feasible ? 'unrealistic' : r.level < 1 ? 'unknown' : REALISM[r.verdict.key]
  const have = [
    ...(finite(r.gap.targetAnnual) ? ['Цель по выручке'] : []),
    ...(finite(r.gap.baseAnnual) ? ['Текущая выручка'] : []),
    ...(r.forecast.basis === 'history' ? ['Выручка по месяцам (12 подряд)'] : []),
    ...(r.kind === 'funnel' ? ['Воронка продаж'] : []),
    ...(r.level === 2 ? ['Финмодель'] : []),
  ]
  return {
    has_goal: finite(r.gap.targetAnnual) || finite(x.goal12m) || finite(x.goal3y),
    current_revenue_year: r.gap.baseAnnual,
    goal_12m_revenue_year: x.goal12m,
    goal_3y_revenue_year: x.goal3y,
    gap: {
      multiplier: r.gap.multiplier,
      required_cagr: finite(cagr) ? cagr : null,
      required_mom_growth: finite(mom) ? Math.round(mom * 100) / 100 : null,
      data_complete: r.level >= 1 && finite(r.gap.baseAnnual) && finite(r.gap.targetAnnual),
    },
    realism: {
      level,
      score: null,
      rationale: [
        `${r.verdict.headline}. ${r.verdict.reason}`.trim(),
        ...(selected && !selected.feasible && selected.infeasibleReason ? [`Темп плана «${selected.label}» не достигает цели: ${selected.infeasibleReason}`] : []),
      ],
      weak_blocks: x.blocks.filter((b) => finite(b.score) && b.score < 50).map((b) => b.label),
    },
    data_sufficiency: {
      sufficient: r.level >= 1,
      confidence: r.level / 2,
      missing: r.missing,
      have,
    },
    levers: (selected?.levers ?? [])
      .filter((l) => l.lever !== 'growth' && finite(l.current) && finite(l.target))
      .map((l) => ({
        key: l.lever,
        label: l.label,
        expected_effect: `${leverValue(l.lever, l.current)} → ${leverValue(l.lever, l.target)} (темп плана «${selected!.label}»)`,
        data_available: true,
      })),
    top5_limits: x.griTop5.slice(0, 5).map((t) => ({ rank: t.rank, title: t.title, block: t.block, severity: 'high' })),
  }
}

/** Nothing to say (no Point B open, or the calculation failed): honest nulls, never a guess. */
export const EMPTY_ASSISTANT_POINT_B: AssistantPointB = {
  has_goal: false,
  current_revenue_year: null,
  goal_12m_revenue_year: null,
  goal_3y_revenue_year: null,
  gap: { multiplier: null, required_cagr: null, required_mom_growth: null, data_complete: false },
  realism: { level: 'unknown', score: null, rationale: [], weak_blocks: [] },
  data_sufficiency: { sufficient: false, confidence: 0, missing: [], have: [] },
  levers: [],
  top5_limits: [],
}
