import type { PointA, DiagnosticStage } from '@/types/onboarding'

/**
 * Point B engine (v2) — goal-driven.
 *
 * Unlike the legacy heuristic (target = current × stage-multiplier), this engine
 * builds the bridge from the business's REAL current revenue to the owner's REAL
 * stated goals captured in the survey (s1_goal_12m_revenue_*, s1_goal_3y_revenue_*).
 * It never fabricates a target — when a goal or current revenue is missing it
 * returns nulls and reports the gap honestly via {@link dataSufficiency}.
 *
 * Pure & deterministic (except generated_at) → fully unit-testable.
 */

// ─── Types ─────────────────────────────────────────────────────────────────

export interface PointBGoals {
  current_revenue_year: number | null
  current_revenue_month: number | null
  goal_12m_revenue_year: number | null
  goal_12m_revenue_month: number | null
  goal_3y_revenue_year: number | null
  goal_3y_revenue_month: number | null
  goal_12m_text: string
  goal_3y_text: string
  main_pain: string
  growth_blockers: string[]
  avg_check_target: number | null
}

export interface GapMetrics {
  gap_absolute: number | null
  gap_percent: number | null
  multiplier: number | null
  required_cagr: number | null        // annualized %, e.g. 115.44
  required_mom_growth: number | null  // month-over-month %
  required_qoq_growth: number | null  // quarter-over-quarter %
  months: number
  data_complete: boolean
}

export interface GapEntry extends GapMetrics {
  horizon: '12m' | '3y'
  current_revenue: number | null
  target_revenue: number | null
}

export interface TrajectoryPoint {
  month: number
  target_revenue: number
}

export interface Scenario {
  key: 'cautious' | 'base' | 'aggressive'
  label: string
  target_revenue_12m: number | null
  target_revenue_3y: number | null
  assumptions: string[]
  confidence: 'low' | 'medium' | 'high'
}

export interface Realism {
  score: number // 0-100 confidence in achievability
  level: 'realistic' | 'ambitious' | 'aggressive' | 'unrealistic' | 'unknown'
  rationale: string[]
  risk_factors: string[]
  weak_blocks: string[]
}

export interface DataSufficiency {
  sufficient: boolean
  confidence: number // 0-100
  missing: string[]
  have: string[]
}

export interface Lever {
  key: string
  label: string
  current: number | string | null
  target: number | string | null
  unit: string
  expected_effect: string
  difficulty: 'low' | 'medium' | 'high'
  priority: number
  linked_block: string
  data_available: boolean
}

export interface HorizonPlan {
  horizon: 'three_year' | 'one_year' | 'quarter' | 'month' | 'week'
  title: string
  target_revenue: number | null
  target_overall_score: number | null
  focus: string[]
  actions: string[]
  kpis: { label: string; target: string }[]
}

export interface TargetBlock {
  current: number
  target: number
  gap: number
  priority: 'critical' | 'high' | 'medium' | 'low'
  effort: string
}

export interface PointBV2 {
  diagnostic_id: string | null
  generated_at: string

  goals: PointBGoals
  gap: GapEntry[]
  realism: Realism
  data_sufficiency: DataSufficiency

  trajectory: {
    monthly_12m: TrajectoryPoint[]
    quarterly_3y: TrajectoryPoint[]
  }
  scenarios: Scenario[]
  levers: Lever[]

  target_blocks: Record<string, TargetBlock>
  target_overall_score: number
  target_health_index: number
  target_stage: string

  horizons: {
    three_year: HorizonPlan
    one_year: HorizonPlan
    quarter: HorizonPlan
    month: HorizonPlan
    week: HorizonPlan
  }

  top5_limits: { rank: number; title: string; block: string; severity: string }[]

  ai_strategy: Record<string, unknown> | null
  ai_status: 'none' | 'processing' | 'completed' | 'failed'
}

export interface PointBOptions {
  diagnosticId?: string | null
  griWeakBlocks?: string[]
  griTop5?: { rank?: number; title: string; block?: string; severity?: string }[]
  /**
   * Current annual revenue from the metrics layer (public.metrics → 'revenue').
   * Used when the survey version did not capture revenue (e.g. the s1_* survey
   * stores goals but no current revenue). Survey value takes precedence.
   */
  currentRevenueYear?: number | null
}

// ─── Block metadata ────────────────────────────────────────────────────────

