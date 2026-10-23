import { describe, expect, it } from 'vitest'
import { approxAnswer, unknownAnswer } from '@/lib/survey/answer-value'
import { goalPace, leadsToGoal, revenuePerEmployee, revenueYears } from '@/lib/survey/calcs/goals'
import { previewAnswers } from '@/app/dev/survey-preview/fixture'

const filled = previewAnswers('filled')

describe('goal_pace', () => {
  it('fixture: ×1,6 a year = +4,2 % a month; 3 years in % a year; 3 bars', () => {
    const r = goalPace(filled)!
    expect(r.lines[0]).toBe('Цель через год — ×1,6 к сегодняшней выручке: это +4,2 % каждый месяц без остановки.')
    expect(r.lines[1]).toMatch(/^Цель через 3 года — ×4,5: это \+66 % в год \(\+4,3 % в месяц\)\.$/)
    expect(r.chart).toEqual({ kind: 'bars', unit: '₸', series: [
      { label: 'Сейчас', value: 5_500_000 },
      { label: 'Через год', value: 9_000_000, mark: true },
      { label: 'Через 3 года', value: 25_000_000, mark: true },
    ] })
    expect(r.approx).toBe(false)
    expect(r.sources).toContain('выручка в месяц (шаг 1)')
  })

  it('«примерно» → ≈ and a range', () => {
    const r = goalPace({ s1_current_revenue_month: approxAnswer(5_000_000, 6_000_000), s1_goal_12m_revenue_month: 9_000_000 })!
    expect(r.approx).toBe(true)
    expect(r.lines[0]).toContain('≈ ×1,6 (диапазон ×1,5 – ×1,8)')
    expect(r.lines[0]).toMatch(/≈ \+4,2 % \(диапазон \+3,4 % – \+5 %\)/)
  })

  it('«не знаю» current revenue → hidden, asks for it', () => {
    const r = goalPace({ s1_current_revenue_month: unknownAnswer(), s1_goal_12m_revenue_month: 9_000_000 })!
    expect(r.lines).toEqual([])
    expect(r.missing).toEqual(['выручка в месяц'])
  })

  it('no input → null; a goal without current → asks; current without goal → asks for goals', () => {
    expect(goalPace({})).toBeNull()
    expect(goalPace({ s1_goal_3y_revenue_month: 1 })!.missing).toEqual(['выручка в месяц'])
    expect(goalPace({ s1_current_revenue_month: 1_000_000 })!.missing).toHaveLength(2)
  })

  it('zero / negative / a goal below today', () => {
    expect(goalPace({ s1_current_revenue_month: 0, s1_goal_12m_revenue_month: 5 })!.lines).toEqual([])
    expect(goalPace({ s1_current_revenue_month: -1, s1_goal_12m_revenue_month: 5 })!.lines).toEqual([])
    const lower = goalPace({ s1_current_revenue_month: 1_000_000, s1_goal_12m_revenue_month: 800_000 })!
    expect(lower.lines[0]).toBe('Цель через год ниже сегодняшней выручки: −20 %. Так и задумано или где-то опечатка?')
  })
})

describe('revenue_years', () => {
  it('fixture: growth by year and the growth the goal needs', () => {
    const r = revenueYears(filled)!
    expect(r.lines[0]).toBe('2024 → 2025: +27 %; 2023 → 2024: +27 %.')
    expect(r.lines[1]).toBe('Для цели через год нужно +64 % к сегодняшней выручке за год.')
    expect(r.chart?.kind).toBe('bars')
    expect(r.chart && r.chart.kind === 'bars' && r.chart.series.map((s) => s.label)).toEqual(['2023', '2024', '2025', 'Сейчас ×12', 'Цель'])
  })

  it('the 2024 figure from step 9 fills the table gap; «примерно» → range', () => {
    const r = revenueYears({ s9n_revenue_2024: approxAnswer(50_000_000, 55_000_000), s8n_metrics_table: [{ metric_name: 'Сумма продаж', y2025: 66_000_000 }] })!
    expect(r.approx).toBe(true)
    expect(r.lines[0]).toMatch(/^2024 → 2025: ≈ \+26 % \(диапазон \+20 % – \+32 %\)\.$/)
  })

  it('two own figures for 2024 that disagree → a question', () => {
    const r = revenueYears({ s9n_revenue_2024: 40_000_000, s8n_metrics_table: [{ metric_name: 'Сумма продаж', y2024: 52_000_000, y2025: 60_000_000 }] })!
    expect(r.lines.some((l) => l.includes('Какая цифра точнее?'))).toBe(true)
  })

  it('«не знаю» / one year only → hidden; nothing → null', () => {
    expect(revenueYears({})).toBeNull()
    const u = revenueYears({ s9n_revenue_2024: unknownAnswer() })!
    expect(u.lines).toEqual([])
    expect(u.missing).toContain('годовая выручка (2024)')
    expect(revenueYears({ s9n_revenue_2024: 50_000_000 })!.lines).toEqual([])
  })

  it('zero in the table is «not filled»', () => {
    expect(revenueYears({ s8n_metrics_table: [{ metric_name: 'Сумма продаж', y2024: 0, y2025: 10 }] })!.lines).toEqual([])
  })
})

