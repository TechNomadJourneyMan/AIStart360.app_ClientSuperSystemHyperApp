import type { PointA, BlockScore } from '@/types/onboarding'
import type { PointBOptions } from './engine'

/**
 * lib/point-b/adapters.ts — the ONE copy of the data adapters Point B needs.
 *
 * Before this module `diagToPointA` / `mapGriTop5` were copied into five
 * routes; every consumer (client, AI, expert, GIGA, share link, PDF) now
 * imports them from here (lib/admin/expert-client-data.ts re-exports them).
 */

const EMPTY_BLOCK: BlockScore = { score: 0, status: 'critical', top_issues: [], recommendations: [] }

/** Строка diagnostics → PointA для движка Точки Б (отсутствующий блок — пустой, не ошибка). */
export function diagToPointA(diag: Record<string, unknown>): PointA {
  const block = (k: string): BlockScore => {
    const v = diag[k] as BlockScore | null
    return v && typeof v === 'object' ? v : EMPTY_BLOCK
  }
  return {
    overall_score: (diag.overall_score as number) ?? 0,
    health_index: (diag.health_index as number) ?? 0,
    stage: (diag.stage as PointA['stage']) ?? 'seed',
    blocks: {
      finance: block('finance_score'),
      marketing: block('marketing_score'),
      operations: block('operations_score'),
      strategy: block('strategy_score'),
      sales: block('sales_score'),
    },
    risks: (diag.risks as PointA['risks']) ?? [],
    insights: (diag.insights as PointA['insights']) ?? [],
    quick_wins: (diag.quick_wins as PointA['quick_wins']) ?? [],
    data_gaps: (diag.data_gaps as PointA['data_gaps']) ?? [],
  }
}

/** gri_assessments.top_5_limits → формат движка Точки Б. */
export function mapGriTop5(raw: unknown): PointBOptions['griTop5'] {
  if (!Array.isArray(raw)) return undefined
  return raw
    .map((item, i) => {
      if (!item || typeof item !== 'object') return null
      const o = item as Record<string, unknown>
      const title = String(o.title ?? o.label ?? o.name ?? o.criterion ?? '').trim()
      if (!title) return null
      return {
        rank: typeof o.rank === 'number' ? o.rank : i + 1,
        title,
        block: String(o.block ?? o.section ?? o.sectionId ?? ''),
        severity: String(o.severity ?? o.level ?? 'high'),
      }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
}
