/**
 * lib/point-b/fixtures.ts — deterministic Point B results for the read-only
 * preview page (/dev/point-b-preview) and visual audits.
 *
 * Built by the REAL engine from fixed inputs, so a preview shows exactly the
 * structure production produces. No database, no network; `generated_at` is
 * pinned so two calls are identical.
 */
import type { PointA } from '@/types/onboarding'
import type { PointBStrategy } from '@/types/point-b'
import { calculatePointBV2, POINT_B_LEVER_METRICS, type PointBOptions, type PointBV2 } from './engine'
import type { FinmodelStateView } from '@/components/point-b/finmodelController'
import type { FinmodelKey } from './finmodel/keys'
import type { ModelResult, Range, ScenarioFinance, ScenarioResult } from './model/types'
import { WHATIF_LABELS, type WhatIfChange, type WhatIfMetrics, type WhatIfResult } from './model/whatif'
import { fmtMoney } from '@/components/point-b/overviewModel'
import type { SavedWhatIf } from '@/components/point-b/whatIfModel'
import type { PointBStrategyState } from '@/components/point-b/strategyModel'
import type { MatrixPoint } from './strategy/matrix'
import type { NodeProgress } from './strategy/progress'
import type { PlanStrategy, StrategyNode } from './strategy/types'

/** `level2`: the same business as `full`, with the finmodel filled in — profit, cash flow, funding need. */
export const POINT_B_FIXTURE_VARIANTS = ['full', 'no-goal', 'stale-base', 'level2'] as const
export type PointBFixtureVariant = (typeof POINT_B_FIXTURE_VARIANTS)[number]

export function isPointBFixtureVariant(v: unknown): v is PointBFixtureVariant {
  return typeof v === 'string' && (POINT_B_FIXTURE_VARIANTS as readonly string[]).includes(v)
}

const GENERATED_AT = '2026-10-18T09:00:00.000Z'

const block = (score: number, status: PointA['blocks']['finance']['status'], issue?: string) => ({
  score, status, top_issues: issue ? [issue] : [], recommendations: [] as string[],
})

function pointA(variant: PointBFixtureVariant): PointA {
  return {
    overall_score: 54,
    health_index: 49,
    stage: 'growth',
    blocks: {
      finance: block(58, 'average', 'Маржа ниже средней по отрасли'),
      // «stale-base» models a client whose Sales block has no score: the compat row holds 0, the loader reports it.
      sales: variant === 'stale-base' ? block(0, 'critical') : block(47, 'weak', 'Низкая конверсия лидов'),
      operations: block(62, 'average'),
      marketing: block(44, 'weak', 'Нет предсказуемого потока лидов'),
      strategy: block(51, 'average'),
    },
    risks: [],
    insights: [],
    quick_wins: [
      { action: 'Ввести еженедельный разбор воронки', impact: 'high', effort: 'low', timeline: '1–2 недели' },
      { action: 'Пересмотреть прайс на топ-3 продукта', impact: 'medium', effort: 'low', timeline: '2–4 недели' },
    ] as unknown as PointA['quick_wins'],
    data_gaps: [],
  }
}

const AI_STRATEGY: PointBStrategy = {
  strategic_bridge_summary:
    'Чтобы выйти на цель, сначала стабилизируйте воронку продаж и поток лидов, затем масштабируйте то, что уже работает. Рост выручки в первые два квартала должен идти за счёт конверсии и среднего чека, а не за счёт новых затрат на рекламу.',
  gap_bridge: [
    { block: 'Продажи', gap: 'Конверсия лидов в сделки ниже целевой', action: 'Ввести единый скрипт и еженедельный разбор воронки', priority: 'Приоритет 1' },
    { block: 'Маркетинг', gap: 'Поток лидов зависит от одного канала', action: 'Запустить второй канал и измерять стоимость лида', priority: 'Приоритет 2' },
  ],
  milestones: [
    { q: 'Q1', title: 'Порядок в воронке', desc: 'Единый учёт лидов и сделок, скрипты продаж.', status: 'current' },
    { q: 'Q2', title: 'Второй канал лидов', desc: 'Тест и выбор канала по стоимости лида.', status: 'planned' },
    { q: 'Q3', title: 'Масштабирование', desc: 'Найм в отдел продаж под доказанную воронку.', status: 'future' },
  ],
  risk_mitigations: [
    { risk: 'Высокий требуемый темп роста', mitigation: 'Разбить цель на кварталы и пересматривать темп по факту.' },
  ],
}

const FULL_ANSWERS: Record<string, unknown> = {
  s2n_goal_12m_what: 'Удвоить выручку и выйти на стабильный поток заявок',
  s2n_goal_3y_what: 'Стать одним из трёх лидеров региона',
  s6_main_pain: 'Нет предсказуемого потока лидов',
  s6_growth_blockers: ['Маркетинг', 'Команда продаж'],
  s7_avg_check_target: 220_000,
}

const LEVER_METRICS: Record<string, number> = {
  [POINT_B_LEVER_METRICS.leads]: 300,
  [POINT_B_LEVER_METRICS.conversion]: 12,
  [POINT_B_LEVER_METRICS.avgCheck]: 185_000,
  [POINT_B_LEVER_METRICS.repeat]: 28,
  [POINT_B_LEVER_METRICS.cac]: 24_000,
  [POINT_B_LEVER_METRICS.margin]: 22,
}

const GRI_TOP5: NonNullable<PointBOptions['griTop5']> = [
  { rank: 1, title: 'Нет системы учёта лидов и сделок', block: 'sales', severity: 'critical' },
  { rank: 2, title: 'Зависимость от одного канала привлечения', block: 'marketing', severity: 'high' },
  { rank: 3, title: 'Нет регулярного управленческого учёта', block: 'finance', severity: 'high' },
]

