import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { BoolToggle } from '@/components/onboarding/shared/BoolToggle'
import { MultiSelect } from '@/components/onboarding/shared/MultiSelect'
import { DynamicTable } from '@/components/onboarding/shared/DynamicTable'
import Step1 from '@/components/onboarding/steps/Step1CompanyForm'
import Step2 from '@/components/onboarding/steps/Step2GoalsForm'
import Step7 from '@/components/onboarding/steps/Step7MarketingForm'
import Step8 from '@/components/onboarding/steps/Step8MetricsForm'
import Step12 from '@/components/onboarding/steps/Step12ToolsForm'

const form = (C: unknown, data: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(C as never, { data, onChange: () => {} }))

describe('toggles are switches', () => {
  it('BoolToggle: role=switch, aria-checked, named by its label', () => {
    const html = renderToStaticMarkup(createElement(BoolToggle, { label: 'Есть орг. структура', value: true, onChange: () => {} }))
    expect(html).toContain('role="switch"')
    expect(html).toContain('aria-checked="true"')
    const labelId = html.match(/<span id="([^"]+)"[^>]*>Есть орг. структура<\/span>/)?.[1]
    expect(labelId).toBeTruthy()
    expect(html).toContain(`aria-labelledby="${labelId}"`)
  })

  it('the inline toggles of steps 7 and 12 are switches too', () => {
    expect(form(Step7)).toContain('role="switch"')
    expect(form(Step12, { s12_it_support: true })).toContain('aria-checked="true"')
  })
})

describe('chips are pressed buttons in a labelled group', () => {
  it('MultiSelect', () => {
    const html = renderToStaticMarkup(createElement(MultiSelect, { label: 'Каналы', options: ['A', 'B'], selected: ['B'], onChange: () => {} }))
    expect(html).toContain('role="group"')
    expect(html).toMatch(/aria-pressed="false"[^>]*>A</)
    expect(html).toMatch(/aria-pressed="true"[^>]*>B</)
  })

  it('regions (step 1) and growth barriers (step 2)', () => {
    const s1 = form(Step1, { s1_regions: ['Алматы'] })
    expect(s1).toContain('aria-labelledby="s1_regions-label"')
    expect(s1).toMatch(/aria-pressed="true"[^>]*>Алматы</)
    expect(form(Step2)).toContain('aria-labelledby="s6_growth_blockers-label"')
  })
})

describe('table cells have names', () => {
  it('DynamicTable: column + row', () => {
    const html = renderToStaticMarkup(createElement(DynamicTable, {
      columns: [{ key: 'department', label: 'Отдел', type: 'text' }, { key: 'manager_count', label: 'Кол-во менеджеров', type: 'number' }],
      rows: [{ department: '', manager_count: null }],
      onChange: () => {},
    }))
    expect(html).toContain('aria-label="Отдел, строка 1"')
    expect(html).toContain('aria-label="Кол-во менеджеров, строка 1"')
    expect(html).toContain('aria-label="Удалить строку 1"')
  })

  it('step 8 metrics table: metric + column', () => {
    const html = form(Step8)
    expect(html).toContain('aria-label="Средний чек — 2025"')
    expect(html).toContain('aria-label="Название метрики, строка 1"')
  })
})
