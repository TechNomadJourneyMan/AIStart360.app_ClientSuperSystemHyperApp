// GRI — TOP-5 limitations + 90-day Action Plan (pure functions, no I/O).
//
// Used by app/api/v1/gri/assessment/route.ts to enrich the assessment response
// and by GRI result views. Kept dependency-free so it stays trivially testable.

import type { GriSection, SectionId } from '@/lib/gri-assessment/sections'

// Scores shape posted by the assessment widget:
//   { [sectionId]: { [criterionId]: number 1..10 } }
export type GriScores = Record<string, Record<string, number>>

export interface Top5Limit {
  criterionId: string
  criterionText: string
  blockId: string
  blockName: string
  score: number
}

export type ActionHorizon = '1-30' | '31-60' | '61-90'

export interface ActionCard {
  priority: 'Критично' | 'Высокий' | 'Средний'
  limitation: string
  focus: string
  horizon: ActionHorizon
}

export interface ActionPlan90d {
  days_1_30: ActionCard[]
  days_31_60: ActionCard[]
  days_61_90: ActionCard[]
}

// "Cost of underperformance" ordering — highest cost first. Lower index = higher
// cost, so it wins tie-breaks (a tied criterion in a costlier block ranks worse).
const BLOCK_COST_ORDER: SectionId[] = [
  'operations',
  'business-model',
  'team',
  'trust-positioning',
  'cash-stability',
  'product-demand',
  'owner-readiness',
]

function blockCostRank(blockId: string): number {
  const idx = BLOCK_COST_ORDER.indexOf(blockId as SectionId)
  // Unknown blocks sort last (cheapest).
  return idx === -1 ? BLOCK_COST_ORDER.length : idx
}

/**
 * Ranks every answered criterion ascending by score and returns the 5 lowest.
 * Ties (equal score) are broken by block cost — the costlier block ranks worse
 * (appears earlier). Unanswered criteria (score <= 0 or non-finite) are ignored.
 */
export function computeTop5Limits(
  scores: GriScores,
  sections: GriSection[],
): Top5Limit[] {
  if (!scores || typeof scores !== 'object') return []

  const byBlock = new Map<string, GriSection>()
  const critById = new Map<string, { text: string; blockId: string }>()
  for (const section of sections) {
    byBlock.set(section.id, section)
    for (const crit of section.criteria) {
      critById.set(crit.id, { text: crit.text, blockId: section.id })
    }
  }

  const items: Top5Limit[] = []
  for (const [sectionId, criteria] of Object.entries(scores)) {
    if (!criteria || typeof criteria !== 'object') continue
    const section = byBlock.get(sectionId)
    const blockName = section?.title ?? sectionId
    for (const [criterionId, raw] of Object.entries(criteria)) {
      const score = typeof raw === 'number' ? raw : Number(raw)
      if (!Number.isFinite(score) || score <= 0) continue
      const meta = critById.get(criterionId)
      items.push({
        criterionId,
        criterionText: meta?.text ?? criterionId,
        blockId: sectionId,
        blockName,
        score,
      })
    }
  }

  items.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score
    const costDiff = blockCostRank(a.blockId) - blockCostRank(b.blockId)
    if (costDiff !== 0) return costDiff
    return a.criterionId.localeCompare(b.criterionId)
  })

  return items.slice(0, 5)
}

function horizonForScore(score: number): ActionHorizon {
  if (score <= 3) return '1-30'
  if (score <= 7) return '31-60'
  return '61-90'
}

function priorityForHorizon(horizon: ActionHorizon): ActionCard['priority'] {
  if (horizon === '1-30') return 'Критично'
  if (horizon === '31-60') return 'Высокий'
  return 'Средний'
}

const HORIZON_FOCUS: Record<ActionHorizon, string> = {
  '1-30': 'Устранить красные зоны (критические ограничения роста)',
  '31-60': 'Усилить жёлтые зоны (довести до стабильного уровня)',
  '61-90': 'Масштабировать зелёные зоны (точки роста)',
}

/**
 * Builds a 90-day plan from the TOP-5 limitations plus the per-section averages.
 * Each criterion / block is bucketed by score: <=3 → days 1–30 (red),
 * 4–7 → days 31–60 (yellow), >=8 → days 61–90 (scaling green).
 *
 * TOP-5 limitations seed the early horizons; section averages contribute the
 * scaling cards for blocks that are already strong (>=8) so day 61–90 isn't empty.
 */
export function generate90DayPlan(
  top5: Top5Limit[],
  sectionAvgs: Record<string, number>,
): ActionPlan90d {
  const plan: ActionPlan90d = { days_1_30: [], days_31_60: [], days_61_90: [] }
  const seen = new Set<string>()

  const push = (card: ActionCard, key: string) => {
    if (seen.has(key)) return
    seen.add(key)
    if (card.horizon === '1-30') plan.days_1_30.push(card)
    else if (card.horizon === '31-60') plan.days_31_60.push(card)
    else plan.days_61_90.push(card)
  }

  // 1. Limitations drive the red/yellow work.
  for (const limit of top5) {
    const horizon = horizonForScore(limit.score)
    push(
      {
        priority: priorityForHorizon(horizon),
        limitation: `${limit.criterionText} (${limit.blockName})`,
        focus: HORIZON_FOCUS[horizon],
        horizon,
      },
      `crit:${limit.criterionId}`,
    )
  }

  // 2. Strong blocks (>=8) become scaling cards for days 61–90.
  for (const [blockId, avg] of Object.entries(sectionAvgs ?? {})) {
    if (!Number.isFinite(avg) || avg < 8) continue
    push(
      {
        priority: 'Средний',
        limitation: `Масштабирование блока «${blockId}»`,
        focus: HORIZON_FOCUS['61-90'],
        horizon: '61-90',
      },
      `block:${blockId}`,
    )
  }

  return plan
}
