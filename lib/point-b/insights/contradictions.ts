/**
 * lib/point-b/insights/contradictions.ts — contradictions of a plan (spec §12), found by RULES on the data
 * that is there (never guessed). Pure.
 *
 *   (a) deadline_vs_pace     the selected pace does not reach the goal by its deadline
 *                            (time to goal > goal months, or not reached within the model's horizon)
 *   (b) cash_gap_selected    the selected scenario has a cash gap
 *   (c) growth_without_staff the goal multiplies the revenue (×2 or more) while the pace needs new staff
 *                            (headcount known: staffNeed > 0)
 *   (d) goal_vs_base         the model warns that the funnel / the history does not agree with the base revenue
 *   (e) goal_not_verified    a pace is selected while the main goal is not verified by an expert
 *
 * (a), (b), (e) need a SELECTED scenario (a plan); (c) and (d) speak about the data itself. Texts use only
 * numbers of the result. Nothing at level 0 or without scenarios.
 */
import { fmtMonths, fmtMoney, fmtNum, fmtTimes } from '../model/format'
import type { ModelResult } from '../model/types'
import type { RecSourceRef } from '../recs/types'
import { modelRef, pickScenario, scenarioRef } from './scenario'

export interface Contradiction {
  key: string
  title: string
  reason: string
  sourceRefs: RecSourceRef[]
}

/** Revenue «в разы»: the goal is at least this multiple of today's. */
export const GROWTH_MULTIPLE = 2

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)
const MISMATCH = /^(Расчёт по воронке не сходится с фактом|Выручка за последние 12 месяцев по истории)/
const GOAL_NOT_VERIFIED = /^Цель не проверена экспертом/
const goalRef: RecSourceRef = { type: 'goal', ref: 'biz.finansy.vyruchka_god', label: 'Цель по выручке' }

export function findContradictions(input: { result: ModelResult; selectedScenario: string | null; goalMonths: number | null }): Contradiction[] {
  const { result } = input
  if (!result || result.level < 1 || !result.scenarios?.length) return []
  const out: Contradiction[] = []
  const selected = input.selectedScenario ? result.scenarios.find((s) => s.key === input.selectedScenario) ?? null : null

  // (a)
  if (selected && finite(input.goalMonths) && input.goalMonths >= 1) {
    const t = selected.timeToGoalMonths?.base
    if (t === null || (finite(t) && t > input.goalMonths)) {
      out.push({
        key: 'deadline_vs_pace',
        title: 'Выбранный темп не успевает к сроку цели',
        reason: t === null
          ? `При темпе «${selected.label}» цель не достигается в горизонте модели, а срок цели — ${fmtMonths(input.goalMonths)}`
          : `При темпе «${selected.label}» цель достигается через ${fmtMonths(t)}, а срок цели — ${fmtMonths(input.goalMonths)}`,
        sourceRefs: [scenarioRef(selected), goalRef],
      })
    }
  }

  // (b)
  const gap = selected?.finance?.cashGapMonth
  if (selected && finite(gap)) {
    out.push({
      key: 'cash_gap_selected',
      title: 'Основной сценарий плана — с кассовым разрывом',
      reason: `Выбран темп «${selected.label}», а по финмодели в месяце ${fmtNum(gap)} денег на счёте не хватает (минимум — ${fmtMoney(selected.finance!.minCash.value)}).`,
      sourceRefs: [scenarioRef(selected), { type: 'finmodel', ref: 'cash', label: 'Финмодель: деньги на счёте и расходы' }],
    })
  }

  // (c)
  const sc = selected ?? pickScenario(result, null)
  const mult = result.gap?.multiplier
  const staff = sc?.investments?.staffNeed
  if (sc && finite(mult) && mult >= GROWTH_MULTIPLE && finite(staff) && staff > 0) {
    out.push({
      key: 'growth_without_staff',
      title: 'Рост выручки в разы без расширения команды',
      reason: `Цель — рост выручки в ${fmtTimes(mult)}, а при темпе «${sc.label}» нужно около ${fmtNum(staff)} новых сотрудников; без найма команда не выдержит такой объём.`,
      sourceRefs: [scenarioRef(sc), { type: 'metric', ref: 'biz.hr.kol_vo_sotrudnikov', label: 'Число сотрудников' }, goalRef],
    })
  }

  // (d)
  const mismatch = (result.warnings ?? []).find((w) => MISMATCH.test(w))
  if (mismatch) {
    out.push({
      key: 'goal_vs_base',
      title: 'Данные о выручке не сходятся с базой',
      reason: mismatch,
      sourceRefs: [modelRef('calibration', 'Калибровка модели по факту'), { type: 'metric', ref: 'biz.finansy.vyruchka_god', label: 'Годовая выручка' }],
    })
  }

  // (e)
  if (selected && (result.warnings ?? []).some((w) => GOAL_NOT_VERIFIED.test(w))) {
    out.push({
      key: 'goal_not_verified',
      title: 'Темп выбран, а главная цель не проверена экспертом',
      reason: `Выбран темп «${selected.label}», но главная цель ещё не проверена: сценарии могут измениться после проверки.`,
      sourceRefs: [goalRef, scenarioRef(selected)],
    })
  }
  return out
}
