import { describe, it, expect } from 'vitest'

import { LossMapCardView } from '@/components/dashboard/LossMapCard'
import type { LossBucket } from '@/types/point-a-v3'
import { walk, collectText, flatten } from './_walk'

function render(props: Parameters<typeof LossMapCardView>[0]) {
  return walk(LossMapCardView(props))
}

function textOf(props: Parameters<typeof LossMapCardView>[0]) {
  return collectText(LossMapCardView(props))
}

function buildBuckets(): LossBucket[] {
  // Intentionally NOT sorted — view should sort by loss desc.
  return [
    {
      bucket: 'no_followup',
      label_ru: 'Нет follow-up',
      loss_kzt_per_month: 1_500_000,
      loss_kzt_per_year: 18_000_000,
      severity: 'high',
      recommendation_ru: 'WhatsApp-цепочка',
      data_source: 'survey.s2_repeat_freq_days',
    },
    {
      bucket: 'no_show',
      label_ru: 'No-show',
      loss_kzt_per_month: 2_800_000,
      loss_kzt_per_year: 34_000_000,
      severity: 'critical',
      recommendation_ru: 'Подтверждение в WhatsApp',
      data_source: 'funnel.NoShow',
    },
    {
      bucket: 'missed_incoming',
      label_ru: 'Потерянные входящие',
      loss_kzt_per_month: 1_800_000,
      loss_kzt_per_year: 22_500_000,
      severity: 'high',
      recommendation_ru: 'Авто-перезвон',
      data_source: 'funnel.Missed',
    },
    {
      bucket: 'no_upsell',
      label_ru: 'Нет допродаж',
      loss_kzt_per_month: 1_200_000,
      loss_kzt_per_year: 14_000_000,
      severity: 'medium',
      recommendation_ru: 'Bundle-офферы',
      data_source: 'survey.s2_ltv',
    },
    {
      bucket: 'no_reactivation',
      label_ru: 'Нет реактивации',
      loss_kzt_per_month: 900_000,
      loss_kzt_per_year: 11_000_000,
      severity: 'medium',
      recommendation_ru: 'Сегментная рассылка',
      data_source: 'rfm.sleeping',
    },
    {
      bucket: 'weak_nps',
      label_ru: 'Слабый NPS',
      loss_kzt_per_month: 400_000,
      loss_kzt_per_year: 4_800_000,
      severity: 'low',
      recommendation_ru: 'NPS-опрос после визита',
      data_source: 'survey.s5n_will_return_nps',
    },
  ]
}

describe('LossMapCardView', () => {
  it('renders all 6 buckets and sorts them by annual loss desc', () => {
    const buckets = buildBuckets()
    const tree = render({
      hasClientBase: true,
      buckets,
      totalKzt: buckets.reduce((s, b) => s + b.loss_kzt_per_year, 0),
      dominant: 'no_show',
    })
    const cardNodes = flatten(tree).filter(
      (n) =>
        typeof n.props['data-testid'] === 'string' &&
        (n.props['data-testid'] as string).startsWith('loss-') &&
        ![
          'loss-map-skeleton',
          'loss-map-empty',
          'loss-map-error',
        ].includes(n.props['data-testid'] as string),
    )
    expect(cardNodes).toHaveLength(6)
    // First card after sort should be no_show (highest loss = 34M).
    expect(cardNodes[0].props['data-testid']).toBe('loss-no_show')
    // Last card should be weak_nps (lowest).
    expect(cardNodes[5].props['data-testid']).toBe('loss-weak_nps')
  })

  it('shows total loss banner when totalKzt is provided', () => {
    const props = {
      hasClientBase: true,
      buckets: buildBuckets(),
      totalKzt: 104_300_000,
      dominant: 'no_show' as const,
    }
    expect(textOf(props)).toContain('Общие потери в год')
  })

  it('renders empty state without data', () => {
    const props = { hasClientBase: false, buckets: [] }
    const tree = render(props)
    expect(
      flatten(tree).some(
        (n) => n.props['data-testid'] === 'loss-map-empty',
      ),
    ).toBe(true)
    expect(textOf(props)).toContain('Карта потерь ещё не рассчитана')
  })

  it('uses critical severity styling for the top bucket', () => {
    const buckets = buildBuckets()
    const tree = render({
      hasClientBase: true,
      buckets,
      totalKzt: 1,
      dominant: 'no_show',
    })
    const top = flatten(tree).find(
      (n) => n.props['data-testid'] === 'loss-no_show',
    )!
    const cls = (top.props.className as string) ?? ''
    expect(cls).toContain('ring-error/30')
  })
})
