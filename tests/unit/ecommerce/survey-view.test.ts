// /client/dashboard-ecommerce view model (lib/ecommerce/survey-view.ts):
// everything the client sees comes from their own ec_* survey answers or is
// an honest empty state — no demo shop, no invented targets, ROAS is never
// shown as LTV/CAC, garbage answers count as missing.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  COMPANY_NAME_FALLBACK,
  buildEcommerceView,
  extractEcommerceAnswers,
  formatKpiValue,
  parsePercent,
  parsePositiveNumber,
  type EcommerceView,
} from '@/lib/ecommerce/survey-view'

const sectionStatuses = (v: EcommerceView) => ({
  funnel: v.funnel.status,
  channels: v.channels.status,
  marketplaces: v.marketplaces.status,
  catalog: v.catalog.status,
  customers: v.customers.status,
  cohorts: v.cohorts.status,
  cartRecovery: v.cartRecovery.status,
  seasonality: v.seasonality.status,
  operations: v.operations.status,
})

const kpi = (v: EcommerceView, key: string) => v.kpis.find((k) => k.key === key)!

/** Every number anywhere in the view model (recursively). */
function numbersIn(value: unknown, out: number[] = []): number[] {
  if (typeof value === 'number') out.push(value)
  else if (Array.isArray(value)) value.forEach((x) => numbersIn(x, out))
  else if (value && typeof value === 'object') Object.values(value).forEach((x) => numbersIn(x, out))
  return out
}

const FULL_ANSWERS: Record<string, unknown> = {
  ec_platforms: ['Shopify', 'Tilda'],
  ec_website: 'https://shop.kz/',
  ec_years_online: 3,
  ec_marketplaces: ['Kaspi Магазин', 'Ozon'],
  ec_mp_revenue_share: 40,
  ec_mp_top_categories: 'Сумки · Часы',
  ec_traffic_channels: ['Google Ads', 'Email-рассылки'],
  ec_monthly_ad_budget: 500_000,
  ec_visitors_per_month: 50_000,
  ec_roas: 4.5,
  ec_total_sku: 400,
  ec_active_sku: 300,
  ec_flagship_sku: 'Рюкзак City',
  ec_most_marginal: 'Ремни',
  ec_dead_stock_pct: 12,
  ec_aov: 9_000,
  ec_cr_visit_to_cart: 8,
  ec_cr_cart_to_pay: 25,
  ec_abandon_pct: 70,
  ec_repeat_rate: 18,
  ec_nps: -5,
  ec_fulfillment: ['Свой склад + курьер'],
  ec_delivery_days: 3,
  ec_returns_pct: 5,
  ec_top_return_reason: 'Не подошёл размер',
  ec_geo_regions: 'РК · UZ',
  ec_revenue_2024: 60_000_000,
  ec_gross_margin: 34,
  ec_seasonality_peaks: ['Новый Год', 'Black Friday', 'Рамадан / Eid'],
  ec_supplier_concentration: 40,
  ec_inventory_turnover: 45,
}

describe('buildEcommerceView — no survey answers', () => {
  for (const answers of [null, {}, { ec_aov: '', ec_platforms: [] }]) {
    it(`fabricates nothing for ${JSON.stringify(answers)}`, () => {
      const v = buildEcommerceView(answers)
      expect(v.hasSurvey).toBe(false)
      expect(v.company.name).toBe(COMPANY_NAME_FALLBACK)
      expect(v.company.isFallbackName).toBe(true)
      expect(v.company.details).toEqual([])

      const json = JSON.stringify(v)
      expect(json).not.toContain('Demo Shop')
      expect(json).not.toContain('iPhone')
      expect(json).not.toContain('Wildberries')
      expect(json).not.toContain('Yandex Direct')

      // The old demo figures (₸84.2M revenue, 150 000 visits, 1 240 orders…) are gone.
      const nums = numbersIn(v)
      for (const demo of [84_200_000, 110_000_000, 8_500, 1_240, 150_000, 4.78, 12_000, 1_870]) {
        expect(nums).not.toContain(demo)
      }

      for (const t of v.kpis) {
        expect(t.value).toBeNull()
        expect(t.target).toBeNull()
        expect(t.trend).toBeNull()
        expect(formatKpiValue(t)).toBe('—')
      }
      expect(v.funnel.stages).toEqual([])
      expect(v.channels.active).toEqual([])
      expect(v.marketplaces.list).toEqual([])
      expect(Object.values(sectionStatuses(v)).every((s) => s === 'empty')).toBe(true)
    })
  }
})

