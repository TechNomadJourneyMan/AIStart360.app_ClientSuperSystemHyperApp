import { describe, expect, it } from 'vitest'
import { approxAnswer, unknownAnswer } from '@/lib/survey/answer-value'
import {
  combine, currentMonth, exact, goalMonth, hasAnyInput, isAnswered, readAmount, readDays, readPercent,
  readShareText, readYearly, show, sourceOf, yearRevenue,
} from '@/lib/survey/calcs/inputs'
import { chartRows, formatChartValue } from '@/lib/survey/calcs/chart'

const fmt = (x: number) => String(Math.round(x))

describe('calcs: reading answers', () => {
  it('exact numbers, «примерно» ranges, «не знаю», empty', () => {
    expect(readAmount({ a: 5 }, 'a')).toEqual({ v: 5, lo: 5, hi: 5, approx: false })
    expect(readAmount({ a: { value: 7 } }, 'a')).toEqual(exact(7))
    expect(readAmount({ a: approxAnswer(5_000_000, 6_000_000) }, 'a')).toEqual({ v: 5_500_000, lo: 5_000_000, hi: 6_000_000, approx: true })
    expect(readAmount({ a: approxAnswer(4, 4) }, 'a')).toEqual({ v: 4, lo: 4, hi: 4, approx: false })
    expect(readAmount({ a: unknownAnswer() }, 'a')).toBe('unknown')
    expect(readAmount({}, 'a')).toBeNull()
    expect(readAmount({ a: '' }, 'a')).toBeNull()
    expect(readAmount({ a: 'не считал' }, 'a')).toBeNull()
  })

  it('legacy text answers', () => {
    expect(readAmount({ a: '5 млн' }, 'a')).toEqual(exact(5_000_000))
    expect(readAmount({ a: '5–6 млн' }, 'a')).toEqual({ v: 5_500_000, lo: 5_000_000, hi: 6_000_000, approx: true })
    expect(readAmount({ a: 'около 60 %' }, 'a')).toBeNull()
    expect(readShareText({ a: 'около 60 %' }, 'a')).toBe(60)
    expect(readShareText({ a: 1_000 }, 'a')).toBeNull()
    expect(readYearly({ a: '150 000 в месяц' }, 'a')).toEqual(exact(1_800_000))
    expect(readYearly({ a: '400 000' }, 'a')).toEqual(exact(400_000))
    expect(readPercent({ a: '3 %' }, 'a')).toEqual(exact(3))
    expect(readPercent({ a: 3 }, 'a')).toEqual(exact(3))
    expect(readDays({ a: '2 недели' }, 'a')).toEqual(exact(14))
    expect(readDays({ a: 30 }, 'a')).toEqual(exact(30))
  })

  it('isAnswered / hasAnyInput count «не знаю» as an answer', () => {
    expect(isAnswered(unknownAnswer())).toBe(true)
    expect(isAnswered('  ')).toBe(false)
    expect(isAnswered([])).toBe(false)
    expect(isAnswered(0)).toBe(true)
    expect(hasAnyInput({ b: unknownAnswer() }, ['a', 'b'])).toBe(true)
    expect(hasAnyInput({}, ['a', 'b'])).toBe(false)
  })
})

describe('calcs: combine and show', () => {
  it('an exact formula stays exact', () => {
    expect(combine([exact(10), exact(4)], ([a, b]) => a / b)).toEqual(exact(2.5))
  })

  it('a ranged input gives the min / max over the corners', () => {
    const r = combine([{ v: 15, lo: 10, hi: 20, approx: true }, exact(5)], ([a, b]) => a / b)
    expect(r).toEqual({ v: 3, lo: 2, hi: 4, approx: true })
    expect(show(r!, fmt)).toBe('≈ 3 (диапазон 2 – 4)')
    expect(show(exact(3), fmt, '≈ ')).toBe('≈ 3')
    expect(show(exact(3), fmt)).toBe('3')
  })

  it('a guard (division by zero) gives null', () => {
    expect(combine([exact(1), exact(0)], ([a, b]) => (b === 0 ? null : a / b))).toBeNull()
  })
})

describe('calcs: shared revenue', () => {
  it('current month, else the year ÷ 12; «не знаю» is reported', () => {
    expect(currentMonth({ s1_current_revenue_month: 5_500_000 }).num?.v).toBe(5_500_000)
    expect(currentMonth({ s1_current_revenue_year: 12_000_000 }).num?.v).toBe(1_000_000)
    const u = currentMonth({ s1_current_revenue_month: unknownAnswer(), s1_current_revenue_year: 66_000_000 })
    expect(u.num).toBeNull()
    expect(u.unknown).toBe(true)
    expect(currentMonth({ s1_current_revenue_month: -5 }).num).toBeNull()
  })

  it('goal per month, else the year ÷ 12', () => {
    expect(goalMonth({ s1_goal_3y_revenue_year: 300_000_000 }, '3y').num?.v).toBe(25_000_000)
    expect(goalMonth({ s1_goal_12m_revenue_month: 0 }, '12m').num).toBeNull()
  })

  it('year revenue: today × 12, else the step-9 revenue', () => {
    expect(yearRevenue({ s1_current_revenue_month: 1_000_000 }).num?.v).toBe(12_000_000)
    expect(yearRevenue({ s9n_revenue_2024: 52_000_000 }).num?.v).toBe(52_000_000)
    expect(yearRevenue({}).num).toBeNull()
  })

  it('sources carry the step', () => {
    expect(sourceOf('s1_current_revenue_month')).toBe('выручка в месяц (шаг 1)')
    expect(sourceOf('s9n_revenue_2024')).toBe('годовая выручка (2024) (шаг 9)')
  })
})

describe('calcs: chart text alternative', () => {
  it('formats by unit and lists the rows', () => {
    expect(formatChartValue(4_200_000, '₸')).toBe('4,2 млн ₸')
    expect(formatChartValue(12.5, '%')).toBe('13 %')
    expect(formatChartValue(4.2, '%')).toBe('4,2 %')
    expect(chartRows({ kind: 'bars', unit: 'шт.', series: [{ label: 'Сейчас', value: 60 }] })).toEqual({ head: ['', 'Значение'], rows: [['Сейчас', '60 шт.']] })
    expect(chartRows({ kind: 'pairs', unit: '₸', names: ['Чек × продажи', 'Сумма продаж'], series: [{ label: '2025', a: 1e6, b: 2e6 }] }).rows)
      .toEqual([['2025', '1 млн ₸', '2 млн ₸']])
  })
})
