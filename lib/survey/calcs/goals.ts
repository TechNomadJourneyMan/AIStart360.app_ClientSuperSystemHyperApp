/**
 * lib/survey/calcs/goals.ts — revenue and goal calculations under the fields
 * (spec 2026-10-23 §9.2): goal_pace, revenue_years, revenue_per_employee,
 * leads_to_goal. Only the owner's own numbers; nothing is written.
 */
import { computeGap } from '@/lib/point-b/engine'
import { metricsTableCell, readMetricsTable } from '@/lib/survey/metrics-table'
import {
  combine, currentMonth, exact, goalMonth, hasAnyInput, inputLabel, isNum, needs, readAmount, readPercent,
  show, sourceOf, tableSource, uniq, yearRevenue, type Answers, type Num,
} from './inputs'
import { count, money, pct, signedPct, times } from './fmt'
import type { CalcChart, CalcResult } from './types'

const GOAL_KEYS = [
  's1_current_revenue_month', 's1_current_revenue_year',
  's1_goal_12m_revenue_month', 's1_goal_12m_revenue_year',
  's1_goal_3y_revenue_month', 's1_goal_3y_revenue_year',
] as const

const anyApprox = (xs: ReadonlyArray<Num | null | undefined>): boolean => xs.some((x) => !!x && x.approx)

// ─── goal_pace ──────────────────────────────────────────────────────────────

export function goalPace(answers: Answers): CalcResult | null {
  if (!hasAnyInput(answers, GOAL_KEYS)) return null
  const title = 'Темп к цели'
  const how = 'Во сколько раз цель больше сегодняшней выручки в месяц; рост в месяц — (цель ÷ сейчас) в степени 1/12 для цели через год и 1/36 для цели через 3 года, минус 1. Сезонность и разовые сделки не учитываются.'
  const cur = currentMonth(answers)
  const g12 = goalMonth(answers, '12m')
  const g3 = goalMonth(answers, '3y')
  const sources = [cur, g12, g3].filter((p) => p.num).map((p) => sourceOf(p.key))
  const missing: string[] = []
  if (!cur.num) missing.push(inputLabel(cur.key))
  if (!g12.num && !g3.num) missing.push(inputLabel(g12.key), inputLabel(g3.key))
  if (missing.length > 0 || !cur.num) return needs('goal_pace', title, missing, sources, how)
  const c = cur.num

  const lines: string[] = []
  const horizon = (goal: Num, months: number, word: string) => {
    const mult = combine([c, goal], ([a, b]) => computeGap(a * 12, b * 12, months).multiplier)
    const mom = combine([c, goal], ([a, b]) => computeGap(a * 12, b * 12, months).required_mom_growth)
    const cagr = combine([c, goal], ([a, b]) => computeGap(a * 12, b * 12, months).required_cagr)
    if (!mult || !mom || !cagr) return
    if (mult.v < 1) {
      lines.push(`Цель ${word} ниже сегодняшней выручки: ${show(combine([mult], ([m]) => (m - 1) * 100)!, signedPct)}. Так и задумано или где-то опечатка?`)
      return
    }
    if (months === 12) {
      lines.push(`Цель ${word} — ${show(mult, times)} к сегодняшней выручке: это ${show(mom, signedPct)} каждый месяц без остановки.`)
    } else {
      lines.push(`Цель ${word} — ${show(mult, times)}: это ${show(cagr, signedPct)} в год (${show(mom, signedPct)} в месяц).`)
    }
  }
  if (g12.num) horizon(g12.num, 12, 'через год')
  if (g3.num) horizon(g3.num, 36, 'через 3 года')
  if (!g12.num) lines.push('Укажите цель через год — посчитаем темп на ближайшие 12 месяцев.')

  const series: Extract<CalcChart, { kind: 'bars' }>['series'] = [{ label: 'Сейчас', value: Math.round(c.v) }]
  if (g12.num) series.push({ label: 'Через год', value: Math.round(g12.num.v), mark: true })
  if (g3.num) series.push({ label: 'Через 3 года', value: Math.round(g3.num.v), mark: true })

  return {
    id: 'goal_pace', title, lines,
    chart: { kind: 'bars', unit: '₸', series },
    approx: anyApprox([c, g12.num, g3.num]),
    missing: [], sources: uniq(sources), how,
  }
}

// ─── revenue_years ──────────────────────────────────────────────────────────

const YEAR_COLUMNS = [['y2023', 2023], ['y2024', 2024], ['y2025', 2025]] as const

