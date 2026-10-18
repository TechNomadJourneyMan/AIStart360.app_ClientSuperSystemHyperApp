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
import type { ModelResult, Range, ScenarioResult } from './model/types'

export const POINT_B_FIXTURE_VARIANTS = ['full', 'no-goal', 'stale-base'] as const
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
  if (variant === 'full') {
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
  return {
    modelVersion: 'pb-model-1', computedAt: GENERATED_AT, level: 1, kind: 'funnel', template: 'ecommerce',
    gap: { baseAnnual: BASE_NOW, targetAnnual: GOAL, absolute: GOAL - BASE_NOW, multiplier: Math.round((GOAL / BASE_NOW) * 100) / 100, requiredCagrPct: Math.round((GOAL / BASE_NOW - 1) * 1000) / 10, months: MONTHS_TO_GOAL },
    forecast: { atCurrentPace: { low: Math.round(pace * 0.8), base: pace, high: Math.round(pace * 1.2) }, trendMonthlyPct: trend * 100, basis: 'history' },
    verdict: {
      key: 'behind', headline: 'Отстаём от цели',
      reason: `При текущем темпе к сроку выйдете на ≈${Math.round(pace / 1e6)} млн ₸ при цели ${GOAL / 1e6} млн ₸ (${Math.round((pace / GOAL) * 100)}%).`,
    },
    scenarios: funnelSeeds().map((s) => buildScenario(s, BASE_NOW)),
    missing: [{ key: 'cash', label: 'Данные о деньгах: остатки и платежи', unlocks: 'резерв и нехватка денег по сценариям', level: 2, actions: ['documents', 'expert'] }],
    warnings: [MONEY_NOTE, 'Цель ещё не проверена экспертом.'],
  }
}
