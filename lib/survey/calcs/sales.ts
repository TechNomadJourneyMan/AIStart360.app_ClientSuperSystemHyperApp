/**
 * lib/survey/calcs/sales.ts — sales calculations under the fields (spec
 * 2026-10-23 §9.2): check_x_sales, funnel, refusals_share, repeat_rate.
 * Only the owner's own numbers; a disagreement of two own figures is asked
 * as a question, never shown as an error.
 */
import {
  metricsTableCell, metricsTableColumnLabel, readMetricsTable, type MetricsTableColumn,
} from '@/lib/survey/metrics-table'
import {
  combine, exact, hasAnyInput, inputLabel, isNum, needs, readAmount, readDays, readPercent, show, sourceOf,
  tableSource, uniq, type Answers, type Num,
} from './inputs'
import { count, money, pct, plain } from './fmt'
import type { CalcChart, CalcResult } from './types'

// ─── check_x_sales ──────────────────────────────────────────────────────────

const CHECK_COLUMNS: readonly MetricsTableColumn[] = ['y2023', 'y2024', 'y2025', 'fact_2026']
/** Within 5 % the two figures agree. */
const AGREE = 0.05

export function checkXSales(answers: Answers): CalcResult | null {
  const table = readMetricsTable(answers.s8n_metrics_table)
  if (!table.avg_check && !table.sales_count && !table.sales_amount) return null
  const title = 'Чек × продажи'
  const how = 'Средний чек × количество продаж за год сравнивается с суммой продаж того же года (таблица метрик). Расхождение до 5 % считаем «сходится».'
  const sources = [tableSource('средний чек'), tableSource('количество продаж'), tableSource('сумма продаж')]

  const years: Array<{ col: MetricsTableColumn; product: number; amount: number; diff: number }> = []
  for (const col of CHECK_COLUMNS) {
    const check = metricsTableCell(table, 'avg_check', col)
    const n = metricsTableCell(table, 'sales_count', col)
    const amount = metricsTableCell(table, 'sales_amount', col)
    if (!check || !n || !amount || check.value <= 0 || n.value <= 0 || amount.value <= 0) continue
    const product = check.value * n.value
    years.push({ col, product, amount: amount.value, diff: Math.abs(product - amount.value) / amount.value })
  }
  if (years.length === 0) {
    const missing: string[] = []
    if (!table.avg_check) missing.push('средний чек (таблица метрик)')
    if (!table.sales_count) missing.push('количество продаж (таблица метрик)')
    if (!table.sales_amount) missing.push('сумма продаж (таблица метрик)')
    if (missing.length === 0) missing.push('средний чек, количество и сумма продаж за один и тот же год')
    return needs('check_x_sales', title, missing, sources, how)
  }

  const off = years.filter((y) => y.diff > AGREE)
  const lines: string[] = []
  if (off.length === 0) {
    lines.push(`Сходится: средний чек × количество продаж ≈ сумме продаж (${years.map((y) => metricsTableColumnLabel(y.col)).join(', ')}).`)
  } else {
    const last = off[off.length - 1]
    lines.push(`${metricsTableColumnLabel(last.col)}: чек × продажи = ${money(last.product)}, а сумма продаж — ${money(last.amount)} (расхождение ${pct(last.diff * 100)}). Так и есть (например, абонементы или повторные оплаты) или где-то опечатка?`)
    const others = off.slice(0, -1).map((y) => metricsTableColumnLabel(y.col))
    if (others.length > 0) lines.push(`Расхождение больше 5 % и за ${others.join(', ')}.`)
  }
  return {
    id: 'check_x_sales', title, lines,
    chart: { kind: 'pairs', unit: '₸', names: ['Чек × продажи', 'Сумма продаж'], series: years.map((y) => ({ label: metricsTableColumnLabel(y.col), a: Math.round(y.product), b: Math.round(y.amount) })) },
    approx: false, missing: [], sources, how,
  }
}

// ─── funnel ─────────────────────────────────────────────────────────────────

