/**
 * lib/metrics/catalog-helpers.ts — pure helpers for /api/v1/metrics/catalog.
 *
 * Kept free of Supabase so they can be unit-tested:
 *   • countByNamespace — tab-bar totals (E2E bug #8: inactive tabs showed 0).
 *   • applyGriSectionScores — fill the 7 GRI block metrics from the latest
 *     GRI assessment (E2E bug #7: catalog said «Нет данных» while /gri showed
 *     7.4–9.0). GRI blocks are scored by the assessment, never by the
 *     survey/document resolver, so the generic materialization can't fill them.
 */

import type { MetricNamespace } from '@/lib/metrics/types'

/** Catalog label (GRI_BLOCK_DESCRIPTIONS key) → gri_assessments.section_avgs key. */
export const GRI_SECTION_BY_LABEL: Readonly<Record<string, string>> = {
  'Продукт и спрос': 'product-demand',
  'Доверие и позиция': 'trust-positioning',
  'Бизнес-модель': 'business-model',
  'Стабильность кассы': 'cash-stability',
  'Операции': 'operations',
  'Команда': 'team',
  'Готовность основателя': 'owner-readiness',
}

export const GRI_SCORE_UNIT = 'из 10'

export function countByNamespace<T extends { namespace: MetricNamespace | string }>(
  entries: ReadonlyArray<T>,
): Record<'all' | 'biz' | 'kpi' | 'gri' | 'goal', number> {
  const counts = { all: 0, biz: 0, kpi: 0, gri: 0, goal: 0 }
  for (const e of entries) {
    counts.all += 1
    if (e.namespace in counts) counts[e.namespace as keyof typeof counts] += 1
  }
  return counts
}

export interface GriOverlayItem {
  namespace: string
  label: string
  value: number | string | null
  unit: string
  confidence: number | null
  source: string | null
  computedAt: string | null
  fresh: boolean
}

export interface GriAssessmentLike {
  section_avgs: Record<string, unknown> | null
  created_at: string | null
}

/**
 * Returns a new item list where GRI items without a resolved value carry the
 * section average from `assessment`. Items with a real materialized value are
 * left untouched. Scores are 0–10; zero means "not scored" and is skipped.
 */
export function applyGriSectionScores<T extends GriOverlayItem>(
  items: ReadonlyArray<T>,
  assessment: GriAssessmentLike | null,
  freshWindowMs: number,
  now: Date = new Date(),
): T[] {
  const avgs = assessment?.section_avgs
  if (!avgs || typeof avgs !== 'object') return [...items]
  const createdAt = assessment?.created_at ?? null
  const ts = createdAt ? Date.parse(createdAt) : NaN
  const fresh = Number.isFinite(ts) && now.getTime() - ts <= freshWindowMs

  return items.map((item) => {
    if (item.namespace !== 'gri' || item.value !== null) return item
    const sectionId = GRI_SECTION_BY_LABEL[item.label]
    if (!sectionId) return item
    const raw = avgs[sectionId]
    const score = typeof raw === 'number' ? raw : Number(raw)
    if (!Number.isFinite(score) || score <= 0) return item
    return {
      ...item,
      value: Math.round(score * 100) / 100,
      unit: GRI_SCORE_UNIT,
      confidence: 0.9,
      source: 'gri_assessment',
      computedAt: createdAt,
      fresh,
    }
  })
}