/** One Point B result per audit scenario. Deterministic; a fresh object each call. */
export function fixturePointB(variant: PointBFixtureVariant): PointBV2 {
  const common: PointBOptions = { diagnosticId: `fixture-${variant}`, griTop5: GRI_TOP5 }

  let pb: PointBV2
  if (variant === 'full' || variant === 'level2') {
    pb = calculatePointBV2(pointA(variant), FULL_ANSWERS, {
      ...common,
      currentRevenueYear: 66_000_000,
      metrics: LEVER_METRICS,
      goal12mYear: 120_000_000,
      goal3yYear: 400_000_000,
      blocksWithoutData: [],
      baseRevenue: { period: '2026-09', ageMonths: 1, stale: false },
    })
    pb.ai_strategy = AI_STRATEGY as unknown as Record<string, unknown>
    pb.ai_status = 'completed'
    pb.data_quality.snapshot = { id: 'fixture-snapshot', confidence: 0.78, coverage: 0.85 }
  } else if (variant === 'no-goal') {
    pb = calculatePointBV2(pointA(variant), { s6_main_pain: FULL_ANSWERS.s6_main_pain }, {
      ...common,
      currentRevenueYear: 66_000_000,
      metrics: LEVER_METRICS,
      blocksWithoutData: [],
      baseRevenue: { period: '2026-09', ageMonths: 1, stale: false },
    })
    pb.data_quality.snapshot = { id: 'fixture-snapshot', confidence: 0.6, coverage: 0.7 }
  } else {
    pb = calculatePointBV2(pointA(variant), FULL_ANSWERS, {
      ...common,
      currentRevenueYear: 60_000_000,
      metrics: { ...LEVER_METRICS, [POINT_B_LEVER_METRICS.leads]: 0 },
      goal12mYear: 120_000_000,
      goal3yYear: 400_000_000,
      blocksWithoutData: ['sales'],
      baseRevenue: { period: '2024', ageMonths: 22, stale: true },
    })
    pb.data_quality.snapshot = { id: 'fixture-snapshot', confidence: 0.42, coverage: 0.5 }
  }
  pb.generated_at = GENERATED_AT
  return pb
}

// ── Model result (Phase 2 «Обзор» / «Сценарии») ───────────────────────────
//
// Built BY HAND, not by the model: the preview must not depend on lib/point-b/model/*, and the
// numbers only have to be plausible and consistent (low ≤ base ≤ high, trajectories never
// decrease, the time to the goal is the month the base line reaches the target). They are
// illustrative — not the output of a real calculation.

const MONTHS_TO_GOAL = 12
const BASE_NOW = 66_000_000
const BASE_STALE = 60_000_000
const GOAL = 120_000_000

/** Annual run-rate that grows from `start` and reaches `target` after `reachMonths`. */
const runRate = (start: number, target: number, reachMonths: number, month: number): number =>
  Math.round(start * Math.pow(target / start, month / reachMonths))

interface ScenarioSeed {
  key: ScenarioResult['key']
  label: string
  /** Months to the goal: [pessimistic, base, optimistic] — a longer time is the pessimistic end. */
  reach: [number, number, number]
  feasible: boolean
  infeasibleReason: string | null
  requiredUplift: ScenarioResult['requiredUplift']
  investments: ScenarioResult['investments']
  texts: Pick<ScenarioResult, 'constraints' | 'risks' | 'conditions' | 'downside' | 'reviewPoints' | 'signsToChangePace' | 'assumptions'>
}

function buildScenario(seed: ScenarioSeed, start: number): ScenarioResult {
  const [slow, mid, fast] = seed.reach
  const horizon = Math.min(60, Math.ceil(slow) + 3)
  const trajectory = Array.from({ length: horizon }, (_, i) => {
    const month = i + 1
    return { month, low: runRate(start, GOAL, slow, month), base: runRate(start, GOAL, mid, month), high: runRate(start, GOAL, fast, month) }
  })
  const at = (reach: number): number => runRate(start, GOAL, reach, MONTHS_TO_GOAL)
  const time: Range = { low: slow, base: mid, high: fast }
  const revenue: Range = { low: at(slow), base: at(mid), high: at(fast) }
  return {
    key: seed.key, label: seed.label,
    feasible: seed.feasible, infeasibleReason: seed.infeasibleReason,
    timeToGoalMonths: time, revenueAtDeadline: revenue,
    requiredUplift: seed.requiredUplift, investments: seed.investments,
    ...seed.texts,
    trajectory,
  }
}

const COMMON_ASSUMPTIONS = [
  'Сезонность не учтена: истории меньше 24 месяцев, взято равномерное распределение.',
  'Диапазон — по волатильности месячных приростов выручки.',
]
const MONEY_NOTE = 'Кассовый разрыв не оценён: нет данных о деньгах (уровень 2).'