const STAGES = [
  ['s5n_funnel_lead_to_call', 'Лид → Звонок', 'Звонок'],
  ['s5n_funnel_call_to_meeting', 'Звонок → Встреча', 'Встреча'],
  ['s5n_funnel_meeting_to_proposal', 'Встреча → КП', 'КП'],
  ['s5n_funnel_proposal_to_negotiation', 'КП → Переговоры', 'Переговоры'],
  ['s5n_funnel_negotiation_to_contract', 'Переговоры → Договор', 'Договор'],
  ['s5n_funnel_contract_to_payment', 'Договор → Оплата', 'Оплата'],
  ['s5n_funnel_payment_to_delivery', 'Оплата → Поставка', 'Поставка'],
] as const

export const FUNNEL_KEYS: readonly string[] = [...STAGES.map((s) => s[0]), 's5n_funnel_lead_to_sale', 's7_leads_per_month']

const validPct = (r: ReturnType<typeof readPercent>): r is Num => isNum(r) && r.v >= 0 && r.v <= 100 && r.lo >= 0 && r.hi <= 100

export function funnel(answers: Answers): CalcResult | null {
  if (!hasAnyInput(answers, FUNNEL_KEYS)) return null
  const title = 'Воронка продаж'
  const how = 'Конверсия по этапам = произведение конверсий заполненных этапов; продаж в месяц = лидов в месяц × конверсия «лид → продажа» (если её нет — конверсия по этапам).'

  const stages: Array<{ key: string; name: string; to: string; num: Num }> = []
  const missing: string[] = []
  for (const [key, name, to] of STAGES) {
    const r = readPercent(answers, key)
    if (validPct(r)) stages.push({ key, name, to, num: r })
    else if (r === 'unknown' || isNum(r)) missing.push(`конверсия «${name}»`)
  }
  const overallRaw = readPercent(answers, 's5n_funnel_lead_to_sale')
  const overall = validPct(overallRaw) ? overallRaw : null
  if (!overall) missing.push(inputLabel('s5n_funnel_lead_to_sale'))
  const leadsRaw = readAmount(answers, 's7_leads_per_month')
  const leads = isNum(leadsRaw) && leadsRaw.v >= 0 ? leadsRaw : null
  if (!leads) missing.push(inputLabel('s7_leads_per_month'))

  const product = stages.length >= 2 ? combine(stages.map((s) => s.num), (xs) => xs.reduce((p, x) => p * (x / 100), 1) * 100) : null
  const conv = overall ?? product
  const sources = [
    ...stages.map((s) => `конверсия «${s.name}» (шаг 5)`),
    ...(overall ? [sourceOf('s5n_funnel_lead_to_sale')] : []),
    ...(leads ? [sourceOf('s7_leads_per_month')] : []),
  ]
  if (!product && !(leads && conv)) {
    const ask = stages.length < 2 && !overall ? [inputLabel('s5n_funnel_lead_to_sale'), ...missing] : missing
    return needs('funnel', title, ask.length ? ask : ['конверсии хотя бы двух этапов'], sources, how)
  }

  const lines: string[] = []
  if (leads && conv) {
    const sales = combine([leads, conv], ([l, c]) => l * (c / 100))!
    lines.push(`Из ${count(leads.v)} заявок ${show(sales, count, '≈ ')} продаж в месяц.`)
  }
  if (product && overall) {
    const o = overall.v
    const p = product.v
    if (Math.abs(p - o) > Math.max(1, 0.25 * o)) {
      lines.push(`По этапам выходит ${show(product, pct)}, а общая конверсия — ${show(overall, pct)}: проверьте этапы или общую цифру.`)
    } else {
      lines.push(`По этапам выходит ${show(product, pct)} — сходится с общей конверсией ${show(overall, pct)}.`)
    }
  } else if (product) {
    lines.push(`По этапам из 100 заявок до последнего заполненного этапа доходит ${show(product, count, '≈ ')}.`)
  }
  if (stages.length >= 2) {
    const weakest = stages.reduce((a, b) => (b.num.v < a.num.v ? b : a))
    lines.push(`Меньше всего проходит этап «${weakest.name}» — ${show(weakest.num, pct)}.`)
  }

  let chart: CalcChart | undefined
  if (stages.length >= 2) {
    let left = 100
    const series = [{ label: 'Заявки', value: 100 }]
    for (const s of stages) {
      left = left * (s.num.v / 100)
      series.push({ label: s.to, value: Math.round(left * 10) / 10 })
    }
    chart = { kind: 'bars', unit: 'заявок', series }
  }
  return {
    id: 'funnel', title, lines, chart,
    approx: [...stages.map((s) => s.num), overall, leads].some((n) => !!n && n.approx),
    missing: uniq(missing),
    sources: uniq(sources), how,
  }
}