describe('buildEcommerceView — with survey answers', () => {
  const v = buildEcommerceView(FULL_ANSWERS, { companyName: 'ТОО Сумкин', companyIndustry: 'Аксессуары' })

  it('takes revenue and AOV from the answers and invents no target or trend', () => {
    expect(v.hasSurvey).toBe(true)
    expect(kpi(v, 'revenue')).toMatchObject({ value: 60_000_000, provenance: 'survey', target: null, trend: null })
    expect(kpi(v, 'aov')).toMatchObject({ value: 9_000, provenance: 'survey', target: null, trend: null })
    for (const t of v.kpis) {
      expect(t.target).toBeNull()
      expect(t.trend).toBeNull()
    }
  })

  it('derives the funnel from visitors × conversion and labels it as a calculation', () => {
    expect(v.funnel.status).toBe('data')
    expect(v.funnel.stages.map((s) => [s.key, s.n, s.provenance])).toEqual([
      ['visit', 50_000, 'survey'],
      ['cart', 4_000, 'calculated'],
      ['paid', 1_000, 'calculated'],
    ])
    expect(v.funnel.missing).toEqual([])
    const orders = kpi(v, 'orders')
    expect(orders).toMatchObject({ value: 1_000, provenance: 'calculated', target: null })
    expect(orders.basis).toContain('расчёт по анкете')
  })

  it('shows ROAS as ROAS, never as LTV/CAC', () => {
    const roas = kpi(v, 'roas')
    expect(roas.label).toBe('ROAS')
    expect(roas.value).toBe(4.5)
    expect(v.kpis.some((k) => /LTV|CAC/i.test(k.label))).toBe(false)
    expect(v.kpis.some((k) => (k.key as string) === 'ltvCac')).toBe(false)
  })

  it('uses the real company name and survey details', () => {
    expect(v.company).toEqual({
      name: 'ТОО Сумкин',
      isFallbackName: false,
      details: ['Аксессуары', 'Shopify + Tilda', 'shop.kz', '3 года в онлайне'],
    })
  })

  it('fills survey-backed sections and nothing beyond the answers', () => {
    expect(v.channels).toMatchObject({ active: ['Google Ads', 'Email-рассылки'], monthlyBudget: 500_000, roas: 4.5, adRevenueMonthly: 2_250_000 })
    expect(v.marketplaces).toMatchObject({ list: ['Kaspi Магазин', 'Ozon'], notUsed: false, revenueShare: 40 })
    expect(v.catalog).toMatchObject({ totalSku: 400, activeSku: 300, activeSharePct: 75, deadStockPct: 12, flagship: 'Рюкзак City' })
    expect(v.customers).toMatchObject({ repeatRatePct: 18, nps: -5 })
    expect(v.cohorts.status).toBe('empty')
    expect(v.cartRecovery.abandonPct).toBe(70)
    expect(v.seasonality.months[11].tags).toEqual(['НГ'])
    expect(v.seasonality.months[10].tags).toEqual(['BF'])
    expect(v.seasonality.floating).toEqual(['Рамадан / Eid'])
    expect(v.operations).toMatchObject({ grossMarginPct: 34, deliveryDays: 3, inventoryTurnoverDays: 45 })
    expect(JSON.stringify(v)).not.toContain('Demo Shop')
  })

  it('without the funnel, orders/month is calculated from revenue / 12 / AOV and labelled so', () => {
    const w = buildEcommerceView({ ec_revenue_2024: 12_000_000, ec_aov: 10_000 })
    expect(kpi(w, 'orders')).toMatchObject({ value: 100, provenance: 'calculated' })
    expect(kpi(w, 'orders').basis).toContain('выручка 2024 / 12 / средний чек')
    expect(w.funnel.status).toBe('empty')
  })

  it('a partial funnel lists what is missing instead of guessing', () => {
    const w = buildEcommerceView({ ec_visitors_per_month: 20_000, ec_cr_visit_to_cart: 5 })
    expect(w.funnel.status).toBe('partial')
    expect(w.funnel.stages.map((s) => s.key)).toEqual(['visit', 'cart'])
    expect(w.funnel.missing).toEqual(['CR Cart → Paid'])
    expect(kpi(w, 'orders').value).toBeNull()
  })

  it('falls back to «Ваш магазин» when no company name is known', () => {
    const w = buildEcommerceView({ ec_platforms: ['Shopify'] }, { companyName: '   ' })
    expect(w.company.name).toBe('Ваш магазин')
    expect(w.company.details).toEqual(['Shopify'])
  })

  it('honours «не работаем с маркетплейсами» and «без выраженных пиков»', () => {
    const w = buildEcommerceView({
      ec_marketplaces: ['Не работаем с маркетплейсами'],
      ec_seasonality_peaks: ['Без выраженных пиков'],
    })
    expect(w.marketplaces).toMatchObject({ list: [], notUsed: true })
    expect(w.seasonality).toMatchObject({ peaks: [], noPeaks: true })
  })
})

