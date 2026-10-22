/**
 * lib/point-b/planfact/kpis.ts — the key KPIs of a plan in the plan-fact: labels, units, formatting, the limits of
 * the «Факт за месяц» form and the Point A metric each one is read from. Pure.
 */
import { fmtMoney, fmtNum } from '../model/format'
import type { PlanKpi } from './types'

export interface KpiMeta {
  label: string
  /** For the reason sentence: «конверсия 11% при плане 13%». */
  short: string
  unit: 'money' | 'count' | 'percent'
  /** The Point A metric of the facts (metric_facts), null = only the reconciliation gives it. */
  metricKey: string | null
  min: number
  max: number
  integer: boolean
  hint: string
}

export const KPI_META: Record<PlanKpi, KpiMeta> = {
  revenue: {
    label: 'Выручка за месяц', short: 'выручка', unit: 'money', metricKey: 'biz.finansy.vyruchka_god',
    min: 0, max: 1e13, integer: false, hint: 'Сколько денег пришло от продаж за месяц, ₸',
  },
  leads: {
    label: 'Лиды за месяц', short: 'лиды', unit: 'count', metricKey: 'biz.marketing.lidov_v_mes',
    min: 0, max: 1e7, integer: true, hint: 'Сколько обращений или заявок получили за месяц',
  },
  conversion: {
    label: 'Конверсия лида в клиента', short: 'конверсия', unit: 'percent', metricKey: 'biz.marketing.konversiya_lid_klient',
    min: 0, max: 100, integer: false, hint: 'Какая доля лидов стала клиентами, %',
  },
  avg_check: {
    label: 'Средний чек', short: 'средний чек', unit: 'money', metricKey: 'biz.prodazhi.sredniy_chek',
    min: 0, max: 1e11, integer: false, hint: 'Средняя сумма одной покупки, ₸',
  },
  cash: {
    label: 'Деньги на счетах', short: 'деньги на счетах', unit: 'money', metricKey: null,
    min: -1e13, max: 1e13, integer: false, hint: 'Остаток на всех счетах и в кассе на конец месяца, ₸',
  },
}

export function fmtKpi(kpi: PlanKpi, v: number | null | undefined): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—'
  const u = KPI_META[kpi].unit
  if (u === 'money') return fmtMoney(v)
  if (u === 'percent') return `${fmtNum(v, Number.isInteger(Math.round(v * 10) / 10) ? 0 : 1)}%`
  return fmtNum(v, 0)
}

const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь']
const MONTHS_GEN = ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре']

export const PERIOD_RE = /^(\d{4})-(0[1-9]|1[0-2])$/

/** «2026-09» → «сентябрь 2026». */
export function periodLabel(period: string): string {
  const m = PERIOD_RE.exec(period)
  return m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : period
}

/** «2026-09» → «в сентябре 2026». */
export function periodIn(period: string): string {
  const m = PERIOD_RE.exec(period)
  return m ? `в ${MONTHS_GEN[Number(m[2]) - 1]} ${m[1]}` : period
}

/** Ordinal of a month (year × 12 + month − 1), null for anything else. */
export function periodOrdinal(period: string | null | undefined): number | null {
  const m = typeof period === 'string' ? PERIOD_RE.exec(period) : null
  return m ? Number(m[1]) * 12 + Number(m[2]) - 1 : null
}

export function periodOf(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

export function addPeriods(period: string, n: number): string {
  const o = periodOrdinal(period)
  if (o === null) return period
  const t = o + n
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`
}

/** The last FINISHED month of `now` (what the monthly reconciliation asks about). */
export const lastFinishedPeriod = (now: Date): string => addPeriods(periodOf(now), -1)
