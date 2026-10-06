// View model for /client/dashboard-ecommerce, built ONLY from the client's own
// e-commerce survey answers (ec_* keys written by /client/onboarding-ecommerce).
//
// Data rules (provenance):
//   • A value is shown only if the client entered it in the survey
//     (provenance 'survey') or it is a plain arithmetic derivation of such
//     answers (provenance 'calculated', labelled «расчёт по анкете» in the UI).
//   • Nothing is invented: no demo numbers, no made-up targets, no trends.
//     The survey has no target-like or trend-like ec_* keys, so `target` and
//     `trend` stay null until a real source provides them.
//   • Per-channel / per-marketplace / per-SKU / RFM / cohort / cart-flow /
//     monthly-sales data has no survey source. Connected integrations fill the
//     channel / marketplace / catalog blocks (lib/ecommerce/integrations-view.ts);
//     RFM, cohorts, cart flows and monthly sales have no source yet.
//   • Garbage values (non-numeric strings, negatives, 0, percentages > 100)
//     are treated as missing.
//
// Pure module (no React, no I/O) so it can be unit tested in node.

export const ECOMMERCE_SURVEY_HREF = '/client/onboarding-ecommerce'
export const COMPANY_NAME_FALLBACK = 'Ваш магазин'

export type Provenance = 'survey' | 'calculated'
export type SectionStatus = 'data' | 'partial' | 'empty'

/** Short titles of the survey steps (match STEPS[].shortTitle of the onboarding page). */
export type SurveyStep = 'Платформа' | 'Маркетплейсы' | 'Трафик' | 'Каталог' | 'Воронка' | 'Логистика' | 'Финансы'

export interface KpiTile {
  key: 'revenue' | 'aov' | 'orders' | 'roas'
  label: string
  value: number | null
  unit: 'money' | 'count' | 'ratio'
  provenance: Provenance | null
  /** Human caption explaining where the value comes from. */
  basis: string | null
  /** Survey step to fill when the value is missing. */
  step: SurveyStep
  /** No ec_* key holds a target — always null until a real source exists. */
  target: number | null
  /** A one-shot survey has no history — always null (rendered as «—»). */
  trend: number | null
}

export interface FunnelStageView {
  key: 'visit' | 'cart' | 'paid'
  label: string
  n: number
  /** Conversion from the previous stage, 0..1 (null for the first stage). */
  conv: number | null
  provenance: Provenance
}

export interface EcommerceView {
  /** At least one valid ec_* answer exists. */
  hasSurvey: boolean
  company: {
    name: string
    /** true when no real company name was available. */
    isFallbackName: boolean
    /** Platform / website / years online / industry — survey or company record only. */
    details: string[]
  }
  kpis: KpiTile[]
  funnel: {
    status: SectionStatus
    stages: FunnelStageView[]
    rates: { visitToCart: number | null; cartToPaid: number | null }
    /** Survey field labels still needed for the full funnel. */
    missing: string[]
  }
  channels: {
    status: SectionStatus
    active: string[]
    monthlyBudget: number | null
    roas: number | null
    /** monthlyBudget × roas (ROAS is defined in the survey as выручка / реклама). */
    adRevenueMonthly: number | null
  }
  marketplaces: {
    status: SectionStatus
    list: string[]
    /** Client explicitly answered «Не работаем с маркетплейсами». */
    notUsed: boolean
    revenueShare: number | null
    topCategories: string | null
  }
  catalog: {
    status: SectionStatus
    totalSku: number | null
    activeSku: number | null
    /** activeSku / totalSku × 100, only when activeSku ≤ totalSku. */
    activeSharePct: number | null
    deadStockPct: number | null
    returnsPct: number | null
    flagship: string | null
    mostMarginal: string | null
    topReturnReason: string | null
  }
  customers: {
    status: SectionStatus
    repeatRatePct: number | null
    nps: number | null
  }
  /** No survey key describes cohorts — always empty until a source is connected. */
  cohorts: { status: 'empty' }
  cartRecovery: {
    status: SectionStatus
    abandonPct: number | null
  }
  seasonality: {
    status: SectionStatus
    /** Every peak the client selected (minus «Без выраженных пиков»). */
    peaks: string[]
    /** Client explicitly answered «Без выраженных пиков». */
    noPeaks: boolean
    /** Month index (0..11) → short tags of fixed-date peaks in that month. */
    months: Array<{ label: string; tags: string[] }>
    /** Selected peaks without a fixed month (e.g. Рамадан). */
    floating: string[]
  }
  operations: {
    status: SectionStatus
    grossMarginPct: number | null
    supplierConcentrationPct: number | null
    inventoryTurnoverDays: number | null
    deliveryDays: number | null
    fulfillment: string[]
    regions: string | null
  }
}