describe('revenue_per_employee', () => {
  it('fixture: per person and ×N for the 3-year goal', () => {
    const r = revenuePerEmployee(filled)!
    expect(r.lines).toEqual([
      '≈ 3,7 млн ₸ выручки на человека в год.',
      'Для цели через 3 года тем же составом — ×4,5 на человека (≈ 16,7 млн ₸).',
    ])
  })

  it('«примерно» revenue → range', () => {
    const r = revenuePerEmployee({ s1_employee_count: 10, s1_current_revenue_month: approxAnswer(1_000_000, 2_000_000) })!
    expect(r.lines[0]).toBe('≈ 1,8 млн ₸ (диапазон 1,2 млн ₸ – 2,4 млн ₸) выручки на человека в год.')
  })

  it('no revenue / zero people → hidden; no answer → null', () => {
    expect(revenuePerEmployee({})).toBeNull()
    expect(revenuePerEmployee({ s1_employee_count: 5 })!.missing).toEqual(['выручка в месяц'])
    expect(revenuePerEmployee({ s1_employee_count: 0, s1_current_revenue_month: 1 })!.lines).toEqual([])
    expect(revenuePerEmployee({ s1_employee_count: -3, s1_current_revenue_month: 1 })!.lines).toEqual([])
  })
})

describe('leads_to_goal', () => {
  it('fixture: sales and leads to close the gap; chart now / for the goal', () => {
    const r = leadsToGoal(filled)!
    expect(r.lines[0]).toBe('Чтобы добрать 3,5 млн ₸ в месяц, нужно ещё ≈ 30 продаж и ≈ 330 заявок в месяц — сейчас 60.')
    expect(r.lines[1]).toBe('Упрощённо: чек 118 тыс. ₸, конверсия 9 %, без повторных покупок.')
    expect(r.chart).toEqual({ kind: 'bars', unit: 'заявок', series: [{ label: 'Сейчас', value: 60 }, { label: 'Для цели', value: 390, mark: true }] })
  })

  it('«примерно» conversion → range', () => {
    const r = leadsToGoal({ ...filled, s5n_funnel_lead_to_sale: approxAnswer(8, 12) })!
    expect(r.approx).toBe(true)
    expect(r.lines[0]).toMatch(/≈ 297 \(диапазон 247 – 371\) заявок/)
  })

  it('«не знаю» conversion / zero conversion / >100 % → hidden', () => {
    for (const v of [unknownAnswer(), 0, 140]) {
      const r = leadsToGoal({ ...filled, s5n_funnel_lead_to_sale: v })!
      expect(r.lines).toEqual([])
      expect(r.missing).toEqual(['конверсия «лид → продажа»'])
    }
  })

  it('goal already reached; no leads answer → null', () => {
    expect(leadsToGoal({ ...filled, s1_goal_12m_revenue_month: 5_000_000 })!.lines[0]).toMatch(/не нужны/)
    expect(leadsToGoal({ ...filled, s7_leads_per_month: undefined })).toBeNull()
  })

  it('target check of step 7 when the table has no check', () => {
    const r = leadsToGoal({ ...filled, s8n_metrics_table: [] })!
    expect(r.lines[1]).toContain('чек 120 тыс. ₸')
  })
})
