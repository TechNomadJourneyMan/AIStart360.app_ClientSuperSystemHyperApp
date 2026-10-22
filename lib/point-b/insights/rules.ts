/**
 * lib/point-b/insights/rules.ts — deterministic triggers of the personal invites (spec §12.1; plan Ф6a,
 * «Правила evaluateInsightRules»). Pure: no IO, no clock, no LLM. Texts are Russian templates; every number
 * in them is taken from the model result and written with the model's own formatting (format.ts).
 *
 *   cash_gap        the scenario has a cash gap               → priority 1, modal if the gap is in months 1..6
 *   funding_need    a funding need without a gap             → priority 3
 *   staff_load      the pace needs new staff                 → priority 3
 *   conversion_gap  the funnel needs conversion +20% or more → priority 2
 *   finmodel_gap    level 1 and the finmodel is incomplete   → priority 4, lives 30 days
 *   pace_behind     the verdict is behind / at risk           → priority 2
 *   infeasible      the scenario is not feasible             → priority 1
 *   goal_correction an expert's goal correction waits for the owner (spec §12.1 «цель ждёт согласия
 *                   владельца»; the `pendingCorrection` input) → priority 2
 *
 * The scenario is the selected one, else «Умеренный» (scenario.ts). Nothing fires at level 0 or without
 * scenarios (no invite from nothing). dedupeKey = ruleKey + the subject (scenario, month, rounded number),
 * so the same rule about the same subject is not repeated while it is active (pb_invites unique index).
 * Candidates are sorted by priority (smaller = more important), then by the order above.
 */
import { fmtMoney, fmtNum, fmtPct } from '../model/format'
import type { ModelResult } from '../model/types'
import type { RecSourceRef } from '../recs/types'
import { modelRef, pickScenario, scenarioRef, tabHref } from './scenario'

export interface InsightCandidate {
  ruleKey: string
  dedupeKey: string
  kind: 'insight' | 'recommendation'
  title: string
  body: string
  href: string | null
  /** Smaller = more important. */
  priority: number
  display: 'card' | 'modal'
  why: string
  sourceRefs: RecSourceRef[]
  expiresInDays: number
}

export interface InsightRulesInput {
  result: ModelResult
  selectedScenario: string | null
  /** How many keys of the «Финмодель» are missing (level 2 needs all). */
  finmodelMissing: number
  /** An expert's correction of a goal waits for the owner's answer. */
  pendingCorrection: boolean
}

/** A cash gap in the first months is critical: the invite opens as a modal window (spec §12.2). */
export const CASH_GAP_MODAL_MONTHS = 6
/** The conversion must grow by at least this much (percent) for the rule to speak. */
export const CONVERSION_GAP_MIN_PCT = 20
export const DEFAULT_EXPIRES_DAYS = 14
export const FINMODEL_EXPIRES_DAYS = 30

const RULE_ORDER = ['cash_gap', 'infeasible', 'conversion_gap', 'pace_behind', 'goal_correction', 'funding_need', 'staff_load', 'finmodel_gap']

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)

/** A rounded subject for a dedupe key: the same value in the UI = the same key. */
const subject = (s: string): string => s.replace(/[^\p{L}\p{N},.×%-]+/gu, '').slice(0, 40)

