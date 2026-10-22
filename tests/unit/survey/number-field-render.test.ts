import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { NumberField, PhoneField } from '@/components/onboarding/shared/NumberField'
import { DynamicTable } from '@/components/onboarding/shared/DynamicTable'
import { approxAnswer, unknownAnswer } from '@/lib/survey/answer-value'

const render = (props: Record<string, unknown>) =>
  renderToStaticMarkup(createElement(NumberField, { id: 's9n_net_profit', label: 'Чистая прибыль', value: null, onChange: () => {}, ...props } as never))

describe('NumberField', () => {
  it('is a text input with the digit keyboard, the unit and 16 px text', () => {
    const html = render({ value: 1_500_000, unit: '₸', integer: true })
    expect(html).toContain('type="text"')
    expect(html).toContain('inputMode="numeric"')
    expect(html).toContain('value="1 500 000"')
    expect(html).toContain('>₸</span>')
    expect(html).toContain('text-base')
    expect(html).toContain('for="s9n_net_profit"')
  })

  it('decimal fields ask for the decimal keyboard; an empty answer is an empty field', () => {
    const html = render({ value: null, unit: '%' })
    expect(html).toContain('inputMode="decimal"')
    expect(html).toContain('value=""')
  })

  it('«Не знаю» chip is a pressed toggle and disables the input', () => {
    const off = render({ value: 5 })
    expect(off).toContain('aria-pressed="false"')
    expect(off).toContain('Не знаю / не считаем')
    const on = render({ value: unknownAnswer() })
    expect(on).toContain('aria-pressed="true"')
    expect(on).toMatch(/<input[^>]*disabled=""/)
    expect(on).toContain('placeholder="Не знаю"')
  })

  it('no chips when the question is one people always know', () => {
    expect(render({ allowUnknown: false })).not.toContain('aria-pressed')
  })

  it('«Примерно» shows the range and the midpoint that goes into the calculations', () => {
    const html = render({ value: approxAnswer(5_000_000, 6_000_000), unit: '₸', allowApprox: true })
    expect(html).toContain('Примерно (диапазон)')
    expect(html).toContain('value="5 000 000 – 6 000 000"')
    expect(html).toContain('≈ 5 500 000 ₸ (5 000 000 – 6 000 000 ₸)')
  })

  it('a soft maximum warns without changing the value', () => {
    expect(render({ value: 140, unit: '%', max: 100 })).toContain('Проверьте: больше 100 %')
  })

  it('a legacy text answer is shown as typed', () => {
    expect(render({ value: 'около 60 %' })).toContain('value="около 60 %"')
  })
})

describe('PhoneField', () => {
  it('uses the phone keyboard', () => {
    const html = renderToStaticMarkup(createElement(PhoneField, { id: 's1_contact_phone', label: 'Телефон', value: '+7 700', onChange: () => {} }))
    expect(html).toContain('type="tel"')
    expect(html).toContain('autoComplete="tel"')
  })
})

describe('DynamicTable number cells', () => {
  it('an empty numeric cell renders empty (null), with the decimal keyboard', () => {
    const html = renderToStaticMarkup(createElement(DynamicTable, {
      columns: [{ key: 'channel', label: 'Канал', type: 'text' }, { key: 'budget_monthly', label: 'Бюджет/мес', type: 'number' }],
      rows: [{ channel: 'Instagram', budget_monthly: null }],
      onChange: () => {},
    }))
    expect(html).toContain('inputMode="decimal"')
    expect(html).not.toContain('value="0"')
  })
})