function funnelSeeds(): ScenarioSeed[] {
  const uplift = (mult: number): ScenarioResult['requiredUplift'] => [
    { lever: 'leads', label: 'Заявок в месяц', current: 300, target: Math.round(300 * (1 + 0.29 * mult)), upliftPct: Math.round(29 * mult * 10) / 10 },
    { lever: 'conversion', label: 'Конверсия в оплату', current: 0.12, target: Math.round(0.12 * (1 + 0.2 * mult) * 1000) / 1000, upliftPct: Math.round(20 * mult * 10) / 10 },
    { lever: 'avgCheck', label: 'Средний чек', current: 185_000, target: Math.round(185_000 * (1 + 0.11 * mult)), upliftPct: Math.round(11 * mult * 10) / 10 },
    { lever: 'repeat', label: 'Повторные покупки за год', current: 0.28, target: Math.round(0.28 * (1 + 0.19 * mult) * 1000) / 1000, upliftPct: Math.round(19 * mult * 10) / 10 },
  ]
  return [
    {
      key: 'cautious', label: 'Осторожный', reach: [36, 30, 25], feasible: true, infeasibleReason: null,
      requiredUplift: uplift(1),
      investments: { marketingMonthlyIncrease: 250_560, totalOverRamp: 2_255_040, staffNeed: 2, note: 'Расходы растут постепенно в течение 18 месяцев.' },
      texts: {
        constraints: ['Рост ограничен темпом найма в отдел продаж', 'Рычаги выходят на целевой уровень за 18 месяцев'],
        risks: ['К сроку цели выручка дойдёт примерно до 84 млн ₸', 'Конкуренты могут занять нишу за это время'],
        conditions: ['Стабильный поток заявок без провалов', 'Единый скрипт продаж внедрён в первый квартал'],
        downside: 'Цель сдвигается более чем на год, но вложения и риск минимальны.',
        reviewPoints: ['Раз в квартал: конверсия и средний чек', 'Через 6 месяцев: стоит ли ускоряться'],
        signsToChangePace: ['Конверсия выросла быстрее плана — можно ускориться', 'Поток заявок упал два месяца подряд — снизить расходы'],
        assumptions: COMMON_ASSUMPTIONS,
      },
    },
    {
      key: 'moderate', label: 'Умеренный', reach: [18, 15, 13], feasible: true, infeasibleReason: null,
      requiredUplift: uplift(1),
      investments: { marketingMonthlyIncrease: 250_560, totalOverRamp: 1_503_360, staffNeed: 2, note: 'Основные вложения — в первые 12 месяцев.' },
      texts: {
        constraints: ['Нужен второй канал привлечения заявок', 'Отдел продаж должен вырасти на двух человек'],
        risks: ['Цель в срок 12 месяцев достигается на 89%', 'Рост расходов на рекламу опережает рост выручки первые 3 месяца'],
        conditions: ['Второй канал запущен в первом квартале', 'Конверсия не падает при росте потока'],
        downside: 'Если конверсия не вырастет, цель отодвинется на 4–6 месяцев.',
        reviewPoints: ['Каждый месяц: заявки, конверсия, стоимость клиента', 'Через 4 месяца: окупаемость второго канала'],
        signsToChangePace: ['Стоимость клиента выросла выше плана — замедлиться', 'Все рычаги идут по плану — рассмотреть ускоренный темп'],
        assumptions: COMMON_ASSUMPTIONS,
      },
    },
    {
      key: 'aggressive', label: 'Ускоренный', reach: [12, 10, 8], feasible: false,
      infeasibleReason: 'Нужен рост потока заявок в 3,4 раза — выше потолка ×3 для ваших каналов',
      requiredUplift: [
        { lever: 'leads', label: 'Заявок в месяц', current: 300, target: 1020, upliftPct: 240 },
        { lever: 'conversion', label: 'Конверсия в оплату', current: 0.12, target: 0.18, upliftPct: 50 },
        { lever: 'avgCheck', label: 'Средний чек', current: 185_000, target: 222_000, upliftPct: 20 },
        { lever: 'repeat', label: 'Повторные покупки за год', current: 0.28, target: 0.36, upliftPct: 29 },
      ],
      investments: { marketingMonthlyIncrease: 2_073_600, totalOverRamp: 6_220_800, staffNeed: 5, note: 'Вложения сосредоточены в первые 6 месяцев.' },
      texts: {
        constraints: ['Поток заявок выше ×3 к текущему не подтверждён ни одним каналом', 'Нужен найм 5 человек одновременно'],
        risks: ['Падение конверсии при резком росте потока', 'Нагрузка на команду и качество обслуживания'],
        conditions: ['Подтверждённый канал на ×3 трафика', 'Готовая команда на старте'],
        downside: 'Высокий риск не достичь цели и потерять вложенные в рекламу средства.',
        reviewPoints: ['Каждую неделю первые два месяца', 'Через 2 месяца: решение продолжать или откатиться'],
        signsToChangePace: ['Конверсия ниже 10% — остановить рост расходов', 'Стоимость клиента выше плана на 30% — вернуться к умеренному темпу'],
        assumptions: COMMON_ASSUMPTIONS,
      },
    },
  ]
}

function growthSeeds(): ScenarioSeed[] {
  const up = (pct: number): ScenarioResult['requiredUplift'] => [
    { lever: 'growth', label: 'Годовая выручка', current: BASE_STALE, target: GOAL, upliftPct: pct },
  ]
  const none = { marketingMonthlyIncrease: null, totalOverRamp: null, staffNeed: null, note: 'Нужен CAC и число сотрудников, чтобы оценить вложения.' }
  const assumptions = ['Упрощённая модель роста: нет данных воронки (заявки, конверсия, чек).', ...COMMON_ASSUMPTIONS]
  return [
    {
      key: 'cautious', label: 'Осторожный', reach: [47, 37, 31], feasible: true, infeasibleReason: null,
      requiredUplift: up(100), investments: none,
      texts: {
        constraints: ['Потолок роста — 25% в год'], risks: ['Цель в срок 12 месяцев недостижима: к сроку выручка дойдёт до 75 млн ₸'],
        conditions: ['Стабильный спрос'], downside: 'Цель сдвигается почти на три года.', reviewPoints: ['Раз в квартал'], signsToChangePace: ['Рост быстрее 25% в год — пересчитать'], assumptions,
      },
    },
    {
      key: 'moderate', label: 'Умеренный', reach: [26, 21, 17], feasible: true, infeasibleReason: null,
      requiredUplift: up(100), investments: none,
      texts: {
        constraints: ['Потолок роста — 50% в год'], risks: ['К сроку цели выручка дойдёт до 90 млн ₸'],
        conditions: ['Рост спроса и продаж'], downside: 'Цель сдвигается примерно на 9 месяцев.', reviewPoints: ['Каждый квартал'], signsToChangePace: ['Рост быстрее плана — рассмотреть ускорение'], assumptions,
      },
    },
    {
      key: 'aggressive', label: 'Ускоренный', reach: [15, 12, 10], feasible: true, infeasibleReason: null,
      requiredUplift: up(100), investments: none,
      texts: {
        constraints: ['Потолок роста — 100% в год'], risks: ['Рост без данных воронки трудно контролировать'],
        conditions: ['Рост в два раза за год возможен только при новых каналах'], downside: 'Высокий риск не дойти до цели.', reviewPoints: ['Ежемесячно'], signsToChangePace: ['Рост ниже плана два месяца подряд'], assumptions,
      },
    },
  ]
}

// ── Level 2 (finmodel) by hand ─────────────────────────────────────────────
//
// A small deterministic cash loop written for the preview, NOT the model: it only guarantees that
// the numbers agree with each other (Σ CF = cash_end − cash_start, no negative debt, no NaN), so the
// screens can be judged. The aggressive pace grows revenue fast, and receivables, stock and capex
// eat the money: profit is positive while the cash goes below zero.

const FIN = {
  cash0: 4_200_000, margin: 0.5, payroll: 1_300_000, fixed: 600_000, debt0: 6_000_000, debtService: 400_000, rate: 0.18,
  dso: 3, dio: 45, dpo: 20, tax: 0.1, capexYear: 3_000_000,
} as const

/** Marketing share of revenue and payroll growth by pace: the faster pace spends more and hires more. */
const FIN_PACE: Record<ScenarioResult['key'], { marketingShare: number; payrollGrowth: number; reserveMonths: number }> = {
  cautious: { marketingShare: 0.08, payrollGrowth: 0.2, reserveMonths: 2 },
  moderate: { marketingShare: 0.11, payrollGrowth: 0.3, reserveMonths: 2 },
  aggressive: { marketingShare: 0.15, payrollGrowth: 0.55, reserveMonths: 3 },
}

