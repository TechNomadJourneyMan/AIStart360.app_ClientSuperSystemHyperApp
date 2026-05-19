import { describe, it, expect } from 'vitest'
import MetricTrendBadge from '@/components/dashboard/MetricTrendBadge'
import { walk, allText, allClassNames } from './_walk'

function render(props: Parameters<typeof MetricTrendBadge>[0]) {
  return walk(MetricTrendBadge(props))
}

describe('MetricTrendBadge', () => {
  it('uses trending_up icon and primary color for up + not inverse', () => {
    const tree = render({ direction: 'up', deltaPct: 12.4 })
    const text = allText(tree)
    const classes = allClassNames(tree)
    expect(text).toContain('trending_up')
    expect(text).toContain('+12.4%')
    expect(classes).toContain('text-primary')
  })

  it('uses trending_down with error color for down + not inverse', () => {
    const tree = render({ direction: 'down', deltaPct: -5 })
    const text = allText(tree)
    const classes = allClassNames(tree)
    expect(text).toContain('trending_down')
    expect(text).toContain('-5.0%')
    expect(classes).toContain('text-error')
  })

  it('flips semantics for inverse=true (CAC-style)', () => {
    const upInverse = render({ direction: 'up', deltaPct: 8, inverse: true })
    const downInverse = render({ direction: 'down', deltaPct: -8, inverse: true })
    expect(allClassNames(upInverse)).toContain('text-error')
    expect(allClassNames(downInverse)).toContain('text-primary')
  })

  it('renders flat with neutral color and 0%', () => {
    const tree = render({ direction: 'flat' })
    const text = allText(tree)
    const classes = allClassNames(tree)
    expect(text).toContain('trending_flat')
    expect(text).toContain('0%')
    expect(classes).toContain('text-on-surface-variant')
  })

  it('appends periodLabel when provided', () => {
    const tree = render({
      direction: 'up',
      deltaPct: 3,
      periodLabel: 'vs прошлый квартал',
    })
    expect(allText(tree)).toContain('vs прошлый квартал')
  })

  it('marks direction via data attribute', () => {
    const tree = render({ direction: 'up', deltaPct: 1 })
    expect(tree?.props['data-direction']).toBe('up')
    expect(tree?.props['data-inverse']).toBe('false')
  })
})
