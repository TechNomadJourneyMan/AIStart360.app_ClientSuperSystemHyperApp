import type { PointA, BlockScore, DiagnosticStage } from '@/types/onboarding'
import type { PointB, TargetBlock, TargetKPI, RoadmapQuarter } from '@/types/point-b'

const BLOCK_KEYS = ['finance', 'sales', 'operations', 'marketing', 'strategy'] as const
const BLOCK_LABELS: Record<string, string> = {
  finance: 'Финансы', sales: 'Продажи', operations: 'Операции',
  marketing: 'Маркетинг', strategy: 'Стратегия',
}

// ── Improvement potential by stage ───────────────────────────────────────────

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

// ── Growth multiplier by stage ───────────────────────────────────────────────

function growthMultiplier(stage: string): number {
  const map: Record<string, number> = {
    seed: 2.5, early: 1.7, growth: 1.4, scale: 1.2, mature: 1.1,
  }
  return map[stage] ?? 1.5
}

// ── Next stage ───────────────────────────────────────────────────────────────

function nextStage(current: string): string {
  const order = ['seed', 'early', 'growth', 'scale', 'mature']
  const idx = order.indexOf(current)
  return idx >= 0 && idx < order.length - 1 ? order[idx + 1] : current
}

// ── Priority from gap ────────────────────────────────────────────────────────

