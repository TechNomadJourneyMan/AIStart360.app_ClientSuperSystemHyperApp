import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PortfolioGriDetails, PortfolioGriDetailsContent } from '@/components/dashboard/PortfolioGriDetails'
import type { PortfolioGRI, PortfolioGriDomainKey } from '@/lib/portfolio-gri'

const domains: Array<{ key: PortfolioGriDomainKey; label: string }> = [
  { key: 'product', label: 'Продукт и спрос' }, { key: 'trust', label: 'Доверие и позиционирование' },
  { key: 'bizmodel', label: 'Бизнес-модель' }, { key: 'cash', label: 'Финансовая устойчивость' },
  { key: 'ops', label: 'Операции' }, { key: 'team', label: 'Команда' },
  { key: 'founder', label: 'Готовность собственника' },
]
const data: PortfolioGRI = {
  overall: 6.25, product: 4, trust: null, bizmodel: null, cash: null, ops: null, team: 8, founder: null,
  reportCount: 3,
  sampleCounts: { overall: 1, product: 3, trust: 0, bizmodel: 0, cash: 0, ops: 0, team: 2, founder: 0 },
}

function renderDetails(overrides: Partial<Parameters<typeof PortfolioGriDetailsContent>[0]> = {}) {
  return renderToStaticMarkup(createElement(PortfolioGriDetailsContent, { data, domains, locale: 'ru', ...overrides }))
}

function row(html: string, label: string) {
  const start = html.indexOf(`>${label}</th>`)
  expect(start).toBeGreaterThan(-1)
  return html.slice(start, html.indexOf('</tr>', start))
}

describe('portfolio GRI drilldown', () => {
  it('shows the real denominator of every mean, rather than using the portfolio total for all sections', () => {
    const html = renderDetails()
    expect(html).toContain('Оценок с данными: 3')
    expect(html).toContain('>1</strong>')
    expect(row(html, 'GRI портфеля')).toContain('>1</td>')
    expect(row(html, 'Продукт и спрос')).toContain('>3</td>')
    expect(row(html, 'Команда')).toContain('>2</td>')
    expect(html).toContain('Он не пересчитывается из семи средних баллов портфеля')
    expect(html).toContain('>6.3<')
  })

  it('opens a section explanation with that section’s score and sample, keeping missing sections empty', () => {
    const html = renderDetails({ selection: 'team' })
    expect(html).toContain('>8.0<')
    expect(html).toContain('>2</strong>')
    expect(html).toContain('Сумма средних баллов этого раздела')
    const missing = row(html, 'Финансовая устойчивость')
    expect(missing).toContain('нет данных')
    expect(missing).toContain('>0</td>')
    expect(missing).not.toContain('0.0')
  })

  it('does not invent denominators when an older saved aggregate has none', () => {
    const html = renderDetails({ data: { ...data, sampleCounts: undefined } })
    expect(html).toContain('>не сохранено</strong>')
    expect(html).toContain('Общим количеством оценок оно не заменяется')
    expect(row(html, 'Продукт и спрос')).toContain('не сохранено')
  })

  it('localizes the section labels, status and explanation in English', () => {
    const html = renderDetails({ locale: 'en', selection: 'team' })
    expect(html).toContain('Owner readiness')
    expect(html).toContain('Assessments used')
    expect(html).toContain('Sum of clients’ average scores')
    expect(html).toContain('Excellent')
    expect(html).toContain('no data')
    expect(html).not.toContain('Команда')
    expect(html).not.toContain('нет данных')
  })

  it('exposes a named keyboard button and keeps details hidden until requested', () => {
    const html = renderToStaticMarkup(createElement(PortfolioGriDetails, { data, domains, selection: 'team' }))
    expect(html).toContain('<button')
    expect(html).toContain('type="button"')
    expect(html).toContain('aria-label="Подробнее: Команда"')
    expect(html).toContain('aria-haspopup="dialog"')
    expect(html).not.toContain('<table')
  })
})
