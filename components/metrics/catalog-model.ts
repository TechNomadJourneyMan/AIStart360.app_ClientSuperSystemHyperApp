// Pure model for the «Метрики» section (level 2 of Point A):
// catalog item normalisation, taxonomy fallbacks, filters, status/source
// presentation and provenance-chain building. No JSX / React here so the
// logic is unit-testable in the node vitest environment.
//
// Contract: types/metric-catalog.ts (GET /api/v1/metrics/catalog). Items are
// normalised defensively so the UI keeps working while the backend rolls the
// enrichment out (missing fields → honest «нет цели» / «нет данных»).

import type {
  MetricBenchmark,
  MetricCatalogEnrichment,
  MetricCategory,
  MetricCategoryKey,
  MetricStatus,
  MetricTarget,
  MetricTrend,
} from '@/types/metric-catalog'
import type { MetricDefinition } from '@/types/metrics'
import { formatRuMetricWithUnit } from '@/components/dashboard/_utils'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CatalogItemSource {
  type: string
  key?: string
  field?: string
  doc_type?: string
  system?: string
  label?: string
  step?: number
  /** Survey answer → number rule (lib/metrics/format.ts SurveyCoercion), when exposed. */
  coerce?: { kind: string; row?: string; column?: string }
}

export interface CatalogItemBase {
  id: string
  label: string
  namespace: 'biz' | 'kpi' | 'gri' | 'goal' | string
  department: string | null
  goalNumber: string | null
  unit: string
  formula: string | null
  sources: CatalogItemSource[]
  value: number | string | null
  confidence: number | null
  source: string | null
  computedAt: string | null
  fresh: boolean
}

/** A catalog item after normalisation — every enrichment field is present. */
export type CatalogItem = CatalogItemBase & Omit<MetricCatalogEnrichment, 'category'> & {
  /** null only when neither the API nor the fallback mapping knows it. */
  category: MetricCategoryKey | null
}

export type RawCatalogItem = Partial<CatalogItemBase> & Partial<MetricCatalogEnrichment> & { id: string; label: string }

export interface CatalogApiData {
  total: number
  page?: number
  pageSize?: number
  items: RawCatalogItem[]
  counts?: Record<string, unknown>
  categoryCounts?: Record<string, unknown>
  categories?: Array<Partial<MetricCategory> & { key: string; count?: number }>
}

// ─── Taxonomy (presentation fallback — the API is the source of truth) ─────

export const METRIC_CATEGORY_KEYS: ReadonlyArray<MetricCategoryKey> = [
  'finance',
  'sales',
  'marketing',
  'customers',
  'operations',
  'team',
  'product',
  'automation',
  'ai_maturity',
  'digital',
  'management',
  'growth_goals',
  'gri',
]

export const CATEGORY_LABELS: Record<MetricCategoryKey, string> = {
  finance: 'Финансы',
  sales: 'Продажи',
  marketing: 'Маркетинг',
  customers: 'Клиенты',
  operations: 'Операции',
  team: 'Команда и HR',
  product: 'Продукт',
  automation: 'Автоматизация',
  ai_maturity: 'AI-зрелость',
  digital: 'Digital-зрелость',
  management: 'Управление',
  growth_goals: 'Цели роста',
  gri: 'GRI',
}

export const CATEGORY_ICONS: Record<MetricCategoryKey, string> = {
  finance: 'payments',
  sales: 'point_of_sale',
  marketing: 'campaign',
  customers: 'groups',
  operations: 'settings',
  team: 'badge',
  product: 'inventory_2',
  automation: 'precision_manufacturing',
  ai_maturity: 'smart_toy',
  digital: 'devices',
  management: 'account_tree',
  growth_goals: 'track_changes',
  gri: 'radar',
}

/**
 * Fallback names of the 11 growth goals (Documents/Metrics.docx), mirroring
 * lib/metrics/taxonomy.ts GOAL_TITLES — used only when the API response does
 * not carry `categories[].subcategories`.
 */
export const GROWTH_GOAL_LABELS: Record<number, string> = {
  1: '1. Привлечь новых клиентов',
  2: '2. Удержать клиентов и сделать их постоянными',
  3: '3. Увеличить средний чек',
  4: '4. Увеличить частоту покупки',
  5: '5. Запустить сарафанное радио',
  6: '6. Забрать клиентов у конкурента',
  7: '7. Создать потребность в продукте',
  8: '8. Ускорить сделку',
  9: '9. Снизить стоимость привлечения (CAC)',
  10: '10. Повысить конверсию в продажи',
  11: '11. Сделать так, чтобы выбрали вас, а не конкурента',
}

