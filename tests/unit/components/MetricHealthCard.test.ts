import { describe, it, expect, vi } from 'vitest'
import * as React from 'react'

// Stub the Skeleton import to avoid vite parsing the existing JSX-preserve .tsx
// file (project tsconfig sets jsx:preserve which vite cannot import-analyze).
vi.mock('@/components/ui/Skeleton', () => ({
  Skeleton: (props: { className?: string }) =>
    React.createElement('div', {
      ...props,
      'data-stub': 'skeleton',
      className: `skeleton ${props.className ?? ''}`.trim(),
    }),
  KpiBlockSkeleton: () => null,
  TableSkeleton: () => null,
}))

import MetricHealthCard from '@/components/dashboard/MetricHealthCard'
import { walk, allClassNames, allText } from './_walk'

function render(props: Parameters<typeof MetricHealthCard>[0]) {
  // Call the component as a plain function (no react-dom mount).
  return walk(MetricHealthCard(props))
}

describe('MetricHealthCard', () => {
  it('renders the Russian label and formatted value', () => {
    const tree = render({
      metricId: 'revenue_2024',
      label: 'Выручка 2024',
      value: 12_500_000,
      unit: '₸',
    })
    const text = allText(tree)
    expect(text).toContain('Выручка 2024')
    // 12.5 млн ₸
    expect(text).toMatch(/12\.5\s*млн\s*₸/)
  })

  it('invokes onClick when the card is clicked', () => {
    const onClick = vi.fn()
    const tree = render({
      metricId: 'm1',
      label: 'Метрика',
      value: 100,
      onClick,
    })
    // Locate the root motion.div by walking the tree; first node that has an onClick prop
    const root = tree
    expect(root).not.toBeNull()
    const handler = (root!.props.onClick as () => void) ?? null
    expect(typeof handler).toBe('function')
    handler!()
    expect(onClick).toHaveBeenCalledTimes(1)
    // Interactive marker
    expect(root!.props.role).toBe('button')
    expect(root!.props.tabIndex).toBe(0)
  })

  it('renders «—» and "Нет данных" badge for null value', () => {
    const tree = render({
      metricId: 'm-null',
      label: 'Отсутствует',
      value: null,
    })
    const text = allText(tree)
    expect(text).toContain('«—»')
    expect(text).toContain('Нет данных')
  })

  it('applies highlight tint classes for strength', () => {
    const tree = render({
      metricId: 'm-s',
      label: 'Сильная сторона',
      value: 90,
      unit: '%',
      highlight: 'strength',
    })
    const classes = allClassNames(tree)
    expect(classes).toContain('border-primary/30')
    expect(classes).toContain('bg-primary/[0.04]')
  })

  it('formats sub-thousand integer with ru-RU separator', () => {
    const tree = render({
      metricId: 'm-i',
      label: 'Сделок',
      value: 1234,
      unit: 'count',
    })
    const text = allText(tree)
    // ru-RU uses a non-breaking space or regular thin space; we wrote >=1k as
    // "1.2 тыс" path. Above we used 1234 → 1.2 тыс.
    expect(text).toMatch(/1\.2\s*тыс/)
  })
})
