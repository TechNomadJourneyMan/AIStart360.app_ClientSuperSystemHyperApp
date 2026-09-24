/**
 * lib/analytics/reports.ts — shapes and pure helpers for the admin analytics
 * (DAU/WAU/MAU series, retention cohorts, activation, Free→Pro) shared by the
 * API routes, the CSV export and the UI. No I/O here.
 */
import { JOURNEY_LABEL } from '@/lib/admin/journey'

export interface ActivityPoint {
  day: string
  dau: number
  wau: number
  mau: number
  /** DAU / MAU, % (null when MAU = 0). */
  stickiness: number | null
  new_users: number
  /** The day was rolled up (false = no data yet, not «zero activity»). */
  rolled: boolean
}

export interface CohortRow {
  cohort_start: string
  cohort_size: number
  d1: number | null
  d7: number | null
  d30: number | null
  /** W1..W8 retention, % (null = week not reached yet). */
  weeks: Array<number | null>
}

export interface ActivationStats {
  event: string
  window_days: number
  days: number
  registered: number
  activated: number
  pending: number
  rate: number | null
}

export interface FreeToProStats {
  days: number
  conversions: number
  free_now: number
  pro_now: number
  rate: number | null
}

export const ACTIVATION_EVENT_LABEL: Record<string, string> = {
  GRI_COMPLETED: 'GRI пройден',
  QUESTIONNAIRE_COMPLETED: 'анкета заполнена',
  POINT_A_CALCULATED: 'Точка А рассчитана',
}

export const COHORT_WEEKS = 8

const num = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0)
const pct = (v: unknown): number | null => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))
const day = (v: unknown): string => String(v ?? '').slice(0, 10)

export function normalizeSeries(rows: unknown): ActivityPoint[] {
  if (!Array.isArray(rows)) return []
  return rows.map((r) => {
    const o = (r ?? {}) as Record<string, unknown>
    return {
      day: day(o.day),
      dau: num(o.dau),
      wau: num(o.wau),
      mau: num(o.mau),
      stickiness: pct(o.stickiness),
      new_users: num(o.new_users),
      rolled: o.rolled === true,
    }
  }).filter((p) => p.day)
}

export function normalizeCohorts(rows: unknown): CohortRow[] {
  if (!Array.isArray(rows)) return []
  return rows.map((r) => {
    const o = (r ?? {}) as Record<string, unknown>
    const weeks = Array.isArray(o.weeks) ? (o.weeks as unknown[]).map(pct) : []
    while (weeks.length < COHORT_WEEKS) weeks.push(null)
    return {
      cohort_start: day(o.cohort_start),
      cohort_size: num(o.cohort_size),
      d1: pct(o.d1),
      d7: pct(o.d7),
      d30: pct(o.d30),
      weeks: weeks.slice(0, COHORT_WEEKS),
    }
  }).filter((c) => c.cohort_start)
}

export function normalizeActivation(raw: unknown): ActivationStats | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  return {
    event: String(o.event ?? ''),
    window_days: num(o.window_days),
    days: num(o.days),
    registered: num(o.registered),
    activated: num(o.activated),
    pending: num(o.pending),
    rate: pct(o.rate),
  }
}

export function normalizeFreeToPro(raw: unknown): FreeToProStats | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  return { days: num(o.days), conversions: num(o.conversions), free_now: num(o.free_now), pro_now: num(o.pro_now), rate: pct(o.rate) }
}

/**
 * Heatmap cell opacity for a retention % (0..100): never fully transparent for
 * a real value so «0%» is still distinguishable from «no data».
 */
export function cohortCellOpacity(value: number | null): number {
  if (value === null) return 0
  const v = Math.max(0, Math.min(100, value))
  return Math.round((0.08 + (v / 100) * 0.82) * 100) / 100
}

export function fmtPct(value: number | null): string {
  return value === null ? '—' : `${value.toLocaleString('ru-RU', { maximumFractionDigits: 1 })}%`
}

// ─── CSV rows ────────────────────────────────────────────────────────────────

export type CsvTable = { headers: string[]; rows: Array<Array<string | number | null>> }

export function activityCsv(series: ActivityPoint[]): CsvTable {
  return {
    headers: ['День', 'DAU', 'WAU (7 дн)', 'MAU (30 дн)', 'Stickiness DAU/MAU, %', 'Новые активные', 'Свёрнут'],
    rows: series.map((p) => [p.day, p.dau, p.wau, p.mau, p.stickiness, p.new_users, p.rolled ? 'да' : 'нет']),
  }
}

export function cohortsCsv(cohorts: CohortRow[]): CsvTable {
  return {
    headers: ['Неделя регистрации', 'Размер когорты', 'D1, %', 'D7, %', 'D30, %', ...Array.from({ length: COHORT_WEEKS }, (_, i) => `W${i + 1}, %`)],
    rows: cohorts.map((c) => [c.cohort_start, c.cohort_size, c.d1, c.d7, c.d30, ...c.weeks]),
  }
}

export function funnelCsv(funnel: Array<{ key: string; count: number }>): CsvTable {
  const top = funnel[0]?.count ?? 0
  return {
    headers: ['Этап', 'Ключ', 'Пользователей', 'Доля от регистраций, %', 'Отсев от предыдущего, %'],
    rows: funnel.map((f, i) => {
      const prev = i > 0 ? funnel[i - 1].count : null
      return [
        JOURNEY_LABEL[f.key] ?? f.key,
        f.key,
        f.count,
        top ? Math.round((f.count / top) * 1000) / 10 : null,
        prev && f.count < prev ? Math.round(((prev - f.count) / prev) * 1000) / 10 : null,
      ]
    }),
  }
}