const BIZ_DEPARTMENT_CATEGORY: Record<string, MetricCategoryKey> = {
  'Финансы': 'finance',
  'Продажи': 'sales',
  'Маркетинг': 'marketing',
  'Клиенты': 'customers',
  'Операции': 'operations',
  'HR': 'team',
  'Продукт': 'product',
  'Автоматизация': 'automation',
  'Цифровизация': 'digital',
  'Управление': 'management',
}

export function isCategoryKey(v: unknown): v is MetricCategoryKey {
  return typeof v === 'string' && (METRIC_CATEGORY_KEYS as ReadonlyArray<string>).includes(v)
}

/** Fallback only — used when the API item has no `category` yet. */
export function fallbackCategory(item: { namespace?: string; department?: string | null }): MetricCategoryKey | null {
  if (item.namespace === 'gri') return 'gri'
  if (item.namespace === 'goal') return 'growth_goals'
  if (item.namespace === 'biz' && item.department) return BIZ_DEPARTMENT_CATEGORY[item.department] ?? null
  return null
}

export function categoryLabel(key: string | null | undefined, apiCategories?: CatalogApiData['categories']): string {
  if (!key) return 'Без категории'
  const fromApi = apiCategories?.find((c) => c.key === key)?.label
  if (fromApi) return fromApi
  return isCategoryKey(key) ? CATEGORY_LABELS[key] : key
}

// ─── Normalisation ──────────────────────────────────────────────────────────

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

export function numericValue(v: number | string | null | undefined): number | null {
  return num(v)
}

function trendFrom(delta: number | null): MetricTrend {
  if (delta === null) return 'unknown'
  if (delta > 0) return 'up'
  if (delta < 0) return 'down'
  return 'flat'
}

const STATUS_VALUES: ReadonlyArray<MetricStatus> = ['on_track', 'at_risk', 'off_track', 'no_target', 'no_data']

export function normalizeCatalogItem(raw: RawCatalogItem): CatalogItem {
  const value = raw.value === undefined ? null : raw.value
  const hasValue = value !== null && value !== ''
  const category = isCategoryKey(raw.category)
    ? raw.category
    : fallbackCategory({ namespace: raw.namespace, department: raw.department ?? null })
  const delta = num(raw.delta)
  const status: MetricStatus =
    raw.status && STATUS_VALUES.includes(raw.status)
      ? raw.status
      : hasValue
        ? 'no_target'
        : 'no_data'
  return {
    id: raw.id,
    label: raw.label,
    namespace: raw.namespace ?? 'biz',
    department: raw.department ?? null,
    goalNumber: raw.goalNumber ?? null,
    unit: raw.unit ?? '',
    formula: raw.formula ?? null,
    sources: Array.isArray(raw.sources) ? raw.sources : [],
    value,
    confidence: num(raw.confidence),
    source: raw.source ?? null,
    computedAt: raw.computedAt ?? null,
    fresh: Boolean(raw.fresh),
    category,
    categoryLabel: raw.categoryLabel ?? categoryLabel(category),
    subcategory: raw.subcategory ?? (raw.goalNumber ? `goal_${raw.goalNumber}` : null),
    subcategoryLabel: raw.subcategoryLabel ?? null,
    valueKind: raw.valueKind === 'flag' ? 'flag' : 'number',
    description: raw.description ?? null,
    calculationMethod: raw.calculationMethod ?? null,
    target: raw.target ?? null,
    benchmark: raw.benchmark ?? null,
    previousValue: num(raw.previousValue),
    delta,
    deltaPct: num(raw.deltaPct),
    trend: raw.trend ?? trendFrom(delta),
    status: hasValue ? status : 'no_data',
    period: raw.period ?? null,
    lastUpdated: raw.lastUpdated ?? raw.computedAt ?? null,
    provenanceType: raw.provenanceType ?? null,
  }
}

// ─── Counts / subcategories from the API response ───────────────────────────

function numberRecord(obj: unknown): Record<string, number> | null {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null
  const out: Record<string, number> = {}
  let any = false
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (typeof v === 'number' && Number.isFinite(v)) {
      out[k] = v
      // 'gri' is also a namespace key — it alone does not prove category counts.
      if (isCategoryKey(k) && k !== 'gri') any = true
    }
  }
  return any ? out : null
}

