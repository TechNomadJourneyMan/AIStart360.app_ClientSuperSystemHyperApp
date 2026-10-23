/**
 * lib/survey/calcs/chart.ts — numbers of a field-calculation chart as text:
 * the hidden table next to the chart (screen readers) and the tooltip values.
 */
import { fmtMoney, fmtNum } from '@/lib/point-b/model/format'
import type { CalcChart, CalcUnit } from './types'

/** 4 200 000 → «4,2 млн ₸»; 12.5 → «12,5 %»; 60 → «60 шт.». */
export function formatChartValue(v: number, unit: CalcUnit): string {
  switch (unit) {
    case '₸': return fmtMoney(v)
    case '%': return `${fmtNum(v, Math.abs(v) < 10 && !Number.isInteger(v) ? 1 : 0)} %`
    case 'шт.': return `${fmtNum(v, 0)} шт.`
    case 'заявок': return `${fmtNum(v, 0)} заявок`
  }
}

export interface ChartTable {
  head: string[]
  rows: string[][]
}

/** The chart as a table: one row per bar (or per label of a pair). */
export function chartRows(chart: CalcChart): ChartTable {
  if (chart.kind === 'pairs') {
    return {
      head: ['', chart.names[0], chart.names[1]],
      rows: chart.series.map((p) => [p.label, formatChartValue(p.a, chart.unit), formatChartValue(p.b, chart.unit)]),
    }
  }
  return {
    head: ['', 'Значение'],
    rows: chart.series.map((p) => [p.label, formatChartValue(p.value, chart.unit)]),
  }
}