function gapPriority(gap: number): 'critical' | 'high' | 'medium' | 'low' {
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

// ── Main calculation ─────────────────────────────────────────────────────────

export function calculatePointB(
  pointA: PointA,
  answers: Record<string, unknown>,
): PointB {
  const stage = pointA.stage ?? 'seed'

  // 1. Target blocks
  const targetBlocks: Record<string, TargetBlock> = {}
  for (const key of BLOCK_KEYS) {
    const current = pointA.blocks[key]?.score ?? 0
    const potential = improvementPotential(current, stage)
    const target = Math.min(100, current + potential)
    const gap = target - current
    targetBlocks[key] = {
      current,
      target,
      gap,
      priority: gapPriority(gap),
      effort: effortFromGap(gap),
    }
  }

  // 2. Target overall & health
  const weights = { finance: 0.30, sales: 0.25, operations: 0.20, marketing: 0.15, strategy: 0.10 }
  const targetOverall = Math.round(
    BLOCK_KEYS.reduce((sum, k) => sum + targetBlocks[k].target * weights[k], 0)
  )
  const targetHealth = Math.min(100, Math.round(
    targetOverall * 0.6 +
    (targetBlocks.finance.target > 50 ? 20 : 0) +
    (targetBlocks.sales.target > 50 ? 10 : 0) +
    (targetBlocks.operations.target > 50 ? 10 : 0)
  ))
  const targetStage = nextStage(stage)

  // 3. GAP analysis (sorted by gap desc)
  const gapAnalysis = BLOCK_KEYS
    .map(key => ({
      block: key,
      label: BLOCK_LABELS[key],
      current: targetBlocks[key].current,
      target: targetBlocks[key].target,
      gap: targetBlocks[key].gap,
      priority: targetBlocks[key].priority,
      effort: targetBlocks[key].effort,
    }))
    .sort((a, b) => b.gap - a.gap)

  // 4. Target KPIs
  const mult = growthMultiplier(stage)
  const revenue2025 = Number(answers.s2_revenue_2025) || Number(answers.s2_revenue_2024) || 0
  const margin = Number(answers.s2_gross_margin) || 0
  const ltv = Number(answers.s2_ltv) || 0
  const cac = Number(answers.s2_cac) || 1
  const newClients = Number(answers.s2_new_clients_2025) || Number(answers.s2_new_clients_2024) || 0

  const fmtMoney = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M ₸` : n >= 1000 ? `${(n / 1000).toFixed(0)}K ₸` : `${n} ₸`

  const targetKpis: TargetKPI[] = [
    {
      label: 'Выручка',
      current: fmtMoney(revenue2025),
      target: fmtMoney(Math.round(revenue2025 * mult)),
      unit: '₸',
      progress: Math.round((1 / mult) * 100),
    },
    {
      label: 'Маржа',
      current: `${margin.toFixed(1)}%`,
      target: `${Math.min(margin + 8, 60).toFixed(1)}%`,
      unit: '%',
      progress: margin > 0 ? Math.round((margin / Math.min(margin + 8, 60)) * 100) : 0,
    },
    {
      label: 'LTV/CAC',
      current: cac > 0 ? `${(ltv / cac).toFixed(1)}` : '—',
      target: `${Math.max((ltv / cac) * 1.3, 3.0).toFixed(1)}`,
      unit: 'x',
      progress: cac > 0 ? Math.round(((ltv / cac) / Math.max((ltv / cac) * 1.3, 3.0)) * 100) : 0,
    },
    {
      label: 'Health Index',
      current: String(pointA.health_index),
      target: String(targetHealth),
      unit: '/100',
      progress: targetHealth > 0 ? Math.round((pointA.health_index / targetHealth) * 100) : 0,
    },
    {
      label: 'Клиенты',
      current: String(newClients),
      target: String(Math.round(newClients * mult)),
      unit: '',
      progress: newClients > 0 ? Math.round((1 / mult) * 100) : 0,
    },
    {
      label: 'Стадия',
      current: stage.charAt(0).toUpperCase() + stage.slice(1),
      target: targetStage.charAt(0).toUpperCase() + targetStage.slice(1),
      unit: '',
      progress: stage === targetStage ? 100 : 50,
    },
  ]

  // 5. Quarterly roadmap
  const sortedGaps = [...gapAnalysis]
  const q1Focus = sortedGaps.filter(g => g.priority === 'critical').map(g => g.block)
  const q2Focus = sortedGaps.filter(g => g.priority === 'high').map(g => g.block)
  const q3Focus = sortedGaps.filter(g => g.priority === 'medium').map(g => g.block)
  const q4Focus = sortedGaps.filter(g => g.priority === 'low').map(g => g.block)

  const currentOverall = pointA.overall_score
  const stepPerQ = Math.round((targetOverall - currentOverall) / 4)

  const roadmap: RoadmapQuarter[] = [
    {
      quarter: 'Q1',
      title: 'Quick Wins + Критичные блоки',
      focus_blocks: q1Focus.length > 0 ? q1Focus : [sortedGaps[0]?.block ?? 'finance'],
      target_overall: Math.min(100, currentOverall + stepPerQ),
      milestones: pointA.quick_wins?.slice(0, 3).map(qw => qw.action) ?? ['Запустить первые улучшения'],
      expected_improvement: stepPerQ,
    },
    {
      quarter: 'Q2',
      title: 'Масштабирование процессов',
      focus_blocks: q2Focus.length > 0 ? q2Focus : [sortedGaps[1]?.block ?? 'sales'],
      target_overall: Math.min(100, currentOverall + stepPerQ * 2),
      milestones: ['Внедрить систематические процессы', 'Масштабировать работающие каналы'],
      expected_improvement: stepPerQ,
    },
    {
      quarter: 'Q3',
      title: 'Оптимизация и рост',
      focus_blocks: q3Focus.length > 0 ? q3Focus : [sortedGaps[2]?.block ?? 'operations'],
      target_overall: Math.min(100, currentOverall + stepPerQ * 3),
      milestones: ['Оптимизировать юнит-экономику', 'Запустить новые инициативы'],
      expected_improvement: stepPerQ,
    },
    {
      quarter: 'Q4',
      title: 'Финализация и подготовка к следующему уровню',
      focus_blocks: q4Focus.length > 0 ? q4Focus : ['strategy'],
      target_overall: targetOverall,
      milestones: ['Достичь целевых показателей', `Подготовиться к стадии ${targetStage}`],
      expected_improvement: stepPerQ,
    },
  ]

  // 6. User goals
  const userGoals = {
    goal_12months: String(answers.s6_goal_12months ?? ''),
    goal_3years: String(answers.s6_goal_3years ?? ''),
    main_pain: String(answers.s6_main_pain ?? ''),
    growth_blockers: Array.isArray(answers.s6_growth_blockers)
      ? (answers.s6_growth_blockers as string[])
      : [],
  }

  return {
    diagnostic_id: null,
    horizon_months: 12,
    target_overall_score: targetOverall,
    target_health_index: targetHealth,
    target_stage: targetStage,
    target_blocks: targetBlocks,
    target_kpis: targetKpis,
    gap_analysis: gapAnalysis,
    roadmap,
    user_goals: userGoals,
    ai_strategy: null,
    ai_status: 'none',
    calculated_at: new Date().toISOString(),
  }
}