export function revenueYears(answers: Answers): CalcResult | null {
  const table = readMetricsTable(answers.s8n_metrics_table)
  const rev2024 = readAmount(answers, 's9n_revenue_2024')
  const hasTable = !!table.sales_amount
  if (!hasTable && !hasAnyInput(answers, ['s9n_revenue_2024'])) return null
  const title = 'Выручка по годам'
  const how = 'Рост год к году = выручка года ÷ выручка прошлого года − 1. Нужный рост — цель через год (в месяц × 12) ÷ сегодняшняя выручка (в месяц × 12) − 1. Сравнение только с вашим прошлым.'

  const sources: string[] = []
  const points: Array<{ year: number; num: Num }> = []
  for (const [col, year] of YEAR_COLUMNS) {
    const cell = metricsTableCell(table, 'sales_amount', col)
    if (cell && cell.value > 0) {
      points.push({ year, num: exact(cell.value) })
      sources.push(tableSource('сумма продаж'))
    } else if (year === 2024 && isNum(rev2024) && rev2024.v > 0) {
      points.push({ year, num: rev2024 })
      sources.push(sourceOf('s9n_revenue_2024'))
    }
  }

  const lines: string[] = []
  // Own two figures for 2024 disagree → a question, not an error.
  const t2024 = metricsTableCell(table, 'sales_amount', 'y2024')
  if (t2024 && isNum(rev2024) && rev2024.v > 0 && Math.abs(t2024.value - rev2024.v) / Math.max(t2024.value, rev2024.v) > 0.05) {
    lines.push(`За 2024: в таблице метрик — ${money(t2024.value)}, в финансах — ${show(rev2024, money)}. Какая цифра точнее?`)
  }

  const growth: string[] = []
  for (let i = points.length - 1; i >= 1; i--) {
    const a = points[i - 1]
    const b = points[i]
    if (b.year - a.year !== 1) continue
    const g = combine([a.num, b.num], ([x, y]) => (x > 0 ? (y / x - 1) * 100 : null))
    if (g) growth.push(`${a.year} → ${b.year}: ${show(g, signedPct)}`)
  }

  const cur = currentMonth(answers)
  const g12 = goalMonth(answers, '12m')
  let need: string | null = null
  if (cur.num && g12.num) {
    const n = combine([cur.num, g12.num], ([c, g]) => computeGap(c * 12, g * 12, 12).gap_percent)
    if (n) {
      need = n.v >= 0
        ? `Для цели через год нужно ${show(n, signedPct)} к сегодняшней выручке за год.`
        : `Цель через год ниже сегодняшней выручки (${show(n, signedPct)}).`
      sources.push(sourceOf(cur.key), sourceOf(g12.key))
    }
  }

  if (growth.length === 0 && !need) {
    const missing = points.length === 0 ? ['сумма продаж по годам (таблица метрик)', inputLabel('s9n_revenue_2024')] : ['выручка ещё за один год (таблица метрик)']
    if (rev2024 === 'unknown') missing.push(inputLabel('s9n_revenue_2024'))
    return needs('revenue_years', title, missing, sources, how)
  }
  if (growth.length > 0) lines.unshift(growth.join('; ') + '.')
  if (need) lines.push(need)

  const series: Extract<CalcChart, { kind: 'bars' }>['series'] = points.map((p) => ({ label: String(p.year), value: Math.round(p.num.v) }))
  if (cur.num) series.push({ label: 'Сейчас ×12', value: Math.round(cur.num.v * 12) })
  if (g12.num) series.push({ label: 'Цель', value: Math.round(g12.num.v * 12), mark: true })

  return {
    id: 'revenue_years', title, lines,
    chart: series.length >= 2 ? { kind: 'bars', unit: '₸', series } : undefined,
    approx: anyApprox([...points.map((p) => p.num), need ? cur.num : null, need ? g12.num : null]),
    missing: [], sources: uniq(sources), how,
  }
}

// ─── revenue_per_employee ───────────────────────────────────────────────────

export function revenuePerEmployee(answers: Answers): CalcResult | null {
  if (!hasAnyInput(answers, ['s1_employee_count'])) return null
  const title = 'Выручка на сотрудника'
  const how = 'Выручка за год ÷ количество сотрудников. Для цели — цель через 3 года (в месяц × 12) ÷ тот же состав.'
  const people = readAmount(answers, 's1_employee_count')
  const rev = yearRevenue(answers)
  const missing: string[] = []
  if (!isNum(people) || people.v <= 0) missing.push(inputLabel('s1_employee_count'))
  if (!rev.num) missing.push(inputLabel('s1_current_revenue_month'))
  const sources = [sourceOf('s1_employee_count'), ...(rev.num ? [sourceOf(rev.key)] : [])]
  if (missing.length > 0 || !isNum(people) || !rev.num) return needs('revenue_per_employee', title, missing, sources, how)

  const per = combine([rev.num, people], ([r, p]) => (p > 0 ? r / p : null))
  if (!per) return needs('revenue_per_employee', title, [inputLabel('s1_employee_count')], sources, how)
  const lines = [`${show(per, money, '≈ ')} выручки на человека в год.`]
  const g3 = goalMonth(answers, '3y')
  let approx = per.approx
  if (g3.num) {
    const goalPer = combine([g3.num, people], ([g, p]) => (p > 0 ? (g * 12) / p : null))
    const mult = combine([g3.num, rev.num], ([g, r]) => (r > 0 ? (g * 12) / r : null))
    if (goalPer && mult) {
      lines.push(`Для цели через 3 года тем же составом — ${show(mult, times)} на человека (${show(goalPer, money, '≈ ')}).`)
      sources.push(sourceOf(g3.key))
      approx = approx || goalPer.approx || mult.approx
    }
  }
  return { id: 'revenue_per_employee', title, lines, approx, missing: [], sources: uniq(sources), how }
}

