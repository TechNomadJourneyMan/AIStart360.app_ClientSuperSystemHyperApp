import { describe, it, expect } from 'vitest'

import { RetentionCurveWidgetView } from '@/components/dashboard/RetentionCurveWidget'
import type { RetentionPoint } from '@/types/point-a-v3'
import { walk, collectText, allClassNames, flatten } from './_walk'

function render(props: Parameters<typeof RetentionCurveWidgetView>[0]) {
  return walk(RetentionCurveWidgetView(props))
}

function textOf(props: Parameters<typeof RetentionCurveWidgetView>[0]) {
  return collectText(RetentionCurveWidgetView(props))
}

const TARGETS: Record<RetentionPoint['horizon_days'], number> = {
  30: 75,
  60: 65,
  90: 60,
  180: 50,
  365: 40,
}

function buildPoints(currents: number[]): RetentionPoint[] {
  const horizons: RetentionPoint['horizon_days'][] = [30, 60, 90, 180, 365]
  return horizons.map((h, i) => ({
    horizon_days: h,
    current: currents[i] ?? 0,
    plan_slice: 100,
    fact: 80,
    target_pct: TARGETS[h],
  }))
}

describe('RetentionCurveWidgetView', () => {
  it('renders all 5 horizon columns with Russian labels', () => {
    const props = {
      hasClientBase: true,
      points: buildPoints([60, 50, 40, 30, 20]),
    }
    const tree = render(props)
    const text = textOf(props)
    expect(text).toContain('30 дней')
    expect(text).toContain('60 дней')
    expect(text).toContain('90 дней')
    expect(text).toContain('Полгода')
    expect(text).toContain('Год')
    const nodes = flatten(tree).filter((n) =>
      typeof n.props['data-testid'] === 'string' &&
      (n.props['data-testid'] as string).startsWith('retention-'),
    )
    expect(nodes).toHaveLength(5)
  })

  it('colors fact green when current ≥ target, amber for partial, error when far below', () => {
    // 30 → target 75. current 80 = green (primary)
    const green = render({
      hasClientBase: true,
      points: buildPoints([80, 0, 0, 0, 0]),
    })
    expect(allClassNames(green)).toContain('text-primary')

    // 30 → target 75. current 60 ≈ 0.8 → amber-400
    const amber = render({
      hasClientBase: true,
      points: buildPoints([60, 0, 0, 0, 0]),
    })
    expect(allClassNames(amber)).toContain('text-amber-400')

    // 30 → target 75. current 30 ≈ 0.4 → error
    const red = render({
      hasClientBase: true,
      points: buildPoints([30, 0, 0, 0, 0]),
    })
    expect(allClassNames(red)).toContain('text-error')
  })

  it('renders empty state when client base is missing', () => {
    const props = { hasClientBase: false, points: [] }
    const tree = render(props)
    expect(textOf(props)).toContain('Нет данных по удержанию')
    expect(
      flatten(tree).some(
        (n) => n.props['data-testid'] === 'retention-curve-empty',
      ),
    ).toBe(true)
  })

  it('renders skeleton while loading', () => {
    const tree = render({ points: [], isLoading: true })
    expect(
      flatten(tree).some(
        (n) => n.props['data-testid'] === 'retention-curve-skeleton',
      ),
    ).toBe(true)
  })
})
