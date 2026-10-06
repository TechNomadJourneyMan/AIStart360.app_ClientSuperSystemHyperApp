import { describe, it, expect } from 'vitest'
import { getMetricRegistry } from '@/lib/metrics/registry'
import {
  METRIC_CATEGORIES,
  GOAL_TITLES,
  categoryForMetric,
  classifyMetric,
  countByCategory,
  explicitCategoryForMetric,
} from '@/lib/metrics/taxonomy'
import { SURVEY_KEY_STEP } from '@/lib/survey/steps'
import type { MetricCategoryKey } from '@/types/metric-catalog'

const ALL_KEYS: MetricCategoryKey[] = [
  'finance', 'sales', 'marketing', 'customers', 'operations', 'team', 'product',
  'automation', 'ai_maturity', 'digital', 'management', 'growth_goals', 'gri',
]

describe('metric taxonomy', () => {
  const registry = getMetricRegistry()

  it('declares exactly the 13 contract categories with Russian labels', () => {
    expect(METRIC_CATEGORIES.map((c) => c.key).sort()).toEqual([...ALL_KEYS].sort())
    for (const c of METRIC_CATEGORIES) {
      if (c.key !== 'gri') expect(c.label).toMatch(/[А-Яа-яЁё]/)
      expect(c.description.length).toBeGreaterThan(10)
    }
  })

  it('maps EVERY registry metric to exactly one category through the explicit tables', () => {
    const unmapped = registry.filter((e) => explicitCategoryForMetric(e) === null).map((e) => e.id)
    expect(unmapped).toEqual([])
    for (const e of registry) {
      const c = categoryForMetric(e)
      expect(ALL_KEYS).toContain(c)
    }
  })

  it('every category has metrics except the documented empty ones', () => {
    const counts = countByCategory(registry)
    expect(counts.all).toBe(registry.length)
    for (const c of METRIC_CATEGORIES) {
      if (c.emptyReason) {
        expect(counts[c.key], `${c.key} is documented as empty`).toBe(0)
      } else {
        expect(counts[c.key], `${c.key} must not be empty`).toBeGreaterThan(0)
      }
    }
    // Only AI maturity is documented as empty (no survey question about AI yet).
    expect(METRIC_CATEGORIES.filter((c) => c.emptyReason).map((c) => c.key)).toEqual(['ai_maturity'])
  })

  it('namespaces land where the contract says', () => {
    for (const e of registry) {
      if (e.namespace === 'gri') expect(categoryForMetric(e)).toBe('gri')
      if (e.namespace === 'goal') expect(categoryForMetric(e)).toBe('growth_goals')
    }
    const byId = new Map(registry.map((e) => [e.id, e]))
    expect(categoryForMetric(byId.get('biz.hr.enps')!)).toBe('team')
    expect(categoryForMetric(byId.get('biz.klienty.churn_rate')!)).toBe('customers')
    expect(categoryForMetric(byId.get('kpi.obschaya_vyruchka_god')!)).toBe('finance')
    expect(categoryForMetric(byId.get('kpi.posescheniy_sayta_kpi')!)).toBe('digital')
    expect(categoryForMetric(byId.get('kpi.nps_kpi')!)).toBe('customers')
  })

  it('goal metrics carry the Metrics.docx goal as subcategory', () => {
    const goals = registry.filter((e) => e.namespace === 'goal')
    expect(new Set(goals.map((g) => g.goalNumber))).toEqual(new Set(Object.keys(GOAL_TITLES)))
    for (const g of goals) {
      const p = classifyMetric(g)
      expect(p.subcategory?.key).toBe(`goal_${g.goalNumber}`)
      expect(p.subcategory?.label).toContain(GOAL_TITLES[g.goalNumber!])
    }
    const growth = METRIC_CATEGORIES.find((c) => c.key === 'growth_goals')!
    expect(growth.subcategories).toHaveLength(11)
    expect(growth.subcategories![0]).toEqual({ key: 'goal_01', label: '1. Привлечь новых клиентов' })
    expect(classifyMetric(registry.find((e) => e.namespace === 'biz')!).subcategory).toBeNull()
  })

  it('automation / digital / management metrics read only real wizard keys', () => {
    const maturity = registry.filter((e) => ['automation', 'digital', 'management'].includes(categoryForMetric(e)))
    expect(maturity.length).toBeGreaterThanOrEqual(15)
    for (const e of maturity) {
      const surveyKeys = e.sources.flatMap((s) => (s.type === 'survey' && !s.legacy ? [...(s.keys ?? []), ...(s.key ? [s.key] : [])] : []))
      // A metric the questionnaire cannot answer honestly (online-sales share,
      // site visits) reads a document field instead — never an unrelated key.
      const hasDocument = e.sources.some((s) => s.type === 'document')
      expect(surveyKeys.length > 0 || hasDocument, e.id).toBe(true)
      for (const k of surveyKeys) expect(SURVEY_KEY_STEP[k], `${e.id} → ${k}`).toBeDefined()
    }
  })
})