const BLOCK_KEYS = ['finance', 'sales', 'operations', 'marketing', 'strategy'] as const
const BLOCK_LABELS: Record<string, string> = {
  finance: 'Финансы', sales: 'Продажи', operations: 'Операции',
  marketing: 'Маркетинг', strategy: 'Стратегия',
}

// ─── Numeric coercion helpers ─────────────────────────────────────────────

/** Coerce to a finite positive number, else null. Accepts numeric strings. */
function posNum(v: unknown): number | null {
  if (v == null) return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^\d.-]/g, ''))
  return Number.isFinite(n) && n > 0 ? n : null
}

/** First positive number among the given answer keys. */
function firstPos(answers: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const n = posNum(answers[k])
    if (n != null) return n
  }
  return null
}

function str(v: unknown): string {
  return v == null ? '' : String(v)
}

// ─── parseGoals ──────────────────────────────────────────────────────────

export function parseGoals(answers: Record<string, unknown>): PointBGoals {
  const currentYear = firstPos(answers, [
    's2_revenue_2025', 's2_revenue_2024', 's9n_revenue_2024', 's2_revenue_2023',
  ])

  const g12yRaw = posNum(answers.s1_goal_12m_revenue_year)
  const g12mRaw = posNum(answers.s1_goal_12m_revenue_month)
  const g3yRaw = posNum(answers.s1_goal_3y_revenue_year)
  const g3mRaw = posNum(answers.s1_goal_3y_revenue_month)

  const goal12y = g12yRaw ?? (g12mRaw != null ? g12mRaw * 12 : null)
  const goal12m = g12mRaw ?? (g12yRaw != null ? Math.round(g12yRaw / 12) : null)
  const goal3y = g3yRaw ?? (g3mRaw != null ? g3mRaw * 12 : null)
  const goal3m = g3mRaw ?? (g3yRaw != null ? Math.round(g3yRaw / 12) : null)

  const blockers = Array.isArray(answers.s6_growth_blockers)
    ? (answers.s6_growth_blockers as unknown[]).map(String)
    : []

  return {
    current_revenue_year: currentYear,
    current_revenue_month: currentYear != null ? Math.round(currentYear / 12) : null,
    goal_12m_revenue_year: goal12y,
    goal_12m_revenue_month: goal12m,
    goal_3y_revenue_year: goal3y,
    goal_3y_revenue_month: goal3m,
    goal_12m_text: str(answers.s2n_goal_12m_what || answers.s6_goal_12months),
    goal_3y_text: str(answers.s2n_goal_3y_what || answers.s6_goal_3years),
    main_pain: str(answers.s6_main_pain),
    growth_blockers: blockers,
    avg_check_target: posNum(answers.s7_avg_check_target_kzt),
  }
}

// ─── computeGap ──────────────────────────────────────────────────────────

export function computeGap(
  current: number | null,
  target: number | null,
  months: number,
): GapMetrics {
  if (current == null || current <= 0 || target == null || target <= 0) {
    return {
      gap_absolute: null, gap_percent: null, multiplier: null,
      required_cagr: null, required_mom_growth: null, required_qoq_growth: null,
      months, data_complete: false,
    }
  }
  const multiplier = target / current
  const years = months / 12
  const quarters = months / 3
  return {
    gap_absolute: target - current,
    gap_percent: ((target - current) / current) * 100,
    multiplier,
    required_cagr: (Math.pow(multiplier, 1 / years) - 1) * 100,
    required_mom_growth: (Math.pow(multiplier, 1 / months) - 1) * 100,
    required_qoq_growth: (Math.pow(multiplier, 1 / quarters) - 1) * 100,
    months,
    data_complete: true,
  }
}

// ─── buildTrajectory ─────────────────────────────────────────────────────

export function buildTrajectory(
  current: number | null,
  target: number | null,
  months: number,
): TrajectoryPoint[] {
  if (current == null || current <= 0 || target == null || target <= 0 || months <= 0) return []
  const g = Math.pow(target / current, 1 / months) // monthly growth factor
  const out: TrajectoryPoint[] = []
  for (let i = 1; i <= months; i++) {
    out.push({ month: i, target_revenue: Math.round(current * Math.pow(g, i)) })
  }
  return out
}

// ─── buildScenarios ──────────────────────────────────────────────────────

