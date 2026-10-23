/**
 * FieldCalc (survey Ф3): the block under a field. renderToStaticMarkup only —
 * no DOM, no network. The chart is lazy (next/dynamic, ssr:false), so on the
 * server only its placeholder and the hidden table render.
 */
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { FieldCalc } from '@/components/survey/FieldCalc'
import { approxAnswer, unknownAnswer } from '@/lib/survey/answer-value'
import { previewAnswers } from '@/app/dev/survey-preview/fixture'

const render = (props: Record<string, unknown>) => renderToStaticMarkup(createElement(FieldCalc, props as never))
const filled = previewAnswers('filled')

describe('FieldCalc', () => {
  it('a ready calc: caption, headline, sources, «Как посчитано», hidden chart table', () => {
    const html = render({ forKey: 's1_goal_12m_revenue_month', answers: filled })
    expect(html).toContain('Приблизительный расчёт по вашим цифрам')
    expect(html).toContain('Темп к цели')
    expect(html).toContain('Цель через год — ×1,6 к сегодняшней выручке')
    expect(html).toContain('из: выручка в месяц (шаг 1)')
    expect(html).toContain('<summary')
    expect(html).toContain('Как посчитано')
    expect(html).toContain('class="sr-only"')
    expect(html).toContain('<caption>Темп к цели: цифры графика</caption>')
    expect(html).toContain('<th scope="row">Через год</th><td>9 млн ₸</td>')
    expect(html).toMatch(/aria-labelledby="[^"]+"/)
    expect(html).not.toContain('recharts')
  })

  it('«не знаю» → hidden with «укажите …»', () => {
    const html = render({ forKey: 's1_goal_12m_revenue_month', answers: { s1_current_revenue_month: unknownAnswer(), s1_goal_12m_revenue_month: 9_000_000 } })
    expect(html).toContain('data-calc-state="hidden"')
    expect(html).toContain('Чтобы увидеть расчёт «Темп к цели», укажите: выручка в месяц.')
    expect(html).not.toContain('Как посчитано')
  })

  it('«примерно» → ≈ and a range', () => {
    const html = render({ forKey: 's1_goal_12m_revenue_month', answers: { s1_current_revenue_month: approxAnswer(5_000_000, 6_000_000), s1_goal_12m_revenue_month: 9_000_000 } })
    expect(html).toMatch(/≈ ×1,6 \(диапазон ×1,5 – ×1,8\)/)
  })

  it('nothing to say → renders nothing', () => {
    expect(render({ forKey: 's1_goal_12m_revenue_month', answers: {} })).toBe('')
    expect(render({ forKey: 's1_company_name', answers: filled })).toBe('')
  })

  it('by ids; shares are a strip with a visible legend; partial inputs say what would make it exact', () => {
    const html = render({ ids: ['expense_structure'], answers: filled })
    expect(html).toContain('себестоимость — 93,4 %')
    expect(html).toContain('Точнее, когда будет: прочие расходы.')
  })

  it('pairs carry their legend', () => {
    const html = render({ ids: ['check_x_sales'], answers: filled })
    expect(html).toContain('Чек × продажи')
    expect(html).toContain('<th scope="col">Сумма продаж</th>')
  })
})

describe('FieldCalc: the chart stays out of the first bundle', () => {
  it('FieldCalc imports no recharts and loads the chart with next/dynamic ssr:false', () => {
    const src = readFileSync(resolve(__dirname, '../../../components/survey/FieldCalc.tsx'), 'utf8')
    expect(src).not.toMatch(/from ['"]recharts['"]/)
    expect(src).toMatch(/dynamic\(\(\) => import\('\.\/FieldCalcChart'\)/)
    expect(src).toMatch(/ssr:\s*false/)
    const chart = readFileSync(resolve(__dirname, '../../../components/survey/FieldCalcChart.tsx'), 'utf8')
    expect(chart).toMatch(/from 'recharts'/)
    expect(chart).toContain('isAnimationActive={false}')
    expect(chart).toContain('aria-hidden="true"')
  })
})