function buildFinance(seed: ScenarioSeed, start: number): ScenarioFinance {
  const [slow, mid] = seed.reach
  const pace = FIN_PACE[seed.key]
  const H = Math.min(60, Math.ceil(slow) + 12)
  const rev0 = start / 12
  const nwcOf = (rev: number): number => Math.round((rev * FIN.dso) / 30 + (rev * (1 - FIN.margin) * (FIN.dio - FIN.dpo)) / 30)
  let nwcPrev = nwcOf(rev0)
  let debt = FIN.debt0
  let cash = FIN.cash0
  const out: ScenarioFinance = {
    ebitda: [], netProfit: [], cash: [], nwc: [],
    minCash: { value: Number.POSITIVE_INFINITY, month: 1 }, cashGapMonth: null, fundingNeed: 0, reserveRequired: 0,
    totals: { revenue: 0, ebitda: 0, netProfit: 0, operatingCashFlow: 0, capex: 0, debtService: 0 },
    assumptions: [
      'Расходы на маркетинг — доля выручки; ФОТ растёт с наймом за срок выхода рычагов.',
      'Допущения по отрасли: срок оплаты клиентами, оборачиваемость запасов, срок оплаты поставщикам и налог.',
    ],
  }
  for (let t = 1; t <= H; t++) {
    const rev = Math.round(runRate(start, GOAL, mid, Math.min(t, mid)) / 12)
    const cogs = Math.round(rev * (1 - FIN.margin))
    const marketing = Math.round(rev * pace.marketingShare)
    const payroll = Math.round(FIN.payroll * (1 + pace.payrollGrowth * Math.min(1, t / seed.reach[1])))
    const ebitda = rev - cogs - marketing - payroll - FIN.fixed
    const interest = Math.round((debt * FIN.rate) / 12)
    const principal = Math.min(debt, Math.max(0, FIN.debtService - interest))
    debt -= principal
    const tax = Math.max(0, Math.round(FIN.tax * (ebitda - interest)))
    const net = ebitda - interest - tax
    const nwc = nwcOf(rev)
    const cfo = ebitda - tax - (nwc - nwcPrev)
    const capex = Math.round(FIN.capexYear / 12)
    cash += cfo - interest - principal - capex
    nwcPrev = nwc
    out.ebitda.push(ebitda); out.netProfit.push(net); out.cash.push(cash); out.nwc.push(nwc)
    if (cash < out.minCash.value) out.minCash = { value: cash, month: t }
    if (cash < 0 && out.cashGapMonth === null) out.cashGapMonth = t
    out.totals.revenue += rev; out.totals.ebitda += ebitda; out.totals.netProfit += net
    out.totals.operatingCashFlow += cfo; out.totals.capex += capex; out.totals.debtService += interest + principal
    if (t === 1) out.reserveRequired = pace.reserveMonths * (payroll + FIN.fixed + marketing)
  }
  out.fundingNeed = Math.max(0, out.reserveRequired - out.minCash.value)
  return out
}

const GAP_MISSING = [
  { key: 'leads', label: 'Заявки в месяц', unlocks: 'расчёт по воронке вместо упрощённой модели роста', level: 1 as const, actions: ['survey' as const, 'documents' as const, 'expert' as const] },
  { key: 'conversion', label: 'Конверсия в оплату', unlocks: 'сколько заявок нужно для цели', level: 1 as const, actions: ['survey' as const, 'expert' as const] },
  { key: 'history', label: 'История выручки за 12 месяцев', unlocks: 'прогноз «при текущем ходе» и вердикт', level: 1 as const, actions: ['documents' as const, 'expert' as const] },
]

/** One hand-made ModelResult per audit scenario. Deterministic; a fresh object each call. */
export function fixtureModelResult(variant: PointBFixtureVariant): ModelResult {
  if (variant === 'no-goal') {
    return {
      modelVersion: 'pb-model-1', computedAt: GENERATED_AT, level: 0, kind: 'none', template: 'ecommerce',
      gap: { baseAnnual: BASE_NOW, targetAnnual: null, absolute: null, multiplier: null, requiredCagrPct: null, months: null },
      forecast: { atCurrentPace: { low: null, base: null, high: null }, trendMonthlyPct: null, basis: 'insufficient' },
      verdict: { key: 'no_data', headline: 'Нет цели — не с чем сравнивать', reason: 'Задайте цель по выручке, и мы покажем, идёте ли вы к ней и каким темпом.' },
      scenarios: [],
      missing: [{ key: 'goal', label: 'Цель по выручке', unlocks: 'вердикт, прогноз и сценарии темпа', level: 1, actions: ['survey', 'expert'] }],
      warnings: [],
    }
  }
  if (variant === 'stale-base') {
    return {
      modelVersion: 'pb-model-1', computedAt: GENERATED_AT, level: 1, kind: 'growth', template: 'ecommerce',
      gap: { baseAnnual: BASE_STALE, targetAnnual: GOAL, absolute: GOAL - BASE_STALE, multiplier: 2, requiredCagrPct: 100, months: MONTHS_TO_GOAL },
      forecast: { atCurrentPace: { low: null, base: null, high: null }, trendMonthlyPct: null, basis: 'insufficient' },
      verdict: { key: 'no_data', headline: 'Мало данных для вердикта', reason: 'История выручки короче 12 месяцев, поэтому прогноз «при текущем ходе» не считается.' },
      scenarios: growthSeeds().map((s) => buildScenario(s, BASE_STALE)),
      missing: GAP_MISSING,
      warnings: [
        'Выручка за 2024 год — данные устарели (22 мес.). Расчёт идёт от неё: обновите выручку, чтобы цифры отражали сегодняшний день.',
        'Расчёт по воронке невозможен: нет данных по заявкам и конверсии — использована упрощённая модель роста.',
        'Цель ещё не проверена экспертом.',
      ],
    }
  }
  const trend = 0.021
  const pace = Math.round(BASE_NOW * Math.pow(1 + trend, MONTHS_TO_GOAL))
  const seeds = funnelSeeds()
  const level2 = variant === 'level2'
  return {
    modelVersion: level2 ? 'pb-model-2' : 'pb-model-1', computedAt: GENERATED_AT, level: level2 ? 2 : 1, kind: 'funnel', template: 'ecommerce',
    gap: { baseAnnual: BASE_NOW, targetAnnual: GOAL, absolute: GOAL - BASE_NOW, multiplier: Math.round((GOAL / BASE_NOW) * 100) / 100, requiredCagrPct: Math.round((GOAL / BASE_NOW - 1) * 1000) / 10, months: MONTHS_TO_GOAL },
    forecast: { atCurrentPace: { low: Math.round(pace * 0.8), base: pace, high: Math.round(pace * 1.2) }, trendMonthlyPct: trend * 100, basis: 'history' },
    verdict: {
      key: 'behind', headline: 'Отстаём от цели',
      reason: `При текущем темпе к сроку выйдете на ≈${Math.round(pace / 1e6)} млн ₸ при цели ${GOAL / 1e6} млн ₸ (${Math.round((pace / GOAL) * 100)}%).`,
    },
    scenarios: seeds.map((s) => (level2 ? { ...buildScenario(s, BASE_NOW), finance: buildFinance(s, BASE_NOW) } : buildScenario(s, BASE_NOW))),
    missing: level2 ? [] : FINMODEL_MISSING,
    warnings: level2
      ? ['Оборотный капитал и налог — допущения по отрасли.', 'Цель ещё не проверена экспертом.']
      : [MONEY_NOTE, 'Цель ещё не проверена экспертом.'],
  }
}