// ─── Value parsing ─────────────────────────────────────────────────────────

/** Unwraps the survey envelope `{ value }` if present. */
function unwrap(v: unknown): unknown {
  if (v !== null && typeof v === 'object' && !Array.isArray(v) && 'value' in (v as object)) {
    return (v as { value: unknown }).value
  }
  return v
}

/**
 * Finite number > 0, else null. Accepts numbers and purely numeric strings
 * («84000000», «84 000 000», «4,5»); strings with letters are missing.
 */
export function parsePositiveNumber(raw: unknown): number | null {
  const v = unwrap(raw)
  let n: number
  if (typeof v === 'number') {
    n = v
  } else if (typeof v === 'string') {
    const s = v.replace(/[\s  ]/g, '').replace(',', '.')
    if (!/^\d+(\.\d+)?$/.test(s)) return null
    n = Number(s)
  } else {
    return null
  }
  return Number.isFinite(n) && n > 0 ? n : null
}

/** Percentage in (0, 100], else null. */
export function parsePercent(raw: unknown): number | null {
  const n = parsePositiveNumber(raw)
  return n != null && n <= 100 ? n : null
}

/** Whole positive count (SKU, visitors), else null. */
function parseCount(raw: unknown): number | null {
  const n = parsePositiveNumber(raw)
  return n != null && Number.isInteger(n) ? n : null
}

/** NPS is legitimately −100..100 (0 and negatives are valid answers). */
export function parseNps(raw: unknown): number | null {
  const v = unwrap(raw)
  let n: number
  if (typeof v === 'number') n = v
  else if (typeof v === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(v)) n = Number(v)
  else return null
  return Number.isFinite(n) && n >= -100 && n <= 100 ? n : null
}

const MAX_TEXT = 200

/** Trimmed non-empty string (capped), else null. */
export function parseText(raw: unknown): string | null {
  const v = unwrap(raw)
  if (typeof v !== 'string') return null
  const s = v.trim()
  if (!s) return null
  return s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT - 1)}…` : s
}

/** De-duplicated list of trimmed non-empty strings. */
export function parseList(raw: unknown): string[] {
  const v = unwrap(raw)
  if (!Array.isArray(v)) return []
  const out: string[] = []
  for (const item of v) {
    const s = parseText(item)
    if (s && !out.includes(s)) out.push(s)
  }
  return out
}

/** Website: only http(s) URLs or bare domains, shown without protocol. */
function parseWebsite(raw: unknown): string | null {
  const s = parseText(raw)
  if (!s) return null
  const bare = s.replace(/^https?:\/\//i, '').replace(/\/+$/, '')
  return /^[^\s/]+\.[^\s/]+(\/\S*)?$/.test(bare) ? bare : null
}

/**
 * Rows from `survey_answers` → flat ec_* answers. Keeps only `ec_` keys and
 * unwraps the `{ value }` envelope the survey route stores.
 */
export function extractEcommerceAnswers(
  rows: ReadonlyArray<{ question_key?: unknown; answer?: unknown }> | null | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const row of rows ?? []) {
    const key = typeof row.question_key === 'string' ? row.question_key : ''
    if (!key.startsWith('ec_')) continue
    out[key] = unwrap(row.answer)
  }
  return out
}

// ─── Formatting (shared by the page) ───────────────────────────────────────

const nf = new Intl.NumberFormat('ru-KZ', { maximumFractionDigits: 1 })

export function formatNumber(n: number): string {
  return nf.format(n)
}

export function formatMoney(n: number): string {
  if (n >= 1_000_000_000) return `₸${nf.format(n / 1_000_000_000)} млрд`
  if (n >= 1_000_000) return `₸${nf.format(n / 1_000_000)} млн`
  return `₸${new Intl.NumberFormat('ru-KZ', { maximumFractionDigits: 0 }).format(n)}`
}

export function formatPercent(n: number): string {
  return `${nf.format(n)}%`
}

export function formatRatio(n: number): string {
  return `${new Intl.NumberFormat('ru-KZ', { maximumFractionDigits: 2 }).format(n)}x`
}

export function formatKpiValue(tile: Pick<KpiTile, 'value' | 'unit'>): string {
  if (tile.value == null) return '—'
  if (tile.unit === 'money') return formatMoney(tile.value)
  if (tile.unit === 'ratio') return formatRatio(tile.value)
  return formatNumber(tile.value)
}

function yearsLabel(n: number): string {
  if (!Number.isInteger(n)) return `${formatNumber(n)} года`
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return `${n} год`
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} года`
  return `${n} лет`
}

