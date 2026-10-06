/**
 * lib/integrations/facts.ts — the facts an integration can write to
 * public.integration_facts (migration 105).
 *
 * A fact is one number for one period of one provider. Flow facts (orders,
 * revenue, sessions …) are written per day, so a re-sync of a day replaces
 * the same row and any window (last 30 days, a calendar month) can be summed
 * from them. Snapshot facts (SKU in the catalogue, SKU in stock) describe the
 * state on the day they were fetched (period_start = period_end = that day).
 *
 * Money units are ISO 4217 codes as the provider states them (KZT, RUB …);
 * 'seller_currency' marks money whose currency the provider does not return
 * (Wildberries statistics: «в валюте продавца») — such values are shown with
 * that caveat and never feed a ₸ metric.
 */

export const FACT_KEYS = [
  'orders_count',
  'orders_amount',
  'sales_count',
  'revenue',
  'returns_count',
  'returns_amount',
  'payout',
  'commission',
  'sku_count',
  'sku_in_stock',
  'sessions',
  'users',
  'web_purchases',
  'web_revenue',
] as const

export type FactKey = (typeof FACT_KEYS)[number]

export type FactKind = 'flow' | 'snapshot'
export type FactUnitKind = 'count' | 'money'

export interface FactDef {
  key: FactKey
  label: string
  kind: FactKind
  unit: FactUnitKind
}

export const FACTS: Readonly<Record<FactKey, FactDef>> = {
  orders_count: { key: 'orders_count', label: 'Заказы', kind: 'flow', unit: 'count' },
  orders_amount: { key: 'orders_amount', label: 'Сумма заказов', kind: 'flow', unit: 'money' },
  sales_count: { key: 'sales_count', label: 'Продажи (выкупы)', kind: 'flow', unit: 'count' },
  revenue: { key: 'revenue', label: 'Выручка от продаж', kind: 'flow', unit: 'money' },
  returns_count: { key: 'returns_count', label: 'Возвраты', kind: 'flow', unit: 'count' },
  returns_amount: { key: 'returns_amount', label: 'Сумма возвратов', kind: 'flow', unit: 'money' },
  payout: { key: 'payout', label: 'К перечислению продавцу', kind: 'flow', unit: 'money' },
  commission: { key: 'commission', label: 'Комиссия площадки', kind: 'flow', unit: 'money' },
  sku_count: { key: 'sku_count', label: 'Товаров в каталоге (SKU)', kind: 'snapshot', unit: 'count' },
  sku_in_stock: { key: 'sku_in_stock', label: 'SKU с положительным остатком', kind: 'snapshot', unit: 'count' },
  sessions: { key: 'sessions', label: 'Визиты (сессии)', kind: 'flow', unit: 'count' },
  users: { key: 'users', label: 'Посетители', kind: 'flow', unit: 'count' },
  web_purchases: { key: 'web_purchases', label: 'Покупки на сайте', kind: 'flow', unit: 'count' },
  web_revenue: { key: 'web_revenue', label: 'Доход с покупок на сайте', kind: 'flow', unit: 'money' },
}

export function isFactKey(v: unknown): v is FactKey {
  return typeof v === 'string' && (FACT_KEYS as readonly string[]).includes(v)
}

/** Unit stored with a count fact. */
export const COUNT_UNIT = 'count'
/** Money whose currency the provider does not return. */
export const SELLER_CURRENCY = 'seller_currency'

/** One fact as an adapter produces it (dates are YYYY-MM-DD). */
export interface FactInput {
  metricKey: FactKey
  periodStart: string
  periodEnd: string
  value: number
  unit: string
  sourceRef?: string | null
}

const DAY = /^\d{4}-\d{2}-\d{2}$/

/** Rejects malformed facts before they reach the database (NaN, bad dates, unknown keys). */
export function validFact(f: FactInput): boolean {
  return (
    isFactKey(f.metricKey)
    && DAY.test(f.periodStart)
    && DAY.test(f.periodEnd)
    && f.periodEnd >= f.periodStart
    && typeof f.value === 'number'
    && Number.isFinite(f.value)
    && typeof f.unit === 'string'
    && f.unit.length > 0
    && f.unit.length <= 16
  )
}

/** Round money to kopecks / tiyn, counts to integers. */
export function roundFact(key: FactKey, value: number): number {
  return FACTS[key].unit === 'count' ? Math.round(value) : Math.round(value * 100) / 100
}