const FINMODEL_MISSING: ModelResult['missing'] = [
  { key: 'finmodel:cash_balance', label: 'Деньги на счетах и в кассе', unlocks: 'Касса по месяцам, кассовый разрыв и потребность в финансировании', level: 2, actions: ['expert'] },
  { key: 'finmodel:payroll_month', label: 'Фонд оплаты труда в месяц', unlocks: 'Операционная прибыль и стоимость найма под рост', level: 2, actions: ['expert'] },
  { key: 'finmodel:debt_total', label: 'Долг по кредитам и займам', unlocks: 'Платежи по долгу в денежном потоке', level: 2, actions: ['survey', 'documents', 'expert'] },
  { key: 'finmodel:capex_year', label: 'Капитальные затраты за год', unlocks: 'Плановые траты на развитие в денежном потоке', level: 2, actions: ['expert'] },
]

/** Completeness of the finmodel as `PointBState.finmodel` reports it for a variant. */
export function fixtureFinmodelStatus(variant: PointBFixtureVariant): { complete: boolean; missing: FinmodelKey[]; defaulted: FinmodelKey[] } {
  if (variant === 'level2') return { complete: true, missing: [], defaulted: ['tax_rate', 'dso_days', 'dio_days', 'dpo_days'] }
  return { complete: false, missing: FINMODEL_MISSING.map((m) => m.key.slice('finmodel:'.length) as FinmodelKey), defaulted: ['tax_rate', 'dso_days', 'dio_days', 'dpo_days'] }
}

const FM_AT = '2026-10-17T09:00:00.000Z'
const fmValue = (key: FinmodelKeyFx, value: number, origin: FinmodelOriginFx, status: 'entered' | 'verified' | 'auto', extra: Partial<FinmodelValueFx> = {}): FinmodelValueFx => ({
  key, value, origin, status, note: null, verifiedByName: null, verifiedAt: null, updatedAt: FM_AT, ...extra,
})
type FinmodelValueFx = NonNullable<FinmodelStateView['values'][keyof FinmodelStateView['values']]>
type FinmodelKeyFx = FinmodelValueFx['key']
type FinmodelOriginFx = FinmodelValueFx['origin']

/**
 * The «Финмодель» tab of the preview: `level2` is filled (one value verified by an expert, one from the
 * questionnaire, four assumptions by industry); the other variants lack the money and show the frames.
 */
export function fixtureFinmodel(variant: PointBFixtureVariant): FinmodelStateView {
  const defaults = {
    tax_rate: fmValue('tax_rate', 0.1, 'default', 'auto', { updatedAt: null }),
    dso_days: fmValue('dso_days', FIN.dso, 'default', 'auto', { updatedAt: null }),
    dio_days: fmValue('dio_days', FIN.dio, 'default', 'auto', { updatedAt: null }),
    dpo_days: fmValue('dpo_days', FIN.dpo, 'default', 'auto', { updatedAt: null }),
  }
  if (variant === 'level2') {
    return {
      values: {
        cash_balance: fmValue('cash_balance', FIN.cash0, 'expert', 'verified', { verifiedByName: 'Анна Ким', verifiedAt: '2026-10-16T12:00:00.000Z' }),
        fixed_costs_month: fmValue('fixed_costs_month', FIN.fixed, 'owner', 'entered'),
        payroll_month: fmValue('payroll_month', FIN.payroll, 'owner', 'entered'),
        debt_total: fmValue('debt_total', FIN.debt0, 'survey', 'auto', { updatedAt: null }),
        debt_service_month: fmValue('debt_service_month', FIN.debtService, 'owner', 'entered'),
        interest_rate_annual: fmValue('interest_rate_annual', FIN.rate, 'owner', 'entered'),
        capex_year: fmValue('capex_year', FIN.capexYear, 'owner', 'entered'),
        ...defaults,
      },
      missing: [], complete: true, defaulted: ['tax_rate', 'dso_days', 'dio_days', 'dpo_days'],
    }
  }
  return {
    // Only part of the money is known: the form keeps the frames «Нужно для расчёта денег» for the rest.
    values: { fixed_costs_month: fmValue('fixed_costs_month', 650_000, 'survey', 'auto', { updatedAt: null }), ...defaults },
    missing: ['cash_balance', 'payroll_month', 'debt_total', 'capex_year'],
    complete: false,
    defaulted: ['tax_rate', 'dso_days', 'dio_days', 'dpo_days'],
  }
}


// ── «Что если» by hand ────────────────────────────────────────────────────
//
// NOT the engine: a tiny deterministic model written for the preview so the numbers of one fixed set of changes agree
// with each other (the deltas are differences, the contributions come from separate runs, the interaction is the rest,
// the cash loop is one chain). It understands conversion, average check and a revenue shock; other calculators are not
// simulated (the preview answers with the pre-computed result of the fixed set).

const WI_HORIZON = 24
const WI_DEADLINE = 12
const WI_RAMP = 12
const WI_CONVERSION0 = 0.12
const WI_MARKETING_SHARE = 0.1

/** The set of changes the preview opens with (and the one the fixture result is computed for). */
export function fixtureWhatIfChanges(variant: PointBFixtureVariant): WhatIfChange[] {
  if (variant === 'no-goal') return []
  if (variant === 'stale-base') return [{ kind: 'revenue_shock', pct: -30, startMonth: 2, durationMonths: 3 }]
  return [{ kind: 'conversion', pp: 2 }, { kind: 'revenue_shock', pct: -40, startMonth: 2, durationMonths: 4 }]
}

