import { describe, expect, it } from 'vitest'
import { approxAnswer, unknownAnswer } from '@/lib/survey/answer-value'
import { checkXSales, funnel, refusalsShare, repeatRate } from '@/lib/survey/calcs/sales'
import { previewAnswers } from '@/app/dev/survey-preview/fixture'

const filled = previewAnswers('filled')
const table = (rows: Array<Record<string, unknown>>) => ({ s8n_metrics_table: rows })

describe('check_x_sales', () => {
  it('fixture: the figures disagree → a question, pairs per year', () => {
    const r = checkXSales(filled)!
    expect(r.lines[0]).toBe('факт 2026: чек × продажи = 8,3 млн ₸, а сумма продаж — 58 млн ₸ (расхождение 86 %). Так и есть (например, абонементы или повторные оплаты) или где-то опечатка?')
    expect(r.lines[1]).toBe('Расхождение больше 5 % и за 2023, 2024, 2025.')
    expect(r.chart?.kind).toBe('pairs')
    expect(r.chart && r.chart.kind === 'pairs' && r.chart.series.length).toBe(4)
    expect(r.approx).toBe(false)
  })

  it('agreeing figures → «Сходится»', () => {
    const r = checkXSales(table([
      { metric_name: 'Средний чек', y2025: 100_000 },
      { metric_name: 'Количество продаж', y2025: 100 },
      { metric_name: 'Сумма продаж', y2025: 10_200_000 },
    ]))!
    expect(r.lines).toEqual(['Сходится: средний чек × количество продаж ≈ сумме продаж (2025).'])
  })

  it('a row missing or zero (= not filled) → hidden; no table → null', () => {
    expect(checkXSales({})).toBeNull()
    const r = checkXSales(table([{ metric_name: 'Средний чек', y2025: 100_000 }, { metric_name: 'Сумма продаж', y2025: 0 }]))!
    expect(r.lines).toEqual([])
    expect(r.missing).toEqual(['количество продаж (таблица метрик)', 'сумма продаж (таблица метрик)'])
    const split = checkXSales(table([
      { metric_name: 'Средний чек', y2024: 1 }, { metric_name: 'Количество продаж', y2025: 1 }, { metric_name: 'Сумма продаж', y2025: 1 },
    ]))!
    expect(split.missing).toEqual(['средний чек, количество и сумма продаж за один и тот же год'])
  })

  it('a negative cell is ignored', () => {
    const r = checkXSales(table([{ metric_name: 'Средний чек', y2025: -5 }, { metric_name: 'Количество продаж', y2025: 10 }, { metric_name: 'Сумма продаж', y2025: 50 }]))!
    expect(r.lines).toEqual([])
  })
})

describe('funnel', () => {
  it('fixture: sales from leads, stages vs overall, the weakest stage, a falling chart', () => {
    const r = funnel(filled)!
    expect(r.lines).toEqual([
      'Из 60 заявок ≈ 5 продаж в месяц.',
      'По этапам выходит 6,4 %, а общая конверсия — 9 %: проверьте этапы или общую цифру.',
      'Меньше всего проходит этап «Звонок → Встреча» — 40 %.',
    ])
    expect(r.chart?.kind).toBe('bars')
    const s = r.chart && r.chart.kind === 'bars' ? r.chart.series : []
    expect(s[0]).toEqual({ label: 'Заявки', value: 100 })
    expect(s.at(-1)).toEqual({ label: 'Поставка', value: 6.4 })
  })

  it('«примерно» overall conversion → range', () => {
    const r = funnel({ s7_leads_per_month: 60, s5n_funnel_lead_to_sale: approxAnswer(8, 12) })!
    expect(r.approx).toBe(true)
    expect(r.lines[0]).toBe('Из 60 заявок ≈ 6 (диапазон 5 – 7) продаж в месяц.')
  })

  it('«не знаю» everywhere → hidden with what to fill in', () => {
    const r = funnel({ s5n_funnel_lead_to_sale: unknownAnswer(), s7_leads_per_month: 60 })!
    expect(r.lines).toEqual([])
    expect(r.missing).toContain('конверсия «лид → продажа»')
  })

  it('out-of-range percent is not used; zero stage → zero; nothing → null', () => {
    expect(funnel({})).toBeNull()
    const bad = funnel({ s5n_funnel_lead_to_sale: 140, s7_leads_per_month: 60 })!
    expect(bad.lines).toEqual([])
    const zero = funnel({ s5n_funnel_lead_to_call: 0, s5n_funnel_call_to_meeting: 50 })!
    expect(zero.lines[0]).toBe('По этапам из 100 заявок до последнего заполненного этапа доходит ≈ 0.')
  })
})

describe('refusals_share', () => {
  it('fixture: share by year, newest first', () => {
    const r = refusalsShare(filled)!
    expect(r.lines).toEqual(['Отказов 63 % в 2025, было 65 % в 2024, 66 % в 2023.'])
    expect(r.chart && r.chart.kind === 'bars' && r.chart.series.map((x) => x.label)).toEqual(['2023', '2024', '2025'])
  })

  it('«примерно» → range; «не знаю» year is skipped and asked', () => {
    const r = refusalsShare({ s3_deals_2024: approxAnswer(60, 80), s3_rejections_2024: 70, s3_deals_2025: unknownAnswer(), s3_rejections_2025: 10 })!
    expect(r.lines[0]).toBe('Отказов ≈ 50 % (диапазон 47 % – 54 %) в 2024.')
    expect(r.missing).toEqual(['сделки 2025'])
  })

  it('zero deals and zero refusals → no share; nothing → null', () => {
    expect(refusalsShare({})).toBeNull()
    const r = refusalsShare({ s3_deals_2025: 0, s3_rejections_2025: 0 })!
    expect(r.lines).toEqual([])
    expect(refusalsShare({ s3_deals_2025: -1, s3_rejections_2025: 5 })!.lines).toEqual([])
  })
})

describe('repeat_rate', () => {
  it('fixture: times a year and money per client', () => {
    expect(repeatRate(filled)!.lines).toEqual([
      'Постоянный клиент покупает ≈ 12 раз в год (раз в 30 дн.).',
      'При чеке 118 тыс. ₸ это ≈ 1,4 млн ₸ в год с одного такого клиента.',
    ])
  })

  it('«примерно» days → range', () => {
    const r = repeatRate({ s7_repeat_freq_days: approxAnswer(60, 120) })!
    expect(r.lines[0]).toBe('Постоянный клиент покупает ≈ 4,1 (диапазон 3 – 6,1) раз в год (раз в 90 дн.).')
  })

  it('«не знаю», zero, negative → hidden; nothing → null', () => {
    expect(repeatRate({})).toBeNull()
    for (const v of [unknownAnswer(), 0, -10]) {
      const r = repeatRate({ s7_repeat_freq_days: v })!
      expect(r.lines).toEqual([])
      expect(r.missing).toEqual(['частота повторной покупки'])
    }
  })
})