// ─── refusals_share ─────────────────────────────────────────────────────────

const REFUSAL_YEARS = [2023, 2024, 2025] as const

export function refusalsShare(answers: Answers): CalcResult | null {
  const keys = REFUSAL_YEARS.flatMap((y) => [`s3_deals_${y}`, `s3_rejections_${y}`])
  if (!hasAnyInput(answers, keys)) return null
  const title = 'Доля отказов'
  const how = 'Доля отказов за год = отказы ÷ (сделки + отказы).'

  const points: Array<{ year: number; share: Num }> = []
  const missing: string[] = []
  const sources: string[] = []
  for (const y of REFUSAL_YEARS) {
    const d = readAmount(answers, `s3_deals_${y}`)
    const r = readAmount(answers, `s3_rejections_${y}`)
    const dOk = isNum(d) && d.v >= 0
    const rOk = isNum(r) && r.v >= 0
    if (dOk && rOk) {
      const share = combine([d, r], ([a, b]) => (a + b > 0 ? (b / (a + b)) * 100 : null))
      if (share) {
        points.push({ year: y, share })
        sources.push(sourceOf(`s3_deals_${y}`), sourceOf(`s3_rejections_${y}`))
      }
    } else if (d !== null || r !== null) {
      if (!dOk) missing.push(inputLabel(`s3_deals_${y}`))
      if (!rOk) missing.push(inputLabel(`s3_rejections_${y}`))
    }
  }
  if (points.length === 0) return needs('refusals_share', title, missing.length ? missing : ['сделки и отказы за один год'], sources, how)

  const latest = points[points.length - 1]
  const before = points.slice(0, -1).reverse().map((p) => `${show(p.share, pct)} в ${p.year}`)
  const lines = [`Отказов ${show(latest.share, pct)} в ${latest.year}${before.length ? `, было ${before.join(', ')}` : ''}.`]
  return {
    id: 'refusals_share', title, lines,
    chart: points.length >= 2 ? { kind: 'bars', unit: '%', series: points.map((p) => ({ label: String(p.year), value: Math.round(p.share.v * 10) / 10 })) } : undefined,
    approx: points.some((p) => p.share.approx),
    missing: uniq(missing), sources: uniq(sources), how,
  }
}

// ─── repeat_rate ────────────────────────────────────────────────────────────

export function repeatRate(answers: Answers): CalcResult | null {
  if (!hasAnyInput(answers, ['s7_repeat_freq_days'])) return null
  const title = 'Повторные покупки'
  const how = 'Покупок в год = 365 ÷ дней между покупками. Деньги с клиента за год = покупок в год × средний чек.'
  const days = readDays(answers, 's7_repeat_freq_days')
  if (!isNum(days) || days.v <= 0 || days.lo <= 0) return needs('repeat_rate', title, [inputLabel('s7_repeat_freq_days')], [], how)
  const times = combine([days], ([d]) => 365 / d)!
  const sources = [sourceOf('s7_repeat_freq_days')]
  const lines = [`Постоянный клиент покупает ${show(times, (x) => (x >= 10 ? count(x) : plain(x)), '≈ ')} раз в год (раз в ${count(days.v)} дн.).`]
  const cell = metricsTableCell(readMetricsTable(answers.s8n_metrics_table), 'avg_check', 'latest')
  const target = readAmount(answers, 's7_avg_check_target_kzt')
  const check: { num: Num; source: string } | null = cell && cell.value > 0
    ? { num: exact(cell.value), source: tableSource('средний чек') }
    : isNum(target) && target.v > 0 ? { num: target, source: sourceOf('s7_avg_check_target_kzt') } : null
  let approx = times.approx
  if (check) {
    const perYear = combine([days, check.num], ([d, c]) => (365 / d) * c)!
    lines.push(`При чеке ${money(check.num.v)} это ${show(perYear, money, '≈ ')} в год с одного такого клиента.`)
    sources.push(check.source)
    approx = approx || perYear.approx
  }
  return { id: 'repeat_rate', title, lines, approx, missing: [], sources, how }
}