/**
 * Per-category totals for the category nav. Accepts the shapes the catalog
 * route may use (`categoryCounts`, `counts.categories|byCategory|category`,
 * `categories[].count`, or category keys directly on `counts`). Returns null
 * when the response has none — callers then count the fully-loaded list.
 */
export function extractCategoryCounts(data: Partial<CatalogApiData> | null | undefined): Record<string, number> | null {
  if (!data) return null
  const counts = data.counts as Record<string, unknown> | undefined
  const candidates: unknown[] = [
    data.categoryCounts,
    counts?.categories,
    counts?.byCategory,
    counts?.category,
  ]
  for (const c of candidates) {
    const rec = numberRecord(c)
    if (rec) {
      if (typeof rec.all !== 'number' && typeof counts?.all === 'number') rec.all = counts.all as number
      return rec
    }
  }
  if (Array.isArray(data.categories) && data.categories.some((c) => typeof c.count === 'number')) {
    const rec: Record<string, number> = {}
    for (const c of data.categories) if (typeof c.count === 'number') rec[c.key] = c.count
    if (typeof counts?.all === 'number') rec.all = counts.all as number
    return rec
  }
  const direct = numberRecord(counts)
  return direct
}

/** Count items per category (used when the API exposes no category counts). */
export function countByCategory(items: ReadonlyArray<Pick<CatalogItem, 'category'>>): Record<string, number> {
  const rec: Record<string, number> = { all: items.length }
  for (const it of items) {
    if (!it.category) continue
    rec[it.category] = (rec[it.category] ?? 0) + 1
  }
  return rec
}

export interface SubcategoryChip {
  key: string
  label: string
  count: number
}

/** Goal number from a subcategory value: 'goal_01' → 1, '9. Снизить CAC' → 9. */
function goalNumberOf(value: string): number | null {
  const lead = value.match(/^\s*(\d{1,2})\s*[.)]/)
  if (lead) return Number(lead[1])
  const trail = value.match(/(\d{1,2})\s*$/)
  return trail ? Number(trail[1]) : null
}

/**
 * Subcategory chips for a category (growth goals). Items carry the
 * subcategory as either its key ('goal_01') or its label («1. Привлечь…»);
 * the chip value is whatever the items carry, so filtering stays exact.
 * Labels/order come from the API category definition when present, else from
 * the value itself (or the Metrics.docx goal names for bare keys). Counts are
 * taken from the fully-loaded item list of the category.
 */
export function subcategoryChips(
  items: ReadonlyArray<Pick<CatalogItem, 'subcategory'> & { subcategoryLabel?: string | null }>,
  apiSubcategories?: Array<{ key: string; label: string }>,
): SubcategoryChip[] {
  const counts = new Map<string, number>()
  const itemLabels = new Map<string, string>()
  for (const it of items) {
    if (!it.subcategory) continue
    counts.set(it.subcategory, (counts.get(it.subcategory) ?? 0) + 1)
    if (it.subcategoryLabel && !itemLabels.has(it.subcategory)) itemLabels.set(it.subcategory, it.subcategoryLabel)
  }
  if (apiSubcategories?.length) {
    const chips: SubcategoryChip[] = []
    for (const sub of apiSubcategories) {
      const value = counts.has(sub.key) ? sub.key : counts.has(sub.label) ? sub.label : null
      if (value) chips.push({ key: value, label: sub.label, count: counts.get(value) ?? 0 })
    }
    if (chips.length) return chips
  }
  return Array.from(counts.keys())
    .sort((a, b) => (goalNumberOf(a) ?? 99) - (goalNumberOf(b) ?? 99) || a.localeCompare(b, 'ru'))
    .map((value) => {
      const n = goalNumberOf(value)
      const isKey = /^goal_\d+$/.test(value)
      const label =
        itemLabels.get(value) ?? (isKey && n !== null && GROWTH_GOAL_LABELS[n] ? GROWTH_GOAL_LABELS[n] : value)
      return { key: value, label, count: counts.get(value) ?? 0 }
    })
}

// ─── Status ─────────────────────────────────────────────────────────────────