export function buildScenarios(
  current: number | null,
  goal12m: number | null,
  goal3y: number | null,
): Scenario[] {
  const lerp = (goal: number | null, factor: number): number | null => {
    if (current == null || current <= 0 || goal == null) return null
    return Math.round(current + (goal - current) * factor)
  }
  const haveGoal = goal12m != null || goal3y != null
  const conf = (c: 'low' | 'medium' | 'high'): 'low' | 'medium' | 'high' =>
    current != null && haveGoal ? c : 'low'

  return [
    {
      key: 'cautious',
      label: 'Осторожный',
      target_revenue_12m: lerp(goal12m, 0.6),
      target_revenue_3y: lerp(goal3y, 0.6),
      assumptions: [
        'Рост за счёт текущих ресурсов без существенных вложений',
        'Закрываются 1–2 ключевых ограничения роста',
      ],
      confidence: conf('medium'),
    },
    {
      key: 'base',
      label: 'Базовый (заявленная цель)',
      target_revenue_12m: goal12m,
      target_revenue_3y: goal3y,
      assumptions: [
        'Достижение заявленной цели при текущей траектории',
        'Закрытие приоритетных ограничений из GRI и плана действий',
      ],
      confidence: conf('medium'),
    },
    {
      key: 'aggressive',
      label: 'Агрессивный',
      target_revenue_12m: lerp(goal12m, 1.3),
      target_revenue_3y: lerp(goal3y, 1.3),
      assumptions: [
        'Усиление команды и маркетинга, выход в новые каналы/сегменты',
        'Дополнительные инвестиции в рост',
      ],
      confidence: conf('low'),
    },
  ]
}

// ─── assessRealism ───────────────────────────────────────────────────────

const LEVEL_ORDER = ['realistic', 'ambitious', 'aggressive', 'unrealistic'] as const
type RealLevel = (typeof LEVEL_ORDER)[number]
const LEVEL_SCORE: Record<RealLevel, number> = {
  realistic: 85, ambitious: 65, aggressive: 40, unrealistic: 20,
}

export function assessRealism(
  pointA: PointA,
  gap3y: GapMetrics,
  extraWeakBlocks: string[] = [],
): Realism {
  const weakFromScores = BLOCK_KEYS.filter((k) => (pointA.blocks[k]?.score ?? 0) < 50)
  const weak_blocks = Array.from(new Set([...weakFromScores, ...extraWeakBlocks]))

  if (!gap3y.data_complete || gap3y.required_cagr == null) {
    return {
      score: 0,
      level: 'unknown',
      rationale: ['Недостаточно данных для оценки реалистичности: нет текущей выручки или цели.'],
      risk_factors: [],
      weak_blocks,
    }
  }

  const cagr = gap3y.required_cagr
  let level: RealLevel =
    cagr <= 20 ? 'realistic' : cagr <= 50 ? 'ambitious' : cagr <= 100 ? 'aggressive' : 'unrealistic'

  // Penalty: weak foundational blocks make an ambitious goal harder.
  if (weak_blocks.length >= 2) {
    const idx = Math.min(LEVEL_ORDER.indexOf(level) + 1, LEVEL_ORDER.length - 1)
    level = LEVEL_ORDER[idx]
  }

  const rationale: string[] = [
    `Для достижения цели нужен среднегодовой рост ~${cagr.toFixed(0)}% (CAGR).`,
  ]
  if (weak_blocks.length > 0) {
    rationale.push(
      `Слабые блоки, угрожающие цели: ${weak_blocks.map((b) => BLOCK_LABELS[b] ?? b).join(', ')}.`,
    )
  }

  const risk_factors: string[] = []
  if (cagr > 50) risk_factors.push('Высокий требуемый темп роста — риск кассовых разрывов при масштабировании.')
  for (const b of weak_blocks) {
    risk_factors.push(`Блок «${BLOCK_LABELS[b] ?? b}» не выдержит рост без укрепления.`)
  }

  const score = Math.max(0, Math.min(100, LEVEL_SCORE[level] - 5 * weak_blocks.length))
  return { score, level, rationale, risk_factors, weak_blocks }
}

// ─── dataSufficiency ─────────────────────────────────────────────────────

