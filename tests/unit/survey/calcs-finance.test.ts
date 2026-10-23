import { describe, expect, it } from 'vitest'
import { approxAnswer, unknownAnswer } from '@/lib/survey/answer-value'
import { expenseStructure, marginCheck, marketingMoney, receivables } from '@/lib/survey/calcs/finance'
import { ownerHours, staffCount } from '@/lib/survey/calcs/team'
import { previewAnswers } from '@/app/dev/survey-preview/fixture'

const filled = previewAnswers('filled')

describe('margin_check', () => {
  it('fixture: computed margin agrees with the stated one', () => {
    expect(marginCheck(filled)!.lines).toEqual(['По вашим цифрам маржа ≈ 15 % — сходится с указанной (15 %).'])
  })

  it('a different stated margin → a question; no stated margin → plain words; loss', () => {
    expect(marginCheck({ s9n_revenue_2024: 52_000_000, s9n_net_profit: 7_800_000, s9n_net_margin: 20 })!.lines[0])
      .toBe('По вашим цифрам маржа ≈ 15 %; вы указали 20 %. Где-то опечатка или маржа считается по-другому (например, до налогов)?')
    expect(marginCheck({ s9n_revenue_2024: 50_000_000, s9n_net_profit: 5_000_000 })!.lines[0])
      .toBe('По вашим цифрам маржа ≈ 10 %: с каждых 100 ₸ выручки остаётся ≈ 10 ₸ прибыли.')
    expect(marginCheck({ s9n_revenue_2024: 50_000_000, s9n_net_profit: -2_500_000 })!.lines[0]).toBe('Убыток: ≈ −5 % от выручки.')
    expect(marginCheck({ s9n_revenue_2024: 50_000_000, s9n_net_margin: 10 })!.lines[0]).toBe('При марже 10 % прибыль за год ≈ 5 млн ₸.')
  })

  it('«примерно» revenue → range', () => {
    const r = marginCheck({ s9n_revenue_2024: approxAnswer(50_000_000, 55_000_000), s9n_net_profit: 7_800_000 })!
    expect(r.approx).toBe(true)
    expect(r.lines[0]).toContain('≈ 15 % (диапазон 14 % – 16 %)')
  })

  it('«не знаю» / zero revenue → hidden; nothing → null', () => {
    expect(marginCheck({})).toBeNull()
    const u = marginCheck(previewAnswers('unknown'))
    expect(u!.lines).toEqual([])
    expect(u!.missing).toEqual(['чистая прибыль', 'чистая маржа'])
    expect(marginCheck({ s9n_revenue_2024: 0, s9n_net_profit: 5 })!.missing).toEqual(['годовая выручка (2024)'])
  })
})

describe('expense_structure', () => {
  it('fixture: share of revenue, biggest line, revenue − expenses vs profit, «прочие» missing', () => {
    const r = expenseStructure(filled)!
    expect(r.lines).toEqual([
      'Расходы (по указанным статьям) ≈ 64 % выручки, больше всего — себестоимость: 93 % всех расходов.',
      'Выручка − расходы = 18,6 млн ₸, а чистая прибыль — 7,8 млн ₸. Разница — налоги, зарплаты или расходы, которых нет в списке?',
    ])
    expect(r.missing).toEqual(['прочие расходы'])
    expect(r.chart?.kind).toBe('share')
  })

  it('«примерно» line → range; expenses above revenue → a question', () => {
    const r = expenseStructure({ s9n_revenue_2024: 10_000_000, s9n_expense_rent: approxAnswer(1_000_000, 3_000_000), s9n_expense_cogs: 5_000_000 })!
    expect(r.approx).toBe(true)
    expect(r.lines[0]).toMatch(/≈ 70 % \(диапазон 60 % – 80 %\) выручки/)
    expect(expenseStructure({ s9n_revenue_2024: 1_000_000, s9n_expense_cogs: 2_000_000 })!.lines[1]).toMatch(/больше выручки/)
  })

  it('«не знаю» everywhere / negatives → hidden; no revenue → total in ₸ and asks for revenue', () => {
    expect(expenseStructure({})).toBeNull()
    expect(expenseStructure({ s9n_expense_cogs: unknownAnswer() })!.lines).toEqual([])
    expect(expenseStructure({ s9n_expense_cogs: -5 })!.lines).toEqual([])
    const r = expenseStructure({ s9n_expense_cogs: 3_000_000, s9n_expense_rent: 1_000_000 })!
    expect(r.lines[0]).toBe('Расходы за год (по указанным статьям) ≈ 4 млн ₸, больше всего — себестоимость: 75 %.')
    expect(r.missing).toContain('годовая выручка (2024)')
  })
})