export function evaluateInsightRules(input: InsightRulesInput): InsightCandidate[] {
  const { result } = input
  if (!result || result.level < 1 || !result.scenarios?.length) return []
  const sc = pickScenario(result, input.selectedScenario)
  if (!sc) return []
  const out: InsightCandidate[] = []
  const base = (c: Omit<InsightCandidate, 'kind' | 'expiresInDays'> & Partial<Pick<InsightCandidate, 'expiresInDays'>>): void => {
    out.push({ kind: 'insight', expiresInDays: DEFAULT_EXPIRES_DAYS, ...c })
  }
  const pace = `«${sc.label}»`
  const f = sc.finance

  // 1. cash_gap
  if (f && f.cashGapMonth !== null && finite(f.cashGapMonth)) {
    const m = f.cashGapMonth
    base({
      ruleKey: 'cash_gap',
      dedupeKey: `cash_gap:${sc.key}:m${m}`,
      title: `Кассовый разрыв в месяце ${fmtNum(m)}`,
      body: `При темпе ${pace} денег на счёте не хватит в месяце ${fmtNum(m)}: минимум — ${fmtMoney(f.minCash.value)}. Рассчитать безопасный резерв?`,
      href: tabHref('whatif'),
      priority: 1,
      display: m <= CASH_GAP_MODAL_MONTHS ? 'modal' : 'card',
      why: `Денежный поток сценария ${pace} по вашей финмодели уходит ниже нуля в месяце ${fmtNum(m)}.`,
      sourceRefs: [scenarioRef(sc), { type: 'finmodel', ref: 'cash', label: 'Финмодель: деньги на счёте и расходы' }],
    })
  }

  // 2. funding_need (only without a gap: the gap already says it)
  if (f && f.cashGapMonth === null && finite(f.fundingNeed) && f.fundingNeed > 0) {
    const need = fmtMoney(f.fundingNeed)
    base({
      ruleKey: 'funding_need',
      dedupeKey: `funding_need:${sc.key}:${subject(need)}`,
      title: `Для выбранного темпа нужен резерв около ${need}`,
      body: `При темпе ${pace} касса опускается ниже резерва ликвидности (${fmtMoney(f.reserveRequired)}). Посчитать в «Что если», как закрыть нехватку?`,
      href: tabHref('whatif'),
      priority: 3,
      display: 'card',
      why: `Минимальный остаток денег в сценарии ${pace} — ${fmtMoney(f.minCash.value)}, а резерв ликвидности сценария — ${fmtMoney(f.reserveRequired)}.`,
      sourceRefs: [scenarioRef(sc), { type: 'finmodel', ref: 'cash', label: 'Финмодель: деньги на счёте и расходы' }],
    })
  }

  // 3. staff_load
  const staff = sc.investments?.staffNeed
  if (finite(staff) && staff > 0) {
    base({
      ruleKey: 'staff_load',
      dedupeKey: `staff_load:${sc.key}:${staff}`,
      title: `Выбранному темпу нужно около ${fmtNum(staff)} новых сотрудников`,
      body: `Чтобы команда выдержала рост при темпе ${pace}, нужно около ${fmtNum(staff)} новых сотрудников. Оценить найм в «Что если»?`,
      href: tabHref('whatif'),
      priority: 3,
      display: 'card',
      why: `Потребность в персонале сценария ${pace} считается от выручки на сотрудника при текущей численности.`,
      sourceRefs: [scenarioRef(sc), { type: 'metric', ref: 'biz.hr.kol_vo_sotrudnikov', label: 'Число сотрудников' }],
    })
  }

  // 4. conversion_gap
  const conv = result.kind === 'funnel' ? sc.requiredUplift.find((u) => u.lever === 'conversion') : undefined
  if (conv && finite(conv.upliftPct) && conv.upliftPct >= CONVERSION_GAP_MIN_PCT && finite(conv.current) && finite(conv.target)) {
    base({
      ruleKey: 'conversion_gap',
      dedupeKey: `conversion_gap:${sc.key}:${subject(fmtPct(conv.target, 1))}`,
      title: `Цель требует роста конверсии с ${fmtPct(conv.current, 1)} до ${fmtPct(conv.target, 1)}`,
      body: `В сценарии ${pace} конверсия лида в клиента должна вырасти на +${fmtNum(conv.upliftPct, 1)}%. Построить план улучшения продаж?`,
      href: tabHref('strategy'),
      priority: 2,
      display: 'card',
      why: `Разбор цели по воронке: доля конверсии в нужном росте выручки в сценарии ${pace}.`,
      sourceRefs: [scenarioRef(sc), { type: 'metric', ref: 'biz.marketing.konversiya_lid_klient', label: 'Конверсия лида в клиента' }],
    })
  }

  // 5. finmodel_gap
  if (result.level === 1 && finite(input.finmodelMissing) && input.finmodelMissing >= 1) {
    base({
      ruleKey: 'finmodel_gap',
      dedupeKey: 'finmodel_gap',
      title: 'Добавьте данные о деньгах — покажем кассовый разрыв',
      body: 'Заполните «Финмодель»: деньги на счёте, расходы и долги. Тогда модель посчитает прибыль, денежный поток и месяц возможного кассового разрыва.',
      href: tabHref('finmodel'),
      priority: 4,
      display: 'card',
      why: 'В финмодели заполнены не все значения, поэтому деньги по сценариям не рассчитаны.',
      sourceRefs: [{ type: 'finmodel', ref: 'missing', label: 'Финмодель: незаполненные значения' }],
      expiresInDays: FINMODEL_EXPIRES_DAYS,
    })
  }

  // 6. pace_behind
  const v = result.verdict?.key
  const at = result.forecast?.atCurrentPace?.base
  const target = result.gap?.targetAnnual
  if ((v === 'behind' || v === 'at_risk') && finite(at) && finite(target)) {
    base({
      ruleKey: 'pace_behind',
      dedupeKey: `pace_behind:${v}`,
      title: 'Текущий ход отстаёт от цели',
      body: `Прогноз при текущем ходе — ${fmtMoney(at)} в год при цели ${fmtMoney(target)}. Пересмотреть стратегию?`,
      href: tabHref('strategy'),
      priority: 2,
      display: 'card',
      why: result.verdict.reason,
      sourceRefs: [modelRef('forecast', 'Прогноз при текущем ходе (история выручки)'), { type: 'goal', ref: 'biz.finansy.vyruchka_god', label: 'Цель по выручке' }],
    })
  }

  // 7. infeasible
  if (!sc.feasible) {
    const reason = sc.infeasibleReason?.trim() || 'рычагам не хватает запаса до потолка реализуемости.'
    base({
      ruleKey: 'infeasible',
      dedupeKey: `infeasible:${sc.key}`,
      title: 'Выбранный темп недостижим',
      body: `Темп ${pace}: ${reason}`,
      href: tabHref('scenarios'),
      priority: 1,
      display: 'card',
      why: `Для сценария ${pace} нужный рост рычагов выше потолков реализуемости.`,
      sourceRefs: [scenarioRef(sc)],
    })
  }

  // 8. goal_correction
  if (input.pendingCorrection) {
    base({
      ruleKey: 'goal_correction',
      dedupeKey: 'goal_correction',
      title: 'Эксперт предложил уточнить цель',
      body: 'Пока вы не ответите, цель и план считаются по прежнему значению. Откройте «Точку Б» и ответьте, согласны ли вы.',
      href: tabHref('overview'),
      priority: 2,
      display: 'card',
      why: 'Эксперт проверил цель и предложил другое значение — нужно ваше согласие.',
      sourceRefs: [{ type: 'goal', ref: 'review', label: 'Проверка цели экспертом' }],
    })
  }

  return out.sort((a, b) => a.priority - b.priority || RULE_ORDER.indexOf(a.ruleKey) - RULE_ORDER.indexOf(b.ruleKey))
}