function wiRun(variant: PointBFixtureVariant, changes: WhatIfChange[]): { rr: number[]; metrics: WhatIfMetrics } {
  const stale = variant === 'stale-base'
  const money = variant === 'level2'
  const start = stale ? BASE_STALE : BASE_NOW
  const trend = stale ? 0 : 0.021
  const rr: number[] = []
  for (let t = 0; t <= WI_HORIZON; t++) {
    const u = Math.min(1, t / WI_RAMP)
    let mult = 1
    for (const c of changes) {
      if (c.kind === 'conversion') mult *= Math.min(0.6, Math.max(0, WI_CONVERSION0 + (c.pp / 100) * u)) / WI_CONVERSION0
      else if (c.kind === 'avg_check') mult *= (1 + (c.pct / 100) * u) * Math.max(0, 1 - (c.demandElasticity ?? 0.3) * (c.pct / 100) * u)
      else if (c.kind === 'revenue_shock' && t >= c.startMonth && t <= c.startMonth + c.durationMonths - 1) mult *= 1 + c.pct / 100
    }
    rr.push(Math.round(start * Math.pow(1 + trend, t) * mult))
  }
  const months = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i)
  const first12 = months(1, WI_DEADLINE)
  const reached = rr.findIndex((v) => v >= GOAL)
  const metrics: WhatIfMetrics = {
    annualRunRateAtDeadline: rr[WI_DEADLINE],
    revenueFirst12m: first12.reduce((a, t) => a + Math.round(rr[t] / 12), 0),
    timeToGoalMonths: reached >= 0 ? reached : null,
    minCash: null, cashGapMonth: null, fundingNeed: null, ebitdaFirst12m: null,
  }
  if (money) {
    let cash: number = FIN.cash0
    let min = { value: Number.POSITIVE_INFINITY, month: 1 }
    let gap: number | null = null
    let ebitdaYear = 0
    for (let t = 1; t <= WI_HORIZON; t++) {
      const revenue = rr[t] / 12
      const ebitda = Math.round(revenue * FIN.margin - revenue * WI_MARKETING_SHARE - FIN.payroll - FIN.fixed)
      cash += ebitda - FIN.debtService - Math.round(FIN.capexYear / 12)
      if (cash < min.value) min = { value: Math.round(cash), month: t }
      if (cash < 0 && gap === null) gap = t
      if (t <= WI_DEADLINE) ebitdaYear += ebitda
    }
    const reserve = 2 * (FIN.payroll + FIN.fixed + Math.round((start / 12) * WI_MARKETING_SHARE))
    metrics.minCash = min
    metrics.cashGapMonth = gap
    metrics.fundingNeed = Math.max(0, Math.round(reserve - min.value))
    metrics.ebitdaFirst12m = ebitdaYear
  }
  return { rr, metrics }
}

function wiDelta(a: WhatIfMetrics, b: WhatIfMetrics): WhatIfResult['delta'] {
  const d = (x: number | null, y: number | null): number | null => (x !== null && y !== null ? y - x : null)
  return {
    annualRunRateAtDeadline: d(a.annualRunRateAtDeadline, b.annualRunRateAtDeadline),
    revenueFirst12m: d(a.revenueFirst12m, b.revenueFirst12m),
    timeToGoalMonths: d(a.timeToGoalMonths, b.timeToGoalMonths),
    minCash: a.minCash && b.minCash ? b.minCash.value - a.minCash.value : null,
    cashGapMonth: d(a.cashGapMonth, b.cashGapMonth),
    fundingNeed: d(a.fundingNeed, b.fundingNeed),
    ebitdaFirst12m: d(a.ebitdaFirst12m, b.ebitdaFirst12m),
  }
}

const WI_APPLICABLE_OK = { ok: true, reason: null } as const

function wiApplicable(variant: PointBFixtureVariant): WhatIfResult['applicable'] {
  const no = (reason: string) => ({ ok: false, reason })
  if (variant === 'no-goal') {
    const reason = 'Нет данных для расчёта: задайте цель и добавьте текущую выручку'
    return { marketing: no(reason), hire: no(reason), avg_check: no(reason), conversion: no(reason), revenue_shock: no(reason), fixed_costs: no(reason) }
  }
  const hire = variant === 'level2' ? WI_APPLICABLE_OK : no('Нужны фонд оплаты труда и число сотрудников — заполните финмодель')
  if (variant === 'stale-base') {
    const funnel = no('Нет данных воронки (заявки, конверсия, чек): считается упрощённая модель роста')
    return { marketing: funnel, hire, avg_check: funnel, conversion: funnel, revenue_shock: WI_APPLICABLE_OK, fixed_costs: WI_APPLICABLE_OK }
  }
  return { marketing: WI_APPLICABLE_OK, hire, avg_check: WI_APPLICABLE_OK, conversion: WI_APPLICABLE_OK, revenue_shock: WI_APPLICABLE_OK, fixed_costs: WI_APPLICABLE_OK }
}