describe('receivables', () => {
  it('fixture: money waiting for payment', () => {
    expect(receivables(filled)!.lines).toEqual(['≈ 3,6 млн ₸ постоянно ждут оплаты у клиентов (выручка за 20 дн.).'])
  })

  it('«примерно» revenue → range; zero days', () => {
    const r = receivables({ s9n_debtor_days: 30, s1_current_revenue_month: approxAnswer(1_000_000, 2_000_000) })!
    expect(r.lines[0]).toMatch(/^≈ 1,5 млн ₸ \(диапазон 986 тыс\. ₸ – 2 млн ₸\)/)
    expect(receivables({ s9n_debtor_days: 0, s1_current_revenue_month: 1 })!.lines[0]).toMatch(/платят сразу/)
  })

  it('«не знаю» / negative / no revenue → hidden; nothing → null', () => {
    expect(receivables({})).toBeNull()
    expect(receivables(previewAnswers('unknown'))!.lines).toEqual([])
    expect(receivables({ s9n_debtor_days: -3, s1_current_revenue_month: 1 })!.lines).toEqual([])
    expect(receivables({ s9n_debtor_days: 30 })!.missing).toEqual(['выручка в месяц'])
  })
})

describe('marketing_money', () => {
  it('fixture: % in ₸, agrees with the expense line', () => {
    expect(marketingMoney(filled)!.lines).toEqual(['3 % от выручки = ≈ 2 млн ₸ в год (≈ 165 тыс. ₸ в месяц); сходится с расходами на маркетинг (1,8 млн ₸).'])
  })

  it('a different expense → a question; only the expense → share of revenue', () => {
    expect(marketingMoney({ ...filled, s9n_expense_marketing: 600_000 })!.lines[0]).toMatch(/в расходах указано 600 тыс\. ₸ — какая цифра ближе к правде\?$/)
    expect(marketingMoney({ s9n_revenue_2024: 50_000_000, s9n_expense_marketing: 1_000_000 })!.lines[0]).toBe('Маркетинг 1 млн ₸ в год — ≈ 2 % выручки.')
  })

  it('«примерно» revenue → range', () => {
    const r = marketingMoney({ s5_marketing_budget_pct: 10, s1_current_revenue_month: approxAnswer(1_000_000, 2_000_000) })!
    expect(r.approx).toBe(true)
    expect(r.lines[0]).toContain('≈ 1,8 млн ₸ (диапазон 1,2 млн ₸ – 2,4 млн ₸) в год')
  })

  it('«не знаю» / over 100 % → hidden; nothing → null', () => {
    expect(marketingMoney({})).toBeNull()
    expect(marketingMoney({ s5_marketing_budget_pct: unknownAnswer(), s1_current_revenue_month: 1 })!.lines).toEqual([])
    expect(marketingMoney({ s5_marketing_budget_pct: 140, s1_current_revenue_month: 1 })!.missing).toEqual(['бюджет на маркетинг, % от выручки'])
  })
})

describe('owner_hours', () => {
  it('fixture: hours a month', () => {
    expect(ownerHours(filled)!.lines).toEqual(['≈ 198 ч в месяц на операционку (9 ч × 22 рабочих дня).'])
  })

  it('two different answers → a question; the field it sits under wins', () => {
    const a = { s4m_hours_on_ops: 9, s10_hours_on_ops: 6 }
    expect(ownerHours(a, { key: 's4m_hours_on_ops' })!.lines).toEqual([
      '≈ 198 ч в месяц на операционку (9 ч × 22 рабочих дня).',
      'На шаге 4 вы указали 9 ч в день, на шаге 10 — 6 ч. Какая цифра точнее?',
    ])
    expect(ownerHours(a, { key: 's10_hours_on_ops' })!.lines[0]).toMatch(/^≈ 132 ч/)
  })

  it('«примерно» → range; «не знаю», 0, >24 → hidden; nothing → null', () => {
    expect(ownerHours({ s10_hours_on_ops: approxAnswer(4, 6) })!.lines[0]).toBe('≈ 110 (диапазон 88 – 132) ч в месяц на операционку (5 ч × 22 рабочих дня).')
    expect(ownerHours({})).toBeNull()
    for (const v of [unknownAnswer(), 0, 30, -2]) expect(ownerHours({ s10_hours_on_ops: v })!.lines).toEqual([])
  })
})

describe('staff_count', () => {
  it('fixture: table vs the employee answer → a question', () => {
    expect(staffCount(filled)!.lines).toEqual(['В штатном расписании 11 чел. в 2 отделах, а сотрудников вы указали 18. Остальные 7 — вне отделов (собственник, помощники) или таблица заполнена не полностью?'])
  })

  it('agrees / more in the table / no employee answer', () => {
    const t = [{ department: 'А', manager_count: 3 }, { department: 'Б', manager_count: '2' }]
    expect(staffCount({ s4n_staffing_table: t, s1_employee_count: 5 })!.lines[0]).toBe('Сходится: в штатном расписании 5 чел. в 2 отделах, сотрудников — 5.')
    expect(staffCount({ s4n_staffing_table: t, s1_employee_count: 4 })!.lines[0]).toMatch(/больше, чем сотрудников \(4\)/)
    const r = staffCount({ s4n_staffing_table: t })!
    expect(r.lines[0]).toBe('В штатном расписании 5 чел. в 2 отделах.')
    expect(r.missing).toEqual(['количество сотрудников'])
  })

  it('empty / zero / negative counts → hidden; no table → null', () => {
    expect(staffCount({})).toBeNull()
    expect(staffCount({ s4n_staffing_table: [{ department: 'А', manager_count: 0 }, { department: 'Б', manager_count: -2 }] })!.lines).toEqual([])
    expect(staffCount({ s4n_staffing_table: [] })).toBeNull()
  })
})
