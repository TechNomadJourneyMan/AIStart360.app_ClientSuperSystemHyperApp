// ============================================================
// lib/metrics/taxonomy.ts
// Presentation categories over the code registry (registry.ts).
// Every registry metric belongs to exactly one category:
//
//   biz.<department>.*  → by department (HR → «Команда и HR»,
//                          Автоматизация / Цифровизация / Управление →
//                          the maturity categories)
//   kpi.*               → by the KPI's own declared category
//                          (Финансы / Рынок / Цифровой / Продукт / …)
//   gri.*               → «GRI»
//   goal.NN.*           → «Цели роста», subcategory = goal NN with the
//                          title from the Metrics.docx methodology
//
// tests/unit/metrics/taxonomy.test.ts fails when a new department / KPI
// category / goal appears without a mapping here.
// ============================================================

import type { MetricCategory, MetricCategoryKey } from '@/types/metric-catalog'
import { getKpiDescription } from './descriptions'
import type { MetricEntry } from './types'

/** Growth goals as titled in Metrics.docx (the methodology source). */
export const GOAL_TITLES: Readonly<Record<string, string>> = {
  '01': 'Привлечь новых клиентов',
  '02': 'Удержать клиентов и сделать их постоянными',
  '03': 'Увеличить средний чек',
  '04': 'Увеличить частоту покупки',
  '05': 'Запустить сарафанное радио',
  '06': 'Забрать клиентов у конкурента',
  '07': 'Создать потребность в продукте',
  '08': 'Ускорить сделку',
  '09': 'Снизить стоимость привлечения (CAC)',
  '10': 'Повысить конверсию в продажи',
  '11': 'Сделать так, чтобы выбрали вас, а не конкурента',
}

export function goalSubcategory(goalNumber: string): { key: string; label: string } {
  const title = GOAL_TITLES[goalNumber]
  const n = Number(goalNumber)
  return {
    key: `goal_${goalNumber}`,
    label: title ? `${Number.isFinite(n) ? n : goalNumber}. ${title}` : `Цель ${goalNumber}`,
  }
}

export const METRIC_CATEGORIES: readonly MetricCategory[] = [
  {
    key: 'finance',
    label: 'Финансы',
    description: 'Выручка, маржа, расходы, дебиторка и денежный поток — финансовое здоровье компании.',
  },
  {
    key: 'sales',
    label: 'Продажи',
    description: 'Средний чек, конверсия и цикл сделки, неявки и пропущенные звонки — как воронка превращает лиды в деньги.',
  },
  {
    key: 'marketing',
    label: 'Маркетинг',
    description: 'Стоимость лида и клиента, поток лидов, NPS и охват — эффективность привлечения.',
  },
  {
    key: 'customers',
    label: 'Клиенты',
    description: 'Активная база, отток, удержание, лояльность и доход с клиента.',
  },
  {
    key: 'operations',
    label: 'Операции',
    description: 'Сроки, SLA, повторяемость процессов, ассортимент и производительность.',
  },
  {
    key: 'team',
    label: 'Команда и HR',
    description: 'Численность, текучесть, вовлечённость и скорость найма.',
  },
  {
    key: 'product',
    label: 'Продукт',
    description: 'Доля рынка, экспорт, онлайн-продажи, ассортимент и сила продукта.',
  },
  {
    key: 'automation',
    label: 'Автоматизация',
    description: 'Какие бизнес-системы работают в компании: CRM, ERP, документооборот, автоматическая отчётность, IT-поддержка (анкета, шаги 4 и 12).',
  },
  {
    key: 'ai_maturity',
    label: 'AI-зрелость',
    description: 'Насколько компания использует искусственный интеллект в продажах, маркетинге и управлении.',
    emptyReason: 'В анкете пока нет вопросов об использовании AI, поэтому метрик в этой категории нет. Они появятся после добавления блока AI-зрелости в анкету или оценки эксперта.',
  },
  {
    key: 'digital',
    label: 'Digital-зрелость',
    description: 'Сайт и соцсети, цифровые каналы маркетинга, рекламные платформы, телефония и BI-аналитика.',
  },
  {
    key: 'management',
    label: 'Управление',
    description: 'Управление по KPI, оргструктура, ритм совещаний, планирование и вовлечённость собственника в операционку.',
  },
  {
    key: 'growth_goals',
    label: 'Цели роста',
    description: '11 целей роста из методики AIStart360 и метрики, по которым видно движение к каждой.',
    // sort(): '10' / '11' are integer-like keys and would otherwise come first.
    subcategories: Object.keys(GOAL_TITLES).sort().map((n) => goalSubcategory(n)),
  },
  {
    key: 'gri',
    label: 'GRI',
    description: 'Индекс готовности к росту: 7 блоков оценки (0–10).',
  },
]