export function dataSufficiency(goals: PointBGoals, pointA: PointA): DataSufficiency {
  const missing: string[] = []
  const have: string[] = []

  if (goals.current_revenue_year != null) have.push('Текущая выручка')
  else missing.push('Текущая выручка (анкета, блок «Финансы»)')

  const hasGoal = goals.goal_12m_revenue_year != null || goals.goal_3y_revenue_year != null
  if (hasGoal) have.push('Целевая выручка')
  else missing.push('Целевая выручка — цель на 12 месяцев / 3 года (анкета)')

  if ((pointA.overall_score ?? 0) > 0) have.push('Диагностика Точки А / GRI')
  else missing.push('Диагностика Точки А / GRI')

  if (goals.goal_3y_text || goals.goal_12m_text) have.push('Качественные цели')

  const sufficient = goals.current_revenue_year != null && hasGoal

  // Confidence: full data → high; each missing core input costs 30.
  let confidence = 100
  confidence -= missing.length * 30
  if (!goals.goal_12m_revenue_year || !goals.goal_3y_revenue_year) confidence -= 10
  confidence = Math.max(0, Math.min(100, confidence))

  return { sufficient, confidence, missing, have }
}

// ─── Block targets (foundation scores) ─────────────────────────────────────

function improvementPotential(currentScore: number, stage: string): number {
  const table: Record<string, [number, number][]> = {
    seed:   [[30, 35], [60, 25], [100, 15]],
    early:  [[50, 30], [70, 18], [100, 10]],
    growth: [[60, 25], [80, 12], [100, 7]],
    scale:  [[70, 18], [90, 8], [100, 4]],
    mature: [[80, 10], [100, 5]],
  }
  const ranges = table[stage] ?? table.early
  for (const [threshold, potential] of ranges) {
    if (currentScore < threshold) return potential
  }
  return 5
}

function gapPriority(gap: number): TargetBlock['priority'] {
  if (gap >= 30) return 'critical'
  if (gap >= 20) return 'high'
  if (gap >= 10) return 'medium'
  return 'low'
}

function effortFromGap(gap: number): string {
  if (gap >= 30) return '6-12 месяцев'
  if (gap >= 20) return '3-6 месяцев'
  if (gap >= 10) return '1-3 месяца'
  return '1-2 месяца'
}

function nextStage(current: string): string {
  const order = ['seed', 'early', 'growth', 'scale', 'mature']
  const idx = order.indexOf(current)
  return idx >= 0 && idx < order.length - 1 ? order[idx + 1] : current
}

// ─── Growth levers ─────────────────────────────────────────────────────────

function buildLevers(answers: Record<string, unknown>, goals: PointBGoals): Lever[] {
  const margin = posNum(answers.s2_gross_margin)
  const avgCheck = posNum(answers.s7_avg_check) ?? posNum(answers.s2_avg_check)
  const ltv = posNum(answers.s2_ltv)
  const cac = posNum(answers.s2_cac)

  const defs: Lever[] = [
    {
      key: 'leads', label: 'Количество лидов', current: null, target: null, unit: 'шт/мес',
      expected_effect: 'Прямой рост выручки при стабильной конверсии', difficulty: 'medium',
      priority: 1, linked_block: 'marketing', data_available: false,
    },
    {
      key: 'conversion', label: 'Конверсия в продажу', current: null, target: null, unit: '%',
      expected_effect: 'Больше сделок без роста затрат на привлечение', difficulty: 'medium',
      priority: 2, linked_block: 'sales', data_available: false,
    },
    {
      key: 'avg_check', label: 'Средний чек',
      current: avgCheck, target: goals.avg_check_target, unit: '₸',
      expected_effect: 'Рост выручки и маржи без новых клиентов', difficulty: 'low',
      priority: 3, linked_block: 'sales', data_available: avgCheck != null || goals.avg_check_target != null,
    },
    {
      key: 'repeat', label: 'Повторные продажи / удержание', current: null, target: null, unit: '%',
      expected_effect: 'Рост LTV и снижение зависимости от новых лидов', difficulty: 'medium',
      priority: 4, linked_block: 'sales', data_available: false,
    },
    {
      key: 'cac', label: 'CAC / окупаемость привлечения',
      current: cac, target: cac != null ? Math.round(cac * 0.8) : null, unit: '₸',
      expected_effect: 'Снижение стоимости привлечения повышает маржинальность роста', difficulty: 'high',
      priority: 5, linked_block: 'marketing', data_available: cac != null,
    },
    {
      key: 'margin', label: 'Маржинальность',
      current: margin, target: margin != null ? Math.min(margin + 8, 60) : null, unit: '%',
      expected_effect: 'Больше прибыли с каждой продажи для реинвестиций в рост', difficulty: 'medium',
      priority: 6, linked_block: 'finance', data_available: margin != null,
    },
  ]
  void ltv
  return defs
}

