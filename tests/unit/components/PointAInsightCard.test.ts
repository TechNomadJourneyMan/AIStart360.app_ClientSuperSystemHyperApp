import { describe, it, expect, vi } from 'vitest'
import * as React from 'react'

// Stub the Button import to avoid vite parsing the existing JSX-preserve .tsx
// file (project tsconfig sets jsx:preserve which vite cannot import-analyze).
vi.mock('@/components/ui/Button', () => ({
  Button: (
    props: {
      variant?: string
      size?: string
      onClick?: () => void
      children?: React.ReactNode
    }
  ) =>
    React.createElement(
      'button',
      {
        'data-stub': 'button',
        'data-variant': props.variant ?? '',
        'data-size': props.size ?? '',
        variant: props.variant,
        size: props.size,
        onClick: props.onClick,
      },
      props.children
    ),
  buttonVariants: () => '',
}))

import PointAInsightCard from '@/components/point-a/PointAInsightCard'
import { walk, allClassNames, allText, flatten } from './_walk'

function render(props: Parameters<typeof PointAInsightCard>[0]) {
  return walk(PointAInsightCard(props))
}

describe('PointAInsightCard', () => {
  it('renders the area label and body text', () => {
    const tree = render({
      kind: 'insight',
      area: 'Финансы',
      text: 'Маржа стабильно растёт квартал к кварталу.',
    })
    const text = allText(tree)
    expect(text).toContain('Финансы')
    expect(text).toContain('Маржа стабильно растёт квартал к кварталу.')
  })

  it('applies critical-risk border + bg', () => {
    const tree = render({
      kind: 'risk',
      level: 'critical',
      area: 'Кэш',
      text: 'Кассовый разрыв через 30 дней.',
    })
    const classes = allClassNames(tree)
    expect(classes).toContain('border-error/50')
    expect(classes).toContain('bg-error/[0.06]')
    expect(tree?.props['data-kind']).toBe('risk')
    expect(tree?.props['data-level']).toBe('critical')
  })

  it('applies moderate-risk amber tint', () => {
    const tree = render({
      kind: 'risk',
      level: 'moderate',
      area: 'Маркетинг',
      text: 'Заметна сезонная просадка.',
    })
    const classes = allClassNames(tree)
    expect(classes).toContain('border-amber-400/30')
    expect(classes).toContain('bg-amber-400/[0.04]')
  })

  it('applies quick_win primary tint and shows the timeline chip', () => {
    const tree = render({
      kind: 'quick_win',
      area: 'Продажи',
      text: 'Запустить триггерную рассылку.',
      timeline: '2 недели',
    })
    const classes = allClassNames(tree)
    expect(classes).toContain('border-primary/40')
    expect(classes).toContain('bg-primary/[0.06]')
    expect(allText(tree)).toContain('Срок: 2 недели')
  })

  it('applies opportunity tertiary tint', () => {
    const tree = render({
      kind: 'opportunity',
      area: 'Продукт',
      text: 'Расширение на B2B канал.',
    })
    const classes = allClassNames(tree)
    expect(classes).toContain('border-tertiary-container/40')
    expect(classes).toContain('bg-tertiary-container/[0.06]')
  })

  it('fires CTA onClick with the proper button variant', () => {
    const onClick = vi.fn()
    const tree = render({
      kind: 'quick_win',
      area: 'Продажи',
      text: 'Подключить онбординг-чек-лист.',
      cta: { label: 'Запустить', onClick },
    })
    // Find the Button child (forwardRef → typeName 'Button' or 'ForwardRef').
    const buttonNode = flatten(tree).find(
      (n) =>
        n.typeName === 'Button' ||
        (typeof n.props.variant === 'string' && typeof n.props.onClick === 'function')
    )
    expect(buttonNode).toBeTruthy()
    expect(buttonNode!.props.variant).toBe('primary')
    ;(buttonNode!.props.onClick as () => void)()
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('uses danger variant for risk CTAs and secondary for insight CTAs', () => {
    const onClick = vi.fn()
    const riskTree = render({
      kind: 'risk',
      level: 'critical',
      area: 'Кэш',
      text: 'Срочно поднять линию.',
      cta: { label: 'План', onClick },
    })
    const insightTree = render({
      kind: 'insight',
      area: 'Финансы',
      text: 'Можно увеличить маржу.',
      cta: { label: 'Детали', onClick },
    })
    const findVariant = (tree: ReturnType<typeof render>) =>
      flatten(tree).find((n) => typeof n.props.variant === 'string')!.props.variant
    expect(findVariant(riskTree)).toBe('danger')
    expect(findVariant(insightTree)).toBe('secondary')
  })
})
