/**
 * lib/survey/calcs/finance.ts — money calculations under the step-9 fields
 * (spec 2026-10-23 §9.2): margin_check, expense_structure, receivables,
 * marketing_money. The step-9 profit, margin and expenses describe the same
 * reporting year as `s9n_revenue_2024` (SURVEY_KEY_YEAR), so they are set
 * against that revenue, never against today's pace.
 */
import {
  combine, hasAnyInput, inputLabel, isNum, needs, readAmount, readDays, readPercent, readShareText, readYearly,
  show, sourceOf, uniq, yearRevenue, type Answers, type Num,
} from './inputs'
import { count, money, pct } from './fmt'
import type { CalcResult } from './types'

const REV_KEY = 's9n_revenue_2024'

/** Revenue of the step-9 reporting year. */
function reportingRevenue(answers: Answers): Num | null {
  const r = readAmount(answers, REV_KEY)
  return isNum(r) && r.v > 0 && r.lo > 0 ? r : null
}

// ─── margin_check ───────────────────────────────────────────────────────────

/** More than 2 percentage points apart → ask. */
const MARGIN_TOLERANCE = 2

export function marginCheck(answers: Answers): CalcResult | null {
  if (!hasAnyInput(answers, ['s9n_net_profit', 's9n_net_margin'])) return null
  const title = 'Маржа по вашим цифрам'
  const how = 'Маржа = чистая прибыль ÷ годовая выручка того же года × 100 %. Если прибыли нет — прибыль = выручка × указанная маржа.'
  const rev = reportingRevenue(answers)
  const profitR = readAmount(answers, 's9n_net_profit')
  const marginR = readPercent(answers, 's9n_net_margin')
  const profit = isNum(profitR) ? profitR : null
  const stated = isNum(marginR) && marginR.v >= -100 && marginR.v <= 100 ? marginR : null
  const sources = [
    ...(rev ? [sourceOf(REV_KEY)] : []),
    ...(profit ? [sourceOf('s9n_net_profit')] : []),
    ...(stated ? [sourceOf('s9n_net_margin')] : []),
  ]
  const missing: string[] = []
  if (!rev) missing.push(inputLabel(REV_KEY))
  if (!profit && !stated) missing.push(inputLabel('s9n_net_profit'), inputLabel('s9n_net_margin'))
  if (!rev || (!profit && !stated)) return needs('margin_check', title, missing, sources, how)

  const lines: string[] = []
  let approx = false
  if (profit) {
    const m = combine([profit, rev], ([p, r]) => (r > 0 ? (p / r) * 100 : null))!
    approx = m.approx
    if (stated) {
      approx = approx || stated.approx
      if (Math.abs(m.v - stated.v) > MARGIN_TOLERANCE) {
        lines.push(`По вашим цифрам маржа ${show(m, pct, '≈ ')}; вы указали ${show(stated, pct)}. Где-то опечатка или маржа считается по-другому (например, до налогов)?`)
      } else {
        lines.push(`По вашим цифрам маржа ${show(m, pct, '≈ ')} — сходится с указанной (${show(stated, pct)}).`)
      }
    } else if (m.v < 0) {
      lines.push(`Убыток: ${show(m, pct, '≈ ')} от выручки.`)
    } else {
      lines.push(`По вашим цифрам маржа ${show(m, pct, '≈ ')}: с каждых 100 ₸ выручки остаётся ${show(m, (x) => count(x), '≈ ')} ₸ прибыли.`)
    }
  } else if (stated) {
    const p = combine([rev, stated], ([r, s]) => (r * s) / 100)!
    approx = p.approx
    lines.push(`При марже ${show(stated, pct)} прибыль за год ${show(p, money, '≈ ')}.`)
  }
  return { id: 'margin_check', title, lines, approx, missing: [], sources: uniq(sources), how }
}

// ─── expense_structure ──────────────────────────────────────────────────────

const EXPENSES = [
  ['s9n_expense_cogs', 'себестоимость'],
  ['s9n_expense_marketing', 'маркетинг'],
  ['s9n_expense_rent', 'аренда'],
  ['s9n_expense_other', 'прочие'],
] as const