/** A hand-made WhatIfResult consistent in itself; `changes = []` gives the «nothing changed» answer. */
export function fixtureWhatIf(variant: PointBFixtureVariant, changes: WhatIfChange[] = fixtureWhatIfChanges(variant)): WhatIfResult {
  const applicable = wiApplicable(variant)
  if (variant === 'no-goal') {
    const empty: WhatIfMetrics = { annualRunRateAtDeadline: null, revenueFirst12m: null, timeToGoalMonths: null, minCash: null, cashGapMonth: null, fundingNeed: null, ebitdaFirst12m: null }
    return {
      modelVersion: 'pb-model-1', level: 0, computedAt: GENERATED_AT, baseline: empty, changed: empty, delta: {}, contributions: [], interaction: {},
      series: { months: [], baseline: [], changed: [], target: null }, explanation: [], riskFlags: [], assumptions: [], warnings: [], applicable,
    }
  }
  const level = variant === 'level2' ? 2 : 1
  const base = wiRun(variant, [])
  const all = wiRun(variant, changes)
  const delta = wiDelta(base.metrics, all.metrics)
  const parts = changes.map((c) => ({ kind: c.kind, label: WHATIF_LABELS[c.kind], delta: wiDelta(base.metrics, wiRun(variant, [c]).metrics) }))
  const interaction: WhatIfResult['delta'] = {}
  for (const key of Object.keys(delta) as Array<keyof WhatIfMetrics>) {
    const sum = parts.reduce<number | null>((a, p) => (a === null || typeof p.delta[key] !== 'number' ? null : a + (p.delta[key] as number)), 0)
    const whole = delta[key]
    if (parts.length > 1) interaction[key] = typeof whole === 'number' && sum !== null ? whole - sum : null
  }
  if (parts.length <= 1) for (const key of Object.keys(delta) as Array<keyof WhatIfMetrics>) interaction[key] = changes.length ? 0 : null

  const explanation: string[] = []
  const riskFlags: string[] = []
  const assumptions: string[] = ['Рычаги меняются линейно за 12 месяцев (профиль «Умеренный»).', `Горизонт расчёта — ${WI_HORIZON} месяца: срок цели плюс 12 месяцев.`]
  for (const c of changes) {
    if (c.kind === 'conversion') {
      explanation.push(`Конверсия ${c.pp > 0 ? '+' : ''}${c.pp} п.п. при текущих 12 % даёт в ${((WI_CONVERSION0 + c.pp / 100) / WI_CONVERSION0).toFixed(2).replace('.', ',')} раза больше оплат на плато; эффект набирается за 12 месяцев.`)
      assumptions.push('Конверсия сейчас 12 %: она растёт к новому уровню постепенно и не выше 60 %.')
    } else if (c.kind === 'revenue_shock') {
      const lost = Math.round(wiRun(variant, []).rr.slice(c.startMonth, c.startMonth + c.durationMonths).reduce((a, v, i) => a + (v - wiRun(variant, [c]).rr[c.startMonth + i]) / 12, 0))
      explanation.push(`Падение выручки на ${Math.abs(c.pct)} % на ${c.durationMonths} мес. с месяца ${c.startMonth}: за это время недополучено около ${fmtMoney(lost)}, а расходы остаются прежними.`)
      assumptions.push('При падении выручки затраты не меняются; себестоимость пропорциональна выручке.')
    }
  }
  if (all.metrics.cashGapMonth !== null) riskFlags.push(`Кассовый разрыв в месяце ${all.metrics.cashGapMonth}: денег не хватает на текущие расходы.`)
  if (all.metrics.fundingNeed !== null && all.metrics.fundingNeed > 0) riskFlags.push(`Нужно финансирование около ${fmtMoney(all.metrics.fundingNeed)}, чтобы удержать резерв.`)
  const bt = base.metrics.timeToGoalMonths
  const ct = all.metrics.timeToGoalMonths
  if (bt !== null && (ct === null || ct > bt)) riskFlags.push('Срок достижения цели сдвигается позже.')
  if (all.metrics.annualRunRateAtDeadline !== null && all.metrics.annualRunRateAtDeadline < GOAL) riskFlags.push(`К сроку цели годовая выручка (${fmtMoney(all.metrics.annualRunRateAtDeadline)}) ниже цели (${fmtMoney(GOAL)}).`)
  if (level === 2) assumptions.push('Деньги в предпросмотре считаются упрощённо: расходы постоянные, налог и оборотный капитал не учтены.')

  return {
    modelVersion: level === 2 ? 'pb-model-2' : 'pb-model-1', level, computedAt: GENERATED_AT,
    baseline: base.metrics, changed: all.metrics, delta, contributions: parts, interaction,
    series: { months: Array.from({ length: WI_HORIZON + 1 }, (_, i) => i), baseline: base.rr, changed: all.rr, target: GOAL },
    explanation, riskFlags, assumptions,
    warnings: variant === 'stale-base' ? ['Выручка за 2024 год устарела: расчёт идёт от неё.'] : [],
    applicable,
  }
}

/** The saved list of the preview: one proposed to the expert, one not. */
export function fixtureWhatIfSaved(variant: PointBFixtureVariant): SavedWhatIf[] {
  const mk = (id: string, name: string, note: string | null, changes: WhatIfChange[], proposedAt: string | null, createdAt: string): SavedWhatIf => {
    const r = fixtureWhatIf(variant, changes)
    return { id, name, note, changes, summary: { level: r.level, delta: r.delta }, modelVersion: r.modelVersion, proposedAt, createdAt }
  }
  if (variant === 'no-goal') return []
  const conversion: WhatIfChange[] = [{ kind: 'conversion', pp: 2 }]
  const shock: WhatIfChange[] = variant === 'stale-base' ? fixtureWhatIfChanges(variant) : [{ kind: 'revenue_shock', pct: -40, startMonth: 2, durationMonths: 4 }]
  if (variant === 'stale-base') return [mk('fx-wi-1', 'Стресс: просадка на 3 месяца', null, shock, null, '2026-10-16T08:00:00.000Z')]
  return [
    mk('fx-wi-1', 'Рост конверсии на 2 п.п.', 'После запуска нового скрипта продаж', conversion, '2026-10-17T10:00:00.000Z', '2026-10-16T08:00:00.000Z'),
    mk('fx-wi-2', 'Стресс: выручка −40 % на 4 месяца', null, shock, null, '2026-10-17T08:30:00.000Z'),
  ]
}


// ── Strategy and roadmap (plan Ф5): a consistent tree built by hand, no real modules ─────────────────

const SK = {
  s1: 'a1000001-0000-4000-8000-000000000001', s2: 'a1000002-0000-4000-8000-000000000002',
  i1: 'b1000001-0000-4000-8000-000000000001', i2: 'b1000002-0000-4000-8000-000000000002',
  i3: 'b1000003-0000-4000-8000-000000000003', i4: 'b1000004-0000-4000-8000-000000000004',
  t1: 'c1000001-0000-4000-8000-000000000001', t2: 'c1000002-0000-4000-8000-000000000002', t3: 'c1000003-0000-4000-8000-000000000003',
  t4: 'c1000004-0000-4000-8000-000000000004', t5: 'c1000005-0000-4000-8000-000000000005', t6: 'c1000006-0000-4000-8000-000000000006',
  t7: 'c1000007-0000-4000-8000-000000000007', t8: 'c1000008-0000-4000-8000-000000000008',
  m1: 'd1000001-0000-4000-8000-000000000001', m2: 'd1000002-0000-4000-8000-000000000002', m3: 'd1000003-0000-4000-8000-000000000003',
} as const

type NodePatch = Partial<StrategyNode> & Pick<StrategyNode, 'key' | 'kind' | 'parentKey' | 'title'>
const node = (n: NodePatch, order: number): StrategyNode => ({
  description: null, ownerLabel: null, dueDate: null, impact: null, effort: null, metricId: null, block: null, kpi: null, dependsOn: [], delayRisk: null, order, ...n,
})

/**
 * The strategy of the preview: 2 strategies, 4 initiatives (one without ratings and without tasks), 8 tasks across three
 * quarters (IV 2026 – II 2027), 3 milestones, one dependency (CRM waits for the loyalty programme).
 */
