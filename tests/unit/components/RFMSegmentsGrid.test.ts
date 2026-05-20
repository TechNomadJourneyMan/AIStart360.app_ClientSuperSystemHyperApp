import { describe, it, expect } from 'vitest'

import { RFMSegmentsGridView } from '@/components/dashboard/RFMSegmentsGrid'
import type { RFMSegmentRow } from '@/types/point-a-v3'
import { walk, collectText, flatten } from './_walk'

function render(props: Parameters<typeof RFMSegmentsGridView>[0]) {
  return walk(RFMSegmentsGridView(props))
}

function textOf(props: Parameters<typeof RFMSegmentsGridView>[0]) {
  return collectText(RFMSegmentsGridView(props))
}

function buildSegments(): RFMSegmentRow[] {
  const meta: Array<[RFMSegmentRow['segment'], string, number]> = [
    ['vip_retention', 'VIP — удержание', 120],
    ['vip_reactivation', 'VIP — реактивация', 38],
    ['loyal_active', 'Лояльные активные', 612],
    ['churn_risk', 'Риск оттока', 287],
    ['sleeping', 'Спящие', 894],
    ['onetime_fresh', 'Разовые свежие', 412],
    ['onetime_old', 'Разовые старые', 188],
  ]
  return meta.map(([id, label_ru, count], i) => ({
    segment: id,
    label_ru,
    count,
    share_pct: 14 - i,
    total_revenue_kzt: count * 50_000,
    avg_check_kzt: 50_000,
    avg_recency_days: 30 * i,
    suggested_action_ru: `Действие ${i + 1}`,
  }))
}

describe('RFMSegmentsGridView', () => {
  it('renders all 7 RFM segment cards', () => {
    const segments = buildSegments()
    const tree = render({
      hasClientBase: true,
      segments,
      totalClients: 2551,
    })
    const text = collectText(RFMSegmentsGridView({
      hasClientBase: true,
      segments,
      totalClients: 2551,
    }))
    for (const s of segments) {
      expect(text).toContain(s.label_ru)
    }
    const cards = flatten(tree).filter(
      (n) =>
        typeof n.props['data-testid'] === 'string' &&
        (n.props['data-testid'] as string).startsWith('rfm-') &&
        !['rfm-skeleton', 'rfm-empty', 'rfm-error'].includes(
          n.props['data-testid'] as string,
        ),
    )
    expect(cards).toHaveLength(7)
  })

  it('shows total clients banner', () => {
    const text = textOf({
      hasClientBase: true,
      segments: buildSegments(),
      totalClients: 2551,
    })
    expect(text).toContain('Всего клиентов в базе')
  })

  it('renders empty state without client base', () => {
    const tree = render({ hasClientBase: false, segments: [] })
    expect(
      flatten(tree).some((n) => n.props['data-testid'] === 'rfm-empty'),
    ).toBe(true)
    expect(collectText(RFMSegmentsGridView({ hasClientBase: false, segments: [] }))).toContain('Сегментация ещё не рассчитана')
  })

  it('renders skeleton while loading', () => {
    const tree = render({ segments: [], isLoading: true })
    expect(
      flatten(tree).some((n) => n.props['data-testid'] === 'rfm-skeleton'),
    ).toBe(true)
  })
})