// ─── Horizon plans ───────────────────────────────────────────────────────

function buildHorizons(
  goals: PointBGoals,
  pointA: PointA,
  targetOverall: number,
  monthly12m: TrajectoryPoint[],
  top5: PointBV2['top5_limits'],
): PointBV2['horizons'] {
  const weakOrdered = [...BLOCK_KEYS]
    .sort((a, b) => (pointA.blocks[a]?.score ?? 0) - (pointA.blocks[b]?.score ?? 0))
    .map((k) => BLOCK_LABELS[k])
  const quickWins = (pointA.quick_wins ?? []).map((q) => q.action)
  const top5Titles = top5.map((t) => t.title)

  const month1 = monthly12m[0]?.target_revenue ?? null
  const quarter1 = monthly12m[2]?.target_revenue ?? null

  return {
    three_year: {
      horizon: 'three_year',
      title: 'Стратегический горизонт — 3 года',
      target_revenue: goals.goal_3y_revenue_year,
      target_overall_score: targetOverall,
      focus: weakOrdered.slice(0, 3),
      actions: [
        goals.goal_3y_text ? `Стратегическая цель: ${goals.goal_3y_text}` : 'Сформулировать стратегическую цель на 3 года',
        'Перестроить бизнес-модель под кратный рост',
        ...top5Titles.slice(0, 2).map((t) => `Снять ограничение: ${t}`),
      ],
      kpis: [
        { label: 'Целевая выручка/год', target: goals.goal_3y_revenue_year != null ? `${goals.goal_3y_revenue_year.toLocaleString('ru-RU')} ₸` : '—' },
        { label: 'Целевой GRI', target: `${targetOverall}/100` },
      ],
    },
    one_year: {
      horizon: 'one_year',
      title: 'Годовой план — 12 месяцев',
      target_revenue: goals.goal_12m_revenue_year,
      target_overall_score: targetOverall,
      focus: weakOrdered.slice(0, 2),
      actions: [
        goals.goal_12m_text ? `Годовая цель: ${goals.goal_12m_text}` : 'Зафиксировать цель на 12 месяцев',
        ...top5Titles.slice(0, 3).map((t) => `Закрыть: ${t}`),
      ],
      kpis: [
        { label: 'Целевая выручка/год', target: goals.goal_12m_revenue_year != null ? `${goals.goal_12m_revenue_year.toLocaleString('ru-RU')} ₸` : '—' },
      ],
    },
    quarter: {
      horizon: 'quarter',
      title: 'Квартальный фокус',
      target_revenue: quarter1,
      target_overall_score: null,
      focus: weakOrdered.slice(0, 1),
      actions: top5Titles.slice(0, 2).length ? top5Titles.slice(0, 2).map((t) => `Приоритет квартала: ${t}`) : ['Закрыть критичный блок из GRI'],
      kpis: quarter1 != null ? [{ label: 'Выручка к концу квартала', target: `${quarter1.toLocaleString('ru-RU')} ₸` }] : [],
    },
    month: {
      horizon: 'month',
      title: 'План на месяц',
      target_revenue: month1,
      target_overall_score: null,
      focus: weakOrdered.slice(0, 1),
      actions: quickWins.slice(0, 3).length ? quickWins.slice(0, 3) : ['Запустить первые быстрые улучшения'],
      kpis: month1 != null ? [{ label: 'Выручка за месяц', target: `${month1.toLocaleString('ru-RU')} ₸` }] : [],
    },
    week: {
      horizon: 'week',
      title: 'Ближайшая неделя',
      target_revenue: null,
      target_overall_score: null,
      focus: weakOrdered.slice(0, 1),
      actions: quickWins.slice(0, 2).length
        ? quickWins.slice(0, 2).map((a) => `Начать: ${a}`)
        : ['Проверить ключевые метрики', 'Назначить ответственного за приоритет №1'],
      kpis: [],
    },
  }
}

// ─── Orchestrator ──────────────────────────────────────────────────────────