export function fixtureStrategyTree(): PlanStrategy {
  return {
    items: [
      node({ key: SK.s1, kind: 'strategy', parentKey: null, title: 'Рост выручки за счёт повторных продаж', description: 'Довести долю повторных покупок до трети оборота и перестать терять клиентов после первой сделки.', impact: 5, effort: 3, kpi: { name: 'Доля повторных покупок', target: 30, unit: '%' }, dueDate: '2027-06-30' }, 0),
      node({ key: SK.i1, kind: 'initiative', parentKey: SK.s1, title: 'Программа лояльности', description: 'Бонусы за повторную покупку и персональные предложения.', ownerLabel: 'Маркетолог', impact: 4, effort: 2, block: 'sales', kpi: { name: 'Участники программы', target: 200, unit: 'чел.' }, dueDate: '2027-03-31', delayRisk: 'Нужна интеграция с кассой — без неё бонусы считаются вручную.' }, 0),
      node({ key: SK.t1, kind: 'task', parentKey: SK.i1, title: 'Описать условия программы', ownerLabel: 'Маркетолог', dueDate: '2026-11-15' }, 0),
      node({ key: SK.t2, kind: 'task', parentKey: SK.i1, title: 'Настроить рассылки для участников', ownerLabel: 'Маркетолог', dueDate: '2026-12-20' }, 1),
      node({ key: SK.t3, kind: 'task', parentKey: SK.i1, title: 'Запустить пилот в двух точках', ownerLabel: 'Управляющий', dueDate: '2027-02-10', description: 'Пилот на 6 недель с еженедельным разбором результатов.' }, 2),
      node({ key: SK.i2, kind: 'initiative', parentKey: SK.s1, title: 'Автоматизация работы с клиентской базой (CRM)', ownerLabel: 'Руководитель продаж', impact: 4, effort: 4, dependsOn: [SK.i1], dueDate: '2027-04-30', kpi: { name: 'Клиентов в базе с историей покупок', target: 90, unit: '%' } }, 1),
      node({ key: SK.t4, kind: 'task', parentKey: SK.i2, title: 'Выбрать систему и подрядчика', ownerLabel: 'Руководитель продаж', dueDate: '2026-12-15' }, 0),
      node({ key: SK.t5, kind: 'task', parentKey: SK.i2, title: 'Перенести клиентскую базу', ownerLabel: 'Руководитель продаж', dueDate: '2027-03-15' }, 1),
      node({ key: SK.s2, kind: 'strategy', parentKey: null, title: 'Меньше зависимости от одного канала', description: 'Сейчас почти все заявки приходят из одного источника.', impact: 3, effort: 2 }, 1),
      node({ key: SK.i3, kind: 'initiative', parentKey: SK.s2, title: 'Тест двух новых каналов привлечения', ownerLabel: 'Маркетолог', impact: 3, effort: 3, kpi: { name: 'Стоимость заявки', target: 2500, unit: '₸' }, dueDate: '2027-02-28' }, 0),
      node({ key: SK.t6, kind: 'task', parentKey: SK.i3, title: 'Подобрать каналы и бюджеты', ownerLabel: 'Маркетолог', dueDate: '2026-11-30' }, 0),
      node({ key: SK.t7, kind: 'task', parentKey: SK.i3, title: 'Запустить тест на 6 недель', ownerLabel: 'Маркетолог', dueDate: '2027-01-31' }, 1),
      node({ key: SK.i4, kind: 'initiative', parentKey: SK.s2, title: 'Пересмотр прайса', description: 'Идея на проработку: оценки и задач пока нет.' }, 1),
      node({ key: SK.t8, kind: 'task', parentKey: SK.i1, title: 'Разобрать итоги пилота и поправить условия', ownerLabel: 'Маркетолог', dueDate: '2027-05-20' }, 3),
    ],
    milestones: [
      { key: SK.m1, title: 'Пилот программы лояльности запущен', date: '2027-01-15', description: 'Первые клиенты получают бонусы.', kpi: 'не менее 200 участников' },
      { key: SK.m2, title: 'CRM принята в работу', date: '2027-03-31', description: null, kpi: null },
      { key: SK.m3, title: 'Итог полугодия: повторные покупки', date: '2027-06-30', description: 'Сверка доли повторных покупок с целью.', kpi: '30% оборота' },
    ],
  }
}

/** Statuses of the tasks in the action plan for the preview. */
const FX_TASK_STATUS: Record<string, 'open' | 'in_progress' | 'done'> = {
  [SK.t1]: 'done', [SK.t2]: 'in_progress', [SK.t3]: 'open', [SK.t4]: 'open', [SK.t5]: 'open', [SK.t6]: 'done', [SK.t7]: 'in_progress', [SK.t8]: 'open',
}

/** What `plan.strategy` of the page state looks like for the approved fixture plan (hand-built; the server computes it for real). */
export function fixtureStrategy(): PointBStrategyState {
  const { items, milestones } = fixtureStrategyTree()
  const progress: Record<string, NodeProgress> = {}
  const tasksUnder = (key: string): StrategyNode[] => {
    const own = items.filter((n) => n.parentKey === key)
    return own.flatMap((n) => (n.kind === 'task' ? [n] : tasksUnder(n.key)))
  }
  for (const n of items) {
    const tasks = n.kind === 'task' ? [n] : tasksUnder(n.key)
    const st = tasks.map((t) => FX_TASK_STATUS[t.key])
    const done = st.filter((x) => x === 'done').length
    const inProgress = st.filter((x) => x === 'in_progress').length
    progress[n.key] = {
      key: n.key,
      tasks: tasks.length,
      done,
      inProgress,
      percent: tasks.length === 0 ? null : Math.round((done / tasks.length) * 100),
      state: tasks.length === 0 ? 'no_tasks' : done === tasks.length ? 'done' : done === 0 && inProgress === 0 ? 'not_started' : 'in_progress',
    }
  }
  const quadrant = (i: number, e: number): MatrixPoint['quadrant'] => (i >= 3 ? (e <= 3 ? 'quick_wins' : 'big_bets') : e <= 3 ? 'fill_ins' : 'avoid')
  const rated = items.filter((n) => n.kind !== 'task')
  const points: MatrixPoint[] = rated.flatMap((n) => (n.impact !== null && n.effort !== null
    ? [{ key: n.key, title: n.title, kind: n.kind as 'strategy' | 'initiative', impact: n.impact, effort: n.effort, quadrant: quadrant(n.impact, n.effort) }]
    : []))
  return { items, milestones, progress, matrix: { points, unrated: rated.filter((n) => n.kind === 'initiative').length - points.filter((q) => q.kind === 'initiative').length } }
}
