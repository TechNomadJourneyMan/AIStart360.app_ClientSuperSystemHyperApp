import { describe, it, expect } from 'vitest'
import * as React from 'react'
import MetricProvenanceTooltip, {
  type ProvenanceSource,
} from '@/components/dashboard/MetricProvenanceTooltip'
import { walk, allText, flatten } from './_walk'

const TRIGGER = React.createElement('button', { 'data-test': 'trigger' }, 'Открыть')

function render(props: Parameters<typeof MetricProvenanceTooltip>[0]) {
  return walk(MetricProvenanceTooltip(props))
}

describe('MetricProvenanceTooltip', () => {
  const sources: ProvenanceSource[] = [
    { type: 'survey', label: 'Анкета шаг 2: Выручка 2024', confidence: 0.95, picked: true },
    { type: 'document', label: 'Финотчёт.pdf', confidence: 0.7, picked: false },
  ]

  it('renders the trigger child element', () => {
    const tree = render({ sources, children: TRIGGER })
    // The trigger is asChild → Radix forwards props onto our <button>.
    // Walking should still encounter a node whose type === 'button'.
    const all = flatten(tree)
    const buttonNode = all.find((n) => n.type === 'button')
    expect(buttonNode).toBeTruthy()
  })

  it('renders the title "Источник данных" and every source label', () => {
    const tree = render({ sources, children: TRIGGER })
    const text = allText(tree)
    expect(text).toContain('Источник данных')
    expect(text).toContain('Анкета шаг 2: Выручка 2024')
    expect(text).toContain('Финотчёт.pdf')
  })

  it('shows confidence percentages and a check icon for picked source', () => {
    const tree = render({ sources, children: TRIGGER })
    const text = allText(tree)
    expect(text).toContain('95%')
    expect(text).toContain('70%')
    expect(text).toContain('check')
  })

  it('renders the relative-time footer when computedAt is provided', () => {
    const now = new Date('2026-05-19T12:00:00Z')
    const fiveMinAgo = new Date('2026-05-19T11:55:00Z').toISOString()
    const tree = render({
      sources,
      children: TRIGGER,
      computedAt: fiveMinAgo,
      now,
    })
    const text = allText(tree)
    expect(text).toContain('Обновлено')
    expect(text).toContain('5 мин назад')
  })

  it('omits footer when computedAt is missing', () => {
    const tree = render({ sources, children: TRIGGER })
    expect(allText(tree)).not.toContain('Обновлено')
  })
})