// ─── Seasonality calendar ──────────────────────────────────────────────────

export const MONTHS = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'] as const

const NO_PEAKS = 'Без выраженных пиков'
const NO_MARKETPLACES = 'Не работаем с маркетплейсами'

/** Fixed-date peaks offered by the survey → month index + short tag. */
const PEAK_MONTHS: Record<string, Array<{ month: number; tag: string }>> = {
  'Новый Год': [{ month: 11, tag: 'НГ' }],
  'Black Friday': [{ month: 10, tag: 'BF' }],
  'Школьная пора': [{ month: 7, tag: 'Школа' }],
  '8 Марта': [{ month: 2, tag: '8 Мар' }],
  '11.11 / 12.12': [{ month: 10, tag: '11.11' }, { month: 11, tag: '12.12' }],
  'День Победы': [{ month: 4, tag: '9 Мая' }],
}

// ─── Builder ───────────────────────────────────────────────────────────────

function statusOf(present: number, total: number): SectionStatus {
  if (present === 0) return 'empty'
  return present >= total ? 'data' : 'partial'
}

function countPresent(...values: unknown[]): number {
  return values.filter((v) => (Array.isArray(v) ? v.length > 0 : v != null && v !== false)).length
}

export interface BuildEcommerceViewOptions {
  /** `companies.name` of the client, if known. */
  companyName?: unknown
  /** `companies.industry` of the client, if known. */
  companyIndustry?: unknown
}