export const STATUS_META: Record<MetricStatus, { label: string; chip: string; dot: string }> = {
  on_track: { label: 'В плане', chip: 'text-primary border-primary/30 bg-primary/10', dot: 'bg-primary' },
  at_risk: {
    label: 'Риск',
    chip: 'text-tertiary-container border-tertiary-container/30 bg-tertiary-container/10',
    dot: 'bg-tertiary-container',
  },
  off_track: { label: 'Отставание', chip: 'text-error border-error/30 bg-error/10', dot: 'bg-error' },
  no_target: {
    label: 'Без цели',
    chip: 'text-on-surface-variant border-white/10 bg-surface-container-high',
    dot: 'bg-on-surface-variant/50',
  },
  no_data: {
    label: 'Нет данных',
    chip: 'text-on-surface-variant border-dashed border-white/15 bg-transparent',
    dot: 'bg-on-surface-variant/30',
  },
}

export const STATUS_FILTER_OPTIONS: ReadonlyArray<{ value: MetricStatus; label: string }> = [
  { value: 'on_track', label: 'В плане' },
  { value: 'at_risk', label: 'Риск' },
  { value: 'off_track', label: 'Отставание' },
  { value: 'no_target', label: 'Без цели' },
  { value: 'no_data', label: 'Нет данных' },
]

// ─── Sources ────────────────────────────────────────────────────────────────

export type SourceBucket = 'survey' | 'document' | 'calculated' | 'manual' | 'integration'

export const SOURCE_FILTER_OPTIONS: ReadonlyArray<{ value: SourceBucket; label: string }> = [
  { value: 'survey', label: 'Анкета' },
  { value: 'document', label: 'Документ' },
  { value: 'calculated', label: 'Расчёт' },
  { value: 'manual', label: 'Вручную' },
  { value: 'integration', label: 'Интеграция' },
]

/** metrics.source → filter bucket (null for unknown / empty). */
export function sourceBucket(source: string | null | undefined): SourceBucket | null {
  if (!source) return null
  const s = source.toLowerCase()
  if (s === 'survey' || s === 'gri_assessment' || s.startsWith('survey')) return 'survey'
  if (s === 'document' || s.startsWith('doc')) return 'document'
  if (s === 'manual') return 'manual'
  if (s === 'external' || s === 'prisma' || s === 'crm' || s.startsWith('integration') || s.startsWith('crm')) return 'integration'
  if (s === 'calculated' || s === 'resolver' || s === 'formula' || s === 'derived' || s.startsWith('calc')) return 'calculated'
  return null
}

export function sourceLabel(source: string | null | undefined): string {
  if (!source) return 'Нет источника'
  if (source === 'gri_assessment') return 'GRI-оценка'
  const bucket = sourceBucket(source)
  return bucket ? SOURCE_FILTER_OPTIONS.find((o) => o.value === bucket)!.label : source
}

export const CONFIDENCE_OPTIONS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 0, label: 'Любая' },
  { value: 0.5, label: '≥ 50%' },
  { value: 0.7, label: '≥ 70%' },
  { value: 0.9, label: '≥ 90%' },
]

// ─── Client-side filters ────────────────────────────────────────────────────

export const PERIOD_ANY = '__any__'
export const PERIOD_NONE = '__none__'

export interface CatalogClientFilters {
  category: MetricCategoryKey | 'all'
  subcategory: string | null
  statuses: MetricStatus[]
  sources: SourceBucket[]
  minConfidence: number
  period: string
}

export const DEFAULT_CLIENT_FILTERS: CatalogClientFilters = {
  category: 'all',
  subcategory: null,
  statuses: [],
  sources: [],
  minConfidence: 0,
  period: PERIOD_ANY,
}

export function applyClientFilters(items: ReadonlyArray<CatalogItem>, f: CatalogClientFilters): CatalogItem[] {
  return items.filter((it) => {
    if (f.category !== 'all' && it.category !== f.category) return false
    if (f.subcategory && it.subcategory !== f.subcategory) return false
    if (f.statuses.length && !f.statuses.includes(it.status)) return false
    if (f.sources.length) {
      const b = sourceBucket(it.source)
      if (!b || !f.sources.includes(b)) return false
    }
    if (f.minConfidence > 0 && (it.confidence === null || it.confidence < f.minConfidence)) return false
    if (f.period === PERIOD_NONE && it.period) return false
    if (f.period !== PERIOD_ANY && f.period !== PERIOD_NONE && it.period !== f.period) return false
    return true
  })
}