/** biz department label (descriptions.ts) → category. */
export const CATEGORY_BY_DEPARTMENT: Readonly<Record<string, MetricCategoryKey>> = {
  'Финансы': 'finance',
  'Маркетинг': 'marketing',
  'Продажи': 'sales',
  'Операции': 'operations',
  'HR': 'team',
  'Продукт': 'product',
  'Клиенты': 'customers',
  'Автоматизация': 'automation',
  'Цифровизация': 'digital',
  'Управление': 'management',
}

/** KpiDescription.category → category. «Рынок» (market / export share) sits with Продукт, like the biz twins. */
export const CATEGORY_BY_KPI_CATEGORY: Readonly<Record<string, MetricCategoryKey>> = {
  'Финансы': 'finance',
  'Рынок': 'product',
  'Цифровой': 'digital',
  'Продукт': 'product',
  'Продажи': 'sales',
  'Операции': 'operations',
  'Клиенты': 'customers',
  'Маркетинг': 'marketing',
}

const CATEGORY_KEYS = new Set<string>(METRIC_CATEGORIES.map((c) => c.key))

export function isMetricCategoryKey(v: string): v is MetricCategoryKey {
  return CATEGORY_KEYS.has(v)
}

export function getMetricCategory(key: MetricCategoryKey): MetricCategory {
  return METRIC_CATEGORIES.find((c) => c.key === key) as MetricCategory
}

/**
 * The category from the explicit tables, or null when a metric is not covered
 * (new department / KPI category). Tests assert this is never null.
 */
export function explicitCategoryForMetric(entry: MetricEntry): MetricCategoryKey | null {
  switch (entry.namespace) {
    case 'gri':
      return 'gri'
    case 'goal':
      return 'growth_goals'
    case 'biz':
      return (entry.department && CATEGORY_BY_DEPARTMENT[entry.department]) || null
    case 'kpi': {
      const kpiCategory = getKpiDescription(entry.label)?.category ?? ''
      return CATEGORY_BY_KPI_CATEGORY[kpiCategory] ?? null
    }
    default:
      return null
  }
}

/**
 * Category of a registry metric. Never throws: an unmapped metric (only
 * possible if the tables above fall behind descriptions.ts — the unit test
 * catches it) lands in «Операции» rather than breaking the catalog.
 */
export function categoryForMetric(entry: MetricEntry): MetricCategoryKey {
  return explicitCategoryForMetric(entry) ?? 'operations'
}

/** Subcategory: the growth goal for goal.* metrics, null otherwise. */
export function subcategoryForMetric(entry: MetricEntry): { key: string; label: string } | null {
  if (entry.namespace === 'goal' && entry.goalNumber) return goalSubcategory(entry.goalNumber)
  return null
}

export interface MetricPlacement {
  category: MetricCategoryKey
  categoryLabel: string
  subcategory: { key: string; label: string } | null
}

export function classifyMetric(entry: MetricEntry): MetricPlacement {
  const category = categoryForMetric(entry)
  return {
    category,
    categoryLabel: getMetricCategory(category).label,
    subcategory: subcategoryForMetric(entry),
  }
}

/** Number of metrics per category (all 13 keys present, plus `all`). */
export function countByCategory(entries: ReadonlyArray<MetricEntry>): Record<MetricCategoryKey | 'all', number> {
  const out = { all: 0 } as Record<MetricCategoryKey | 'all', number>
  for (const c of METRIC_CATEGORIES) out[c.key] = 0
  for (const e of entries) {
    out.all += 1
    out[categoryForMetric(e)] += 1
  }
  return out
}
