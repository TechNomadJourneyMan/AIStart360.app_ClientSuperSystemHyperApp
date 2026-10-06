/**
 * KeyMetricsHero (#48): /api/v1/metrics does not apply period / product /
 * manager, so the hero neither sends them nor labels the tiles with them —
 * it says the filter does not apply.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const s = vi.hoisted(() => ({ params: new URLSearchParams(), filters: [] as unknown[] }))

vi.mock('next/navigation', () => ({ useSearchParams: () => s.params }))
vi.mock('@/hooks/useMetrics', () => ({
  useMetrics: (f: unknown) => { s.filters.push(f); return { data: [], isLoading: false, isError: false, refetch: async () => {} } },
}))
vi.mock('@/components/metrics/MetricDrillDownHost', () => ({ default: () => null }))

import KeyMetricsHero, { HERO_METRIC_IDS, unappliedFilterNote } from '@/components/point-a/v2/KeyMetricsHero'

beforeEach(() => {
  s.params = new URLSearchParams()
  s.filters = []
})

describe('KeyMetricsHero filters', () => {
  it('does not label company-wide tiles with the URL period / product / manager', () => {
    s.params = new URLSearchParams('period=quarter&product=Кофе&manager=Иван')
    const html = renderToStaticMarkup(createElement(KeyMetricsHero))
    expect(html).not.toContain('Период: Квартал')
    expect(html).not.toContain('Продукт: Кофе')
    expect(html).not.toContain('Менеджер: Иван')
    expect(html).toContain('к этим показателям пока не применяется')
    expect(s.filters.at(-1)).toEqual({ keys: HERO_METRIC_IDS })
  })

  it('without filters there is no chip and no note', () => {
    const html = renderToStaticMarkup(createElement(KeyMetricsHero))
    expect(html).not.toContain('Период:')
    expect(html).not.toContain('не применяется')
    expect(unappliedFilterNote({ period: null, product: null, manager: null })).toBeNull()
    expect(unappliedFilterNote({ period: 'year', product: null, manager: null })).toContain('период «Год»')
  })
})