export function buildEcommerceView(
  answers: Record<string, unknown> | null | undefined,
  opts: BuildEcommerceViewOptions = {},
): EcommerceView {
  const a = answers ?? {}

  // ── Survey answers (units as in /client/onboarding-ecommerce) ──
  const platforms = parseList(a.ec_platforms)                     // string[]
  const website = parseWebsite(a.ec_website)                      // URL
  const yearsOnline = parsePositiveNumber(a.ec_years_online)      // years
  const mpSelected = parseList(a.ec_marketplaces)                 // string[]
  const mpShare = parsePercent(a.ec_mp_revenue_share)             // %
  const mpTopCategories = parseText(a.ec_mp_top_categories)       // text
  const channels = parseList(a.ec_traffic_channels)               // string[]
  const adBudget = parsePositiveNumber(a.ec_monthly_ad_budget)    // ₸ / month
  const visitors = parseCount(a.ec_visitors_per_month)            // visitors / month
  const roas = parsePositiveNumber(a.ec_roas)                     // x (выручка / реклама)
  const totalSku = parseCount(a.ec_total_sku)                     // count
  const activeSku = parseCount(a.ec_active_sku)                   // count (90 days)
  const flagship = parseText(a.ec_flagship_sku)                   // text
  const mostMarginal = parseText(a.ec_most_marginal)              // text
  const deadStock = parsePercent(a.ec_dead_stock_pct)             // %
  const aov = parsePositiveNumber(a.ec_aov)                       // ₸
  const crVisitCart = parsePercent(a.ec_cr_visit_to_cart)         // %
  const crCartPay = parsePercent(a.ec_cr_cart_to_pay)             // %
  const abandon = parsePercent(a.ec_abandon_pct)                  // %
  const repeatRate = parsePercent(a.ec_repeat_rate)               // %
  const nps = parseNps(a.ec_nps)                                  // −100..100
  const fulfillment = parseList(a.ec_fulfillment)                 // string[]
  const deliveryDays = parsePositiveNumber(a.ec_delivery_days)    // days
  const returnsPct = parsePercent(a.ec_returns_pct)               // %
  const topReturnReason = parseText(a.ec_top_return_reason)       // text
  const regions = parseText(a.ec_geo_regions)                     // text
  const revenue2024 = parsePositiveNumber(a.ec_revenue_2024)      // ₸ / year
  const grossMargin = parsePercent(a.ec_gross_margin)             // %
  const peaksSelected = parseList(a.ec_seasonality_peaks)         // string[]
  const supplierConc = parsePercent(a.ec_supplier_concentration)  // %
  const turnover = parsePositiveNumber(a.ec_inventory_turnover)   // days

  const hasSurvey = countPresent(
    platforms, website, yearsOnline, mpSelected, mpShare, mpTopCategories, channels, adBudget,
    visitors, roas, totalSku, activeSku, flagship, mostMarginal, deadStock, aov, crVisitCart,
    crCartPay, abandon, repeatRate, nps, fulfillment, deliveryDays, returnsPct, topReturnReason,
    regions, revenue2024, grossMargin, peaksSelected, supplierConc, turnover,
  ) > 0

  // ── Company ──
  const realName = parseText(opts.companyName)
  const industry = parseText(opts.companyIndustry)
  const details: string[] = []
  if (industry) details.push(industry)
  if (platforms.length) details.push(platforms.join(' + '))
  if (website) details.push(website)
  if (yearsOnline != null) details.push(`${yearsLabel(yearsOnline)} в онлайне`)

  // ── Funnel (counts are calculated from visitors × conversion) ──
  const stages: FunnelStageView[] = []
  if (visitors != null) {
    stages.push({ key: 'visit', label: 'Посетители', n: visitors, conv: null, provenance: 'survey' })
    if (crVisitCart != null) {
      const cart = Math.round(visitors * (crVisitCart / 100))
      stages.push({ key: 'cart', label: 'Корзина', n: cart, conv: crVisitCart / 100, provenance: 'calculated' })
      if (crCartPay != null) {
        const paid = Math.round(cart * (crCartPay / 100))
        stages.push({ key: 'paid', label: 'Оплата', n: paid, conv: crCartPay / 100, provenance: 'calculated' })
      }
    }
  }
  const funnelMissing: string[] = []
  if (visitors == null) funnelMissing.push('посетители сайта в месяц')
  if (crVisitCart == null) funnelMissing.push('CR Visit → Cart')
  if (crCartPay == null) funnelMissing.push('CR Cart → Paid')
  const paidStage = stages.find((s) => s.key === 'paid')

  // ── KPI tiles ──
  let orders: number | null = null
  let ordersBasis: string | null = null
  if (paidStage) {
    orders = paidStage.n
    ordersBasis = 'расчёт по анкете: посетители × конверсии'
  } else if (revenue2024 != null && aov != null) {
    orders = Math.round(revenue2024 / 12 / aov)
    ordersBasis = 'расчёт по анкете: выручка 2024 / 12 / средний чек'
  }

  const kpis: KpiTile[] = [
    {
      key: 'revenue', label: 'Выручка 2024', value: revenue2024, unit: 'money',
      provenance: revenue2024 != null ? 'survey' : null,
      basis: revenue2024 != null ? 'из анкеты' : null,
      step: 'Финансы', target: null, trend: null,
    },
    {
      key: 'aov', label: 'Средний чек (AOV)', value: aov, unit: 'money',
      provenance: aov != null ? 'survey' : null,
      basis: aov != null ? 'из анкеты' : null,
      step: 'Воронка', target: null, trend: null,
    },
    {
      key: 'orders', label: 'Заказов в месяц', value: orders, unit: 'count',
      provenance: orders != null ? 'calculated' : null,
      basis: ordersBasis,
      step: 'Воронка', target: null, trend: null,
    },
    {
      // The survey asks for ROAS (выручка / реклама), not LTV or CAC — the
      // tile is labelled ROAS and never presented as LTV/CAC.
      key: 'roas', label: 'ROAS', value: roas, unit: 'ratio',
      provenance: roas != null ? 'survey' : null,
      basis: roas != null ? 'из анкеты' : null,
      step: 'Трафик', target: null, trend: null,
    },
  ]

  // ── Sections ──
  const adRevenueMonthly = adBudget != null && roas != null ? Math.round(adBudget * roas) : null

  const mpList = mpSelected.filter((m) => m !== NO_MARKETPLACES)
  const mpNotUsed = mpList.length === 0 && mpSelected.includes(NO_MARKETPLACES)

  const activeSharePct =
    totalSku != null && activeSku != null && activeSku <= totalSku
      ? Math.round((activeSku / totalSku) * 1000) / 10
      : null

  const noPeaks = peaksSelected.includes(NO_PEAKS)
  const peaks = peaksSelected.filter((p) => p !== NO_PEAKS)
  const months = MONTHS.map((label) => ({ label: label as string, tags: [] as string[] }))
  const floating: string[] = []
  for (const p of peaks) {
    const fixed = PEAK_MONTHS[p]
    if (fixed) for (const f of fixed) months[f.month].tags.push(f.tag)
    else floating.push(p)
  }

  return {
    hasSurvey,
    company: {
      name: realName ?? COMPANY_NAME_FALLBACK,
      isFallbackName: realName == null,
      details,
    },
    kpis,
    funnel: {
      status: stages.length === 3 ? 'data' : stages.length || crVisitCart != null || crCartPay != null ? 'partial' : 'empty',
      stages,
      rates: { visitToCart: crVisitCart, cartToPaid: crCartPay },
      missing: funnelMissing,
    },
    channels: {
      status: statusOf(countPresent(channels, adBudget, roas), 3),
      active: channels,
      monthlyBudget: adBudget,
      roas,
      adRevenueMonthly,
    },
    marketplaces: {
      status: mpNotUsed ? 'data' : statusOf(countPresent(mpList, mpShare, mpTopCategories), 3),
      list: mpList,
      notUsed: mpNotUsed,
      revenueShare: mpShare,
      topCategories: mpTopCategories,
    },
    catalog: {
      status: statusOf(countPresent(totalSku, activeSku, deadStock, returnsPct, flagship, mostMarginal, topReturnReason), 7),
      totalSku,
      activeSku,
      activeSharePct,
      deadStockPct: deadStock,
      returnsPct,
      flagship,
      mostMarginal,
      topReturnReason,
    },
    customers: {
      status: statusOf(countPresent(repeatRate, nps), 2),
      repeatRatePct: repeatRate,
      nps,
    },
    cohorts: { status: 'empty' },
    cartRecovery: {
      status: abandon != null ? 'data' : 'empty',
      abandonPct: abandon,
    },
    seasonality: {
      status: peaks.length || noPeaks ? 'data' : 'empty',
      peaks,
      noPeaks: noPeaks && peaks.length === 0,
      months,
      floating,
    },
    operations: {
      status: statusOf(countPresent(grossMargin, supplierConc, turnover, deliveryDays, fulfillment, regions), 6),
      grossMarginPct: grossMargin,
      supplierConcentrationPct: supplierConc,
      inventoryTurnoverDays: turnover,
      deliveryDays,
      fulfillment,
      regions,
    },
  }
}

/** Where per-item data will come from once an integration is connected. */
export const INTEGRATION_NOTES = {
  channels: 'Визиты и покупки по данным веб-аналитики появятся после подключения GA4 или Яндекс Метрики. Интеграция пока не подключена.',
  marketplaces: 'Заказы, выручка, средний чек и возвраты по каждой площадке появятся после подключения кабинетов маркетплейсов или МоегоСклада. Интеграция пока не подключена.',
  catalog: 'Число SKU, остатки и доля возвратов появятся после подключения МоегоСклада или кабинета маркетплейса. Интеграция пока не подключена.',
  customers: 'RFM-сегменты строятся по базе заказов — появятся после подключения источника (платформа магазина / CRM). Интеграция пока не подключена.',
  cohorts: 'Удержание по когортам появится после подключения источника заказов (платформа магазина / CRM). Интеграция пока не подключена.',
  cartRecovery: 'Сценарии возврата корзин (email / SMS) и их конверсия появятся после подключения источника (Mindbox / Sendpulse). Интеграция пока не подключена.',
  seasonality: 'Продажи по месяцам появятся после подключения источника (платформа магазина / маркетплейсы). Интеграция пока не подключена.',
} as const
