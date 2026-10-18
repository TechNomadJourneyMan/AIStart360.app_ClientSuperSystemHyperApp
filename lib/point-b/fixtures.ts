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