describe('buildEcommerceView — garbage answers are missing', () => {
  it('ignores strings with letters, negatives, zero and impossible percentages', () => {
    const v = buildEcommerceView({
      ec_revenue_2024: 'около 80 млн',
      ec_aov: -9000,
      ec_visitors_per_month: 0,
      ec_cr_visit_to_cart: 140,
      ec_cr_cart_to_pay: '22abc',
      ec_roas: '0',
      ec_monthly_ad_budget: Number.NaN,
      ec_total_sku: Infinity,
      ec_dead_stock_pct: -3,
      ec_platforms: 'Shopify',
      ec_website: 'не знаю',
      ec_nps: 250,
    })
    expect(v.hasSurvey).toBe(false)
    for (const t of v.kpis) expect(t.value).toBeNull()
    expect(v.funnel.stages).toEqual([])
    expect(v.company.details).toEqual([])
    expect(Object.values(sectionStatuses(v)).every((s) => s === 'empty')).toBe(true)
  })

  it('parses numeric strings but rejects anything else', () => {
    expect(parsePositiveNumber('84000000')).toBe(84_000_000)
    expect(parsePositiveNumber('84 000 000')).toBe(84_000_000)
    expect(parsePositiveNumber('4,5')).toBe(4.5)
    expect(parsePositiveNumber({ value: 12 })).toBe(12)
    for (const bad of ['12abc', 'abc', '', '-5', '0', 0, -1, null, undefined, [], {}, true, Number.NaN, Infinity]) {
      expect(parsePositiveNumber(bad)).toBeNull()
    }
    expect(parsePercent(100)).toBe(100)
    expect(parsePercent(100.5)).toBeNull()
  })

  it('does not compute an active-SKU share when active > total', () => {
    const v = buildEcommerceView({ ec_total_sku: 100, ec_active_sku: 300 })
    expect(v.catalog).toMatchObject({ totalSku: 100, activeSku: 300, activeSharePct: null })
  })
})

describe('extractEcommerceAnswers', () => {
  it('keeps only ec_* keys and unwraps the { value } envelope', () => {
    expect(extractEcommerceAnswers([
      { question_key: 'ec_aov', answer: { value: 9000 } },
      { question_key: 'ec_platforms', answer: { value: ['Shopify'] } },
      { question_key: 'eco_note', answer: { value: 'x' } },
      { question_key: 's1_company_name', answer: { value: 'ТОО' } },
      { question_key: 'ec_raw', answer: 5 },
    ])).toEqual({ ec_aov: 9000, ec_platforms: ['Shopify'], ec_raw: 5 })
    expect(extractEcommerceAnswers(null)).toEqual({})
  })
})

describe('dashboard-ecommerce page source', () => {
  const src = readFileSync(path.resolve(__dirname, '../../../app/client/dashboard-ecommerce/page.tsx'), 'utf8')

  it('carries no demo dataset', () => {
    for (const demo of ['Demo Shop', 'iPhone', 'AirPods', '84_200_000', 'демо-данные', 'const DATA']) {
      expect(src).not.toContain(demo)
    }
  })

  it('builds the view from the shared survey view model and never labels ROAS as LTV/CAC', () => {
    expect(src).toContain("from '@/lib/ecommerce/survey-view'")
    expect(src).toContain('buildEcommerceView(')
    expect(src).not.toMatch(/label:\s*'LTV\/CAC'/)
  })
})