export function calculatePointBV2(
  pointA: PointA,
  answers: Record<string, unknown>,
  options: PointBOptions = {},
): PointBV2 {
  const goals = parseGoals(answers)

  // Current revenue may be absent from the survey (newer s1_* version captures
  // only goals) — fall back to the metrics-layer value supplied by the caller.
  if (goals.current_revenue_year == null && options.currentRevenueYear != null && options.currentRevenueYear > 0) {
    goals.current_revenue_year = options.currentRevenueYear
    goals.current_revenue_month = Math.round(options.currentRevenueYear / 12)
  }

  const stage: DiagnosticStage = pointA.stage ?? 'seed'
  const cur = goals.current_revenue_year

  // Gaps per horizon
  const gap: GapEntry[] = [
    { horizon: '12m', current_revenue: cur, target_revenue: goals.goal_12m_revenue_year, ...computeGap(cur, goals.goal_12m_revenue_year, 12) },
    { horizon: '3y', current_revenue: cur, target_revenue: goals.goal_3y_revenue_year, ...computeGap(cur, goals.goal_3y_revenue_year, 36) },
  ]
  const gap3y = gap.find((g) => g.horizon === '3y')!

  // Trajectories
  const monthly12m = buildTrajectory(cur, goals.goal_12m_revenue_year, 12)
  const quarterly3yFull = buildTrajectory(cur, goals.goal_3y_revenue_year, 36)
  const quarterly_3y = quarterly3yFull
    .filter((p) => p.month % 3 === 0)
    .map((p) => ({ month: p.month / 3, target_revenue: p.target_revenue }))

  // Block targets (foundation)
  const targetBlocks: Record<string, TargetBlock> = {}
  for (const key of BLOCK_KEYS) {
    const current = pointA.blocks[key]?.score ?? 0
    const target = Math.min(100, current + improvementPotential(current, stage))
    const blockGap = target - current
    targetBlocks[key] = { current, target, gap: blockGap, priority: gapPriority(blockGap), effort: effortFromGap(blockGap) }
  }
  const weights = { finance: 0.30, sales: 0.25, operations: 0.20, marketing: 0.15, strategy: 0.10 }
  const targetOverall = Math.round(BLOCK_KEYS.reduce((s, k) => s + targetBlocks[k].target * weights[k], 0))
  const targetHealth = Math.min(100, Math.round(targetOverall * 0.6 + (targetBlocks.finance.target > 50 ? 20 : 0) + (targetBlocks.sales.target > 50 ? 10 : 0) + (targetBlocks.operations.target > 50 ? 10 : 0)))

  // TOP-5 limits (from GRI if provided, else lowest blocks)
  const top5_limits = options.griTop5?.length
    ? options.griTop5.map((t, i) => ({ rank: t.rank ?? i + 1, title: t.title, block: t.block ?? '', severity: t.severity ?? 'high' }))
    : [...BLOCK_KEYS]
        .sort((a, b) => (pointA.blocks[a]?.score ?? 0) - (pointA.blocks[b]?.score ?? 0))
        .slice(0, 5)
        .map((k, i) => ({ rank: i + 1, title: `Слабый блок: ${BLOCK_LABELS[k]}`, block: k, severity: (pointA.blocks[k]?.score ?? 0) < 40 ? 'critical' : 'high' }))

  const weakBlocks = Array.from(new Set([
    ...BLOCK_KEYS.filter((k) => (pointA.blocks[k]?.score ?? 0) < 50),
    ...(options.griWeakBlocks ?? []),
  ]))

  const realism = assessRealism(pointA, gap3y, options.griWeakBlocks ?? [])
  void weakBlocks

  return {
    diagnostic_id: options.diagnosticId ?? null,
    generated_at: new Date().toISOString(),
    goals,
    gap,
    realism,
    data_sufficiency: dataSufficiency(goals, pointA),
    trajectory: { monthly_12m: monthly12m, quarterly_3y },
    scenarios: buildScenarios(cur, goals.goal_12m_revenue_year, goals.goal_3y_revenue_year),
    levers: buildLevers(answers, goals),
    target_blocks: targetBlocks,
    target_overall_score: targetOverall,
    target_health_index: targetHealth,
    target_stage: nextStage(stage),
    horizons: buildHorizons(goals, pointA, targetOverall, monthly12m, top5_limits),
    top5_limits,
    ai_strategy: null,
    ai_status: 'none',
  }
}