export function activeFilterCount(f: CatalogClientFilters): number {
  return (
    f.statuses.length +
    f.sources.length +
    (f.minConfidence > 0 ? 1 : 0) +
    (f.period !== PERIOD_ANY ? 1 : 0)
  )
}

/** Distinct value periods for the period filter, newest-looking first. */
export function periodOptions(items: ReadonlyArray<Pick<CatalogItem, 'period'>>): string[] {
  const set = new Set<string>()
  for (const it of items) if (it.period) set.add(it.period)
  return Array.from(set).sort((a, b) => b.localeCompare(a, 'ru'))
}

// ─── Direction, delta, target progress ──────────────────────────────────────

const LOWER_IS_BETTER = /\bcac\b|cpl|churn|отток|текучест|расход|себестоим|цикл|время|time to|срок|брак|возврат|дебитор|loss rate|payback|окупаем|стоимость лида|стоимость привлеч|дней|\(дни\)/i

/** true when a decrease is good. Target direction, then benchmark direction, then a label heuristic. */
export function isLowerBetter(item: Pick<CatalogItem, 'label' | 'target'> & { benchmark?: MetricBenchmark | null }): boolean {
  if (item.target?.direction === 'lower_is_better') return true
  if (item.target?.direction === 'higher_is_better') return false
  if (item.benchmark?.direction === 'lower_is_better') return true
  if (item.benchmark?.direction === 'higher_is_better') return false
  return LOWER_IS_BETTER.test(item.label)
}

/** Value as shown to the user: «Да» / «Нет» for flag metrics, else number + unit. */
export function formatItemValue(
  item: { value: number | string | null; unit: string; valueKind?: 'number' | 'flag' },
  value: number | string | null = item.value,
): string {
  if (value === null || value === '') return '—'
  if (item.valueKind === 'flag') {
    const n = numericValue(value)
    if (n === 1) return 'Да'
    if (n === 0) return 'Нет'
  }
  return formatRuMetricWithUnit(value, item.unit)
}

export type DeltaTone = 'good' | 'bad' | 'neutral'

export function deltaTone(
  item: Pick<CatalogItem, 'label' | 'target' | 'delta' | 'deltaPct'> & { benchmark?: MetricBenchmark | null },
): DeltaTone {
  const d = item.deltaPct ?? item.delta
  if (d === null || d === 0) return 'neutral'
  const up = d > 0
  const lower = isLowerBetter(item)
  return up !== lower ? 'good' : 'bad'
}

/** 0..1 share of the target reached (direction-aware), null without target/value. */
export function targetProgress(item: Pick<CatalogItem, 'value' | 'target'>): number | null {
  const v = numericValue(item.value)
  const t = item.target?.value
  if (v === null || t === undefined || t === null || !Number.isFinite(t) || t === 0) return null
  const ratio = item.target!.direction === 'lower_is_better' ? (v === 0 ? 1 : t / v) : v / t
  return Math.max(0, Math.min(1, ratio))
}

export const TARGET_SOURCE_LABEL: Record<MetricTarget['source'], string> = {
  owner: 'цель владельца',
  expert: 'цель эксперта',
  agent: 'предложено ИИ',
  survey: 'из анкеты',
}

export function targetPeriodLabel(periodLabel: string | null | undefined): string {
  if (!periodLabel) return ''
  const m = periodLabel.match(/^(\d+)\s*(m|y)$/i)
  if (!m) return periodLabel
  const n = Number(m[1])
  return m[2].toLowerCase() === 'm' ? `${n} мес` : n === 1 ? '1 год' : n < 5 ? `${n} года` : `${n} лет`
}

export const BENCHMARK_KIND_LABEL: Record<MetricBenchmark['kind'], string> = {
  expert_estimate: 'экспертная оценка',
  industry_report: 'отраслевой отчёт',
  peer_group: 'похожие компании',
}

// ─── Provenance chain ───────────────────────────────────────────────────────

export interface ProvenanceStep {
  key: 'source' | 'raw' | 'transform' | 'metric'
  title: string
  body: string
  muted?: boolean
}

function describeSource(s: CatalogItemSource): string {
  switch (s.type) {
    case 'survey':
      return `Анкета${s.step ? `, шаг ${s.step}` : ''}${s.label ? ` — «${s.label}»` : ''}${s.key ? ` (${s.key})` : ''}`
    case 'document':
      return `Документ${s.doc_type ? ` (${s.doc_type})` : ''}${s.field ? `, поле ${s.field}` : ''}`
    case 'prisma':
      return 'CRM / база платформы'
    case 'external':
      return `Интеграция${s.system ? `: ${s.system}` : ''}`
    case 'manual':
      return 'Введено вручную'
    default:
      return s.type
  }
}