/** One expense line per year: a number (₸ per year), a legacy «… в месяц» (× 12) or «60 %» of revenue. */
function expenseOf(answers: Answers, key: string, rev: Num | null): Num | null {
  const y = readYearly(answers, key)
  if (isNum(y)) return y.v >= 0 && y.lo >= 0 ? y : null
  const share = readShareText(answers, key)
  if (share !== null && rev && share >= 0 && share <= 100) return combine([rev], ([r]) => (r * share) / 100)
  return null
}

/** Revenue − expenses differs from the stated profit by more than 10 % of revenue → ask. */
const REST_TOLERANCE = 0.1

export function expenseStructure(answers: Answers): CalcResult | null {
  if (!hasAnyInput(answers, EXPENSES.map((e) => e[0]))) return null
  const title = 'Структура расходов'
  const how = 'Доля статьи = статья ÷ сумма расходов; расходы к выручке = сумма ÷ годовая выручка того же года. «Выручка − расходы» сравнивается с чистой прибылью: разница — налоги, зарплаты и всё, чего нет в списке.'
  const rev = reportingRevenue(answers)
  const items: Array<{ label: string; key: string; num: Num }> = []
  const missing: string[] = []
  for (const [key, label] of EXPENSES) {
    const n = expenseOf(answers, key, rev)
    if (n) items.push({ key, label, num: n })
    else missing.push(inputLabel(key))
  }
  const sources = [...items.map((i) => sourceOf(i.key)), ...(rev ? [sourceOf(REV_KEY)] : [])]
  if (items.length === 0) return needs('expense_structure', title, missing, sources, how)

  const total = combine(items.map((i) => i.num), (xs) => xs.reduce((a, b) => a + b, 0))!
  if (total.v <= 0) return needs('expense_structure', title, missing.length ? missing : items.map((i) => inputLabel(i.key)), sources, how)
  const top = items.reduce((a, b) => (b.num.v > a.num.v ? b : a))
  const topShare = (top.num.v / total.v) * 100

  const lines: string[] = []
  let approx = total.approx
  const partial = missing.length > 0 ? ' (по указанным статьям)' : ''
  if (rev) {
    const toRev = combine([total, rev], ([t, r]) => (r > 0 ? (t / r) * 100 : null))!
    approx = approx || toRev.approx
    lines.push(`Расходы${partial} ${show(toRev, pct, '≈ ')} выручки, больше всего — ${top.label}: ${pct(topShare)} всех расходов.`)
    if (total.v > rev.v) {
      lines.push('Расходы больше выручки — так и было (убыток) или где-то опечатка?')
    } else {
      const profitR = readAmount(answers, 's9n_net_profit')
      if (isNum(profitR)) {
        const rest = combine([rev, total], ([r, t]) => r - t)!
        sources.push(sourceOf('s9n_net_profit'))
        if (Math.abs(rest.v - profitR.v) > REST_TOLERANCE * rev.v) {
          lines.push(`Выручка − расходы = ${show(rest, money)}, а чистая прибыль — ${show(profitR, money)}. Разница — налоги, зарплаты или расходы, которых нет в списке?`)
        } else {
          lines.push(`Выручка − расходы ${show(rest, money, '≈ ')} — близко к указанной прибыли.`)
        }
      }
    }
  } else {
    lines.push(`Расходы за год${partial} ${show(total, money, '≈ ')}, больше всего — ${top.label}: ${pct(topShare)}.`)
    missing.push(inputLabel(REV_KEY))
  }

  return {
    id: 'expense_structure', title, lines,
    chart: items.length >= 2 ? { kind: 'share', unit: '%', series: items.map((i) => ({ label: i.label, value: Math.round((i.num.v / total.v) * 1000) / 10 })) } : undefined,
    approx, missing: uniq(missing), sources: uniq(sources), how,
  }
}

// ─── receivables ────────────────────────────────────────────────────────────