// ─── leads_to_goal ──────────────────────────────────────────────────────────

/** Average check: the step-8 table (newest fact), else the target check of step 7. */
function averageCheck(answers: Answers): { num: Num | null; source: string } {
  const cell = metricsTableCell(readMetricsTable(answers.s8n_metrics_table), 'avg_check', 'latest')
  if (cell && cell.value > 0) return { num: exact(cell.value), source: tableSource('средний чек') }
  const t = readAmount(answers, 's7_avg_check_target_kzt')
  if (isNum(t) && t.v > 0) return { num: t, source: sourceOf('s7_avg_check_target_kzt') }
  return { num: null, source: '' }
}

export function leadsToGoal(answers: Answers): CalcResult | null {
  if (!hasAnyInput(answers, ['s7_leads_per_month'])) return null
  const title = 'Заявки для цели'
  const how = 'Не хватает в месяц = цель через год − сегодняшняя выручка (в месяц). Продаж = не хватает ÷ средний чек. Заявок = продаж ÷ конверсия «лид → продажа». Упрощённо: без повторных покупок и роста чека.'
  const leads = readAmount(answers, 's7_leads_per_month')
  const cur = currentMonth(answers)
  const goal = goalMonth(answers, '12m')
  const check = averageCheck(answers)
  const conv = readPercent(answers, 's5n_funnel_lead_to_sale')
  const convOk = isNum(conv) && conv.v > 0 && conv.v <= 100

  const missing: string[] = []
  if (!goal.num) missing.push(inputLabel(goal.key))
  if (!cur.num) missing.push(inputLabel(cur.key))
  if (!check.num) missing.push('средний чек (таблица метрик, шаг 8)')
  if (!convOk) missing.push(inputLabel('s5n_funnel_lead_to_sale'))
  const sources = [
    ...(isNum(leads) ? [sourceOf('s7_leads_per_month')] : []),
    ...(goal.num ? [sourceOf(goal.key)] : []),
    ...(cur.num ? [sourceOf(cur.key)] : []),
    ...(check.num ? [check.source] : []),
    ...(convOk ? [sourceOf('s5n_funnel_lead_to_sale')] : []),
  ]
  if (missing.length > 0 || !goal.num || !cur.num || !check.num || !isNum(conv)) return needs('leads_to_goal', title, missing, sources, how)

  const gap = combine([goal.num, cur.num], ([g, c]) => g - c)!
  if (gap.v <= 0) {
    return {
      id: 'leads_to_goal', title, approx: gap.approx, missing: [], sources: uniq(sources), how,
      lines: ['Цель через год не выше сегодняшней выручки — дополнительные заявки для неё не нужны.'],
    }
  }
  const sales = combine([goal.num, cur.num, check.num], ([g, c, k]) => (k > 0 ? Math.max(0, g - c) / k : null))
  const more = combine([goal.num, cur.num, check.num, conv], ([g, c, k, p]) => (k > 0 && p > 0 ? Math.max(0, g - c) / k / (p / 100) : null))
  if (!sales || !more) return needs('leads_to_goal', title, [inputLabel('s5n_funnel_lead_to_sale')], sources, how)

  const now = isNum(leads) ? leads : null
  const lines = [
    `Чтобы добрать ${show(gap, money)} в месяц, нужно ещё ${show(sales, count, '≈ ')} продаж и ${show(more, count, '≈ ')} заявок в месяц${now ? ` — сейчас ${count(now.v)}` : ''}.`,
    `Упрощённо: чек ${money(check.num.v)}, конверсия ${pct(conv.v)}, без повторных покупок.`,
  ]
  return {
    id: 'leads_to_goal', title, lines,
    chart: now ? { kind: 'bars', unit: 'заявок', series: [{ label: 'Сейчас', value: Math.round(now.v) }, { label: 'Для цели', value: Math.round(now.v + more.v), mark: true }] } : undefined,
    approx: anyApprox([gap, sales, more, now]),
    missing: [], sources: uniq(sources), how,
  }
}