function describeCoerce(c: CatalogItemSource['coerce']): string | null {
  if (!c) return null
  switch (c.kind) {
    case 'flag':
      return 'Ответ «да/нет» переведён в 1/0'
    case 'choice':
      return 'Вариант ответа переведён в число по шкале'
    case 'count_selected':
      return 'Посчитано число выбранных вариантов'
    case 'table_cell':
      return `Взята ячейка таблицы метрик анкеты${c.column ? ` (${c.column})` : ''}`
    default:
      return null
  }
}

/**
 * Source → raw value → transformation → metric. Built only from what the
 * catalog returns; unknown steps say so instead of guessing.
 */
export function buildProvenanceChain(
  item: Pick<CatalogItem, 'sources' | 'source' | 'value' | 'unit' | 'formula' | 'calculationMethod' | 'provenanceType' | 'confidence' | 'lastUpdated'>,
  formatValue: (v: number | string | null, unit: string) => string,
): ProvenanceStep[] {
  const hasValue = item.value !== null && item.value !== ''
  if (!hasValue) {
    return [
      {
        key: 'source',
        title: 'Источник',
        body: item.sources.length
          ? `Ни один из ${item.sources.length} источников пока не дал значения`
          : 'Источники для этой метрики не описаны',
        muted: true,
      },
    ]
  }
  const picked = item.sources.filter((s) => {
    if (!item.source) return false
    if (item.source === 'gri_assessment') return false
    return s.type === item.source || (item.source === 'external' && s.type === 'prisma')
  })
  const sourceBody =
    item.source === 'gri_assessment'
      ? 'GRI-оценка — средний балл раздела'
      : picked.length === 1
        ? describeSource(picked[0])
        : picked.length > 1
          ? `${sourceLabel(item.source)} — одно из полей: ${picked.map(describeSource).join('; ')}`
          : sourceLabel(item.source)

  const isFact = item.provenanceType === 'FACT' || (item.provenanceType === null && item.source !== 'calculated')
  const coerce = picked.length === 1 ? describeCoerce(picked[0].coerce) : null
  const method = item.calculationMethod ?? item.formula

  const steps: ProvenanceStep[] = [
    { key: 'source', title: 'Источник', body: sourceBody },
    {
      key: 'raw',
      title: 'Исходное значение',
      body: isFact
        ? `${formatValue(item.value, item.unit)} — как указано в источнике`
        : 'Входные данные формулы из источника',
    },
    {
      key: 'transform',
      title: 'Преобразование',
      body: isFact
        ? coerce ?? 'Без пересчёта: проверка единиц и правдоподобия значения'
        : method ?? 'Расчёт по формуле реестра метрик',
    },
    {
      key: 'metric',
      title: 'Метрика',
      body: `${formatValue(item.value, item.unit)}${
        item.confidence !== null ? ` · уверенность ${Math.round(item.confidence * 100)}%` : ''
      }`,
    },
  ]
  return steps
}

// ─── Adapters ───────────────────────────────────────────────────────────────

function definitionCategory(c: MetricCategoryKey | null): MetricDefinition['category'] {
  if (c === 'finance') return 'financial'
  if (c === 'sales' || c === 'marketing' || c === 'customers') return 'customer'
  if (c === 'growth_goals' || c === 'gri' || c === null) return 'custom'
  return 'operational'
}

/** Catalog item → legacy MetricDefinition (AddMetricModal / useAllVisibleMetrics). */
export function catalogItemToDefinition(item: CatalogItem): MetricDefinition {
  return {
    id: item.id,
    label: item.label,
    description: item.description ?? item.categoryLabel ?? '',
    category: definitionCategory(item.category),
    icon: item.category ? CATEGORY_ICONS[item.category] : 'bar_chart',
    unit: item.unit === 'count' || item.unit === 'days' ? '' : item.unit,
    unitPosition: 'after',
    color: '#6effc0',
    isDefault: false,
    isRemovable: true,
  }
}

/** Unit as shown next to a big number: 'count' → '', 'days' → 'дн.'. */
export function displayUnit(unit: string | null | undefined): string {
  if (!unit || unit === 'count') return ''
  if (unit === 'days') return 'дн.'
  return unit
}