export function receivables(answers: Answers): CalcResult | null {
  if (!hasAnyInput(answers, ['s9n_debtor_days'])) return null
  const title = 'Деньги у клиентов'
  const how = 'Выручка за год ÷ 365 × средний срок оплаты в днях — сколько денег в среднем ждут оплаты.'
  const days = readDays(answers, 's9n_debtor_days')
  const rev = yearRevenue(answers)
  const missing: string[] = []
  if (!isNum(days) || days.v < 0) missing.push(inputLabel('s9n_debtor_days'))
  if (!rev.num) missing.push(inputLabel('s1_current_revenue_month'))
  const sources = [...(isNum(days) ? [sourceOf('s9n_debtor_days')] : []), ...(rev.num ? [sourceOf(rev.key)] : [])]
  if (!isNum(days) || days.v < 0) return needs('receivables', title, missing, sources, how)
  if (days.v === 0) {
    return { id: 'receivables', title, lines: ['Клиенты платят сразу — денег в ожидании оплаты нет.'], approx: false, missing: [], sources, how }
  }
  if (!rev.num) return needs('receivables', title, missing, sources, how)
  const amount = combine([rev.num, days], ([r, d]) => (r / 365) * d)!
  return {
    id: 'receivables', title,
    lines: [`${show(amount, money, '≈ ')} постоянно ждут оплаты у клиентов (выручка за ${count(days.v)} дн.).`],
    approx: amount.approx, missing: [], sources: uniq(sources), how,
  }
}

// ─── marketing_money ────────────────────────────────────────────────────────

/** The budget in ₸ and the marketing expense line differ by more than 20 % → ask. */
const MARKETING_TOLERANCE = 0.2

export function marketingMoney(answers: Answers): CalcResult | null {
  if (!hasAnyInput(answers, ['s5_marketing_budget_pct', 's9n_expense_marketing'])) return null
  const title = 'Маркетинг в деньгах'
  const how = 'Бюджет в тенге = % от выручки × выручка за год. Сравнивается со статьёй «Маркетинг и реклама» шага 9.'
  const pr = readPercent(answers, 's5_marketing_budget_pct')
  const share = isNum(pr) && pr.v >= 0 && pr.v <= 100 ? pr : null
  const rev = yearRevenue(answers)
  const rev24 = reportingRevenue(answers)
  const expense = expenseOf(answers, 's9n_expense_marketing', rev24)
  const sources = [
    ...(share ? [sourceOf('s5_marketing_budget_pct')] : []),
    ...(rev.num ? [sourceOf(rev.key)] : []),
    ...(expense ? [sourceOf('s9n_expense_marketing')] : []),
  ]

  if (share && rev.num) {
    const budget = combine([share, rev.num], ([s, r]) => (s * r) / 100)!
    const monthly = combine([share, rev.num], ([s, r]) => (s * r) / 100 / 12)!
    let line = `${show(share, pct)} от выручки = ${show(budget, money, '≈ ')} в год (${show(monthly, money, '≈ ')} в месяц)`
    let approx = budget.approx
    if (expense) {
      approx = approx || expense.approx
      const off = Math.abs(budget.v - expense.v) / Math.max(budget.v, expense.v, 1)
      line += off > MARKETING_TOLERANCE
        ? `; в расходах указано ${show(expense, money)} — какая цифра ближе к правде?`
        : `; сходится с расходами на маркетинг (${show(expense, money)}).`
    } else {
      line += '.'
    }
    return { id: 'marketing_money', title, lines: [line], approx, missing: [], sources: uniq(sources), how }
  }
  const base = rev24 ?? rev.num
  if (expense && base) {
    const s = combine([expense, base], ([e, r]) => (r > 0 ? (e / r) * 100 : null))!
    return {
      id: 'marketing_money', title,
      lines: [`Маркетинг ${show(expense, money)} в год — ${show(s, pct, '≈ ')} выручки.`],
      approx: s.approx || expense.approx, missing: share ? [] : [inputLabel('s5_marketing_budget_pct')],
      sources: uniq([...sources, rev24 ? sourceOf(REV_KEY) : sourceOf(rev.key)]), how,
    }
  }
  const missing: string[] = []
  if (!share) missing.push(inputLabel('s5_marketing_budget_pct'))
  if (!rev.num) missing.push(inputLabel('s1_current_revenue_month'))
  return needs('marketing_money', title, missing, sources, how)
}
