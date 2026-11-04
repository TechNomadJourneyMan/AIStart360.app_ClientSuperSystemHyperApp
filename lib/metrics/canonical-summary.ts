import type { MetricSummary } from '@/types/metrics'

export interface CanonicalMetricRow {
  metric_key: string
  metric_value: number | string | null
  metric_unit: string | null
  period_year: number | null
  period_quarter: string | null
  period_month: number | null
  computed_at: string | null
  recorded_at: string | null
}

interface KpiSpec {
  id: string
  label: string
  aliases: readonly string[]
  unit: string
  unitPosition: 'before' | 'after'
  icon: string
  color: string
  isDefault: boolean
}

const KPI_SPECS: readonly KpiSpec[] = [
  {
    id: 'revenue',
    label: 'Выручка',
    aliases: [
      'biz.finansy.vyruchka_god',
      'survey.s2_revenue_2025',
      'survey.s9n_revenue_2024',
      'survey.s2_revenue_2024',
      'survey.s2_revenue_2023',
    ],
    unit: '₸',
    unitPosition: 'before',
    icon: 'payments',
    color: '#6effc0',
    isDefault: true,
  },
  {
    id: 'margin',
    label: 'Маржинальность',
    aliases: ['biz.finansy.valovaya_marzha', 'survey.s2_gross_margin', 'survey.s9n_net_margin'],
    unit: '%',
    unitPosition: 'after',
    icon: 'percent',
    color: '#7dd3fc',
    isDefault: true,
  },
  {
    id: 'clients',
    label: 'Клиенты',
    aliases: [
      'biz.klienty.aktivnykh_klientov',
      'survey.s2_new_clients_2025',
      'survey.s2_new_clients_2024',
      'survey.s2_new_clients_2023',
    ],
    unit: '',
    unitPosition: 'after',
    icon: 'groups',
    color: '#a78bfa',
    isDefault: true,
  },
  {
    id: 'avg_check',
    label: 'Средний чек',
    aliases: ['biz.prodazhi.sredniy_chek', 'survey.s2_avg_check'],
    unit: '₸',
    unitPosition: 'before',
    icon: 'receipt_long',
    color: '#fbbf24',
    isDefault: true,
  },
  {
    id: 'ltv',
    label: 'LTV',
    aliases: ['goal.04.ltv', 'survey.s2_ltv'],
    unit: '₸',
    unitPosition: 'before',
    icon: 'savings',
    color: '#34d399',
    isDefault: false,
  },
  {
    id: 'cac',
    label: 'CAC',
    aliases: ['biz.marketing.cac', 'survey.s2_cac'],
    unit: '₸',
    unitPosition: 'before',
    icon: 'shopping_cart_checkout',
    color: '#fb7185',
    isDefault: false,
  },
  {
    id: 'no_show_rate',
    label: 'Процент неявок',
    aliases: ['survey.s7_no_show_rate'],
    unit: '%',
    unitPosition: 'after',
    icon: 'event_busy',
    color: '#f59e0b',
    isDefault: false,
  },
] as const

export const CANONICAL_KPI_ALIASES = [
  ...new Set(KPI_SPECS.flatMap((spec) => spec.aliases)),
]

function numericValue(value: number | string | null): number | null {
  if (value === null || value === undefined) return null
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function rowTimestamp(row: CanonicalMetricRow): number {
  const timestamp = Date.parse(row.computed_at ?? row.recorded_at ?? '')
  return Number.isNaN(timestamp) ? 0 : timestamp
}

function rowPeriodRank(row: CanonicalMetricRow): number {
  return (row.period_year ?? 0) * 1000
    + (row.period_month ?? 0) * 10
    + Number(row.period_quarter?.replace('Q', '') ?? 0)
}

function compareRows(a: CanonicalMetricRow, b: CanonicalMetricRow): number {
  return rowPeriodRank(b) - rowPeriodRank(a) || rowTimestamp(b) - rowTimestamp(a)
}

function formatNumber(value: number, unit: string, position: 'before' | 'after'): string {
  const compact = Math.abs(value) >= 10_000
  const formatted = new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: 1,
    notation: compact ? 'compact' : 'standard',
  }).format(value)
  if (!unit) return formatted
  return position === 'before' ? `${unit}${formatted}` : `${formatted}${unit}`
}

function periodLabel(row: CanonicalMetricRow): string | null {
  if (row.period_month && row.period_year) {
    return new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' })
      .format(new Date(Date.UTC(row.period_year, row.period_month - 1, 1)))
  }
  if (row.period_quarter && row.period_year) return `${row.period_quarter} ${row.period_year}`
  if (row.period_year) return String(row.period_year)
  return null
}

export function buildCanonicalMetricSummaries(rows: CanonicalMetricRow[]): MetricSummary[] {
  return KPI_SPECS.flatMap((spec) => {
    const alias = spec.aliases.find((candidate) => (
      rows.some((row) => row.metric_key === candidate && numericValue(row.metric_value) !== null)
    ))
    if (!alias) return []

    const matchingRows = rows
      .filter((row) => row.metric_key === alias && numericValue(row.metric_value) !== null)
      .sort(compareRows)
    const current = matchingRows[0]
    if (!current) return []

    const rawValue = numericValue(current.metric_value)
    if (rawValue === null) return []

    const previous = matchingRows.slice(1).find((row) => (
      row.period_year !== current.period_year
      || row.period_quarter !== current.period_quarter
      || row.period_month !== current.period_month
    ))
    const previousValue = previous ? numericValue(previous.metric_value) : null
    const hasTrend = previousValue !== null && previousValue !== 0
    const trend = hasTrend ? ((rawValue - previousValue) / Math.abs(previousValue)) * 100 : 0
    const actualUnit = current.metric_unit || spec.unit
    const unitPosition = actualUnit === '₸' || actualUnit.toUpperCase() === 'KZT'
      ? 'before'
      : spec.unitPosition
    const displayUnit = actualUnit.toUpperCase() === 'KZT' ? '₸' : actualUnit
    const currentPeriod = periodLabel(current)
    const previousPeriod = previous ? periodLabel(previous) : null

    return [{
      id: spec.id,
      label: spec.label,
      displayValue: formatNumber(rawValue, displayUnit, unitPosition),
      rawValue,
      unit: displayUnit,
      unitPosition,
      trend,
      trendAbs: hasTrend && previousValue !== null ? rawValue - previousValue : 0,
      trendDirection: !hasTrend ? 'flat' : trend > 0 ? 'up' : trend < 0 ? 'down' : 'flat',
      trendLabel: hasTrend
        ? `${currentPeriod ?? 'текущее'} к ${previousPeriod ?? 'предыдущему периоду'}`
        : `${currentPeriod ? `${currentPeriod} · ` : ''}сравнение недоступно`,
      icon: spec.icon,
      color: spec.color,
      goalCategory: null,
      isDefault: spec.isDefault,
      isRemovable: !spec.isDefault,
    } satisfies MetricSummary]
  })
}
