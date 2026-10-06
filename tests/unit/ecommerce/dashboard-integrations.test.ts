// /client/dashboard-ecommerce with the integration snapshot (W7): without a
// connection the blocks say «Интеграция пока не подключена» and link to
// Settings › Интеграции; with connections they show the per-provider numbers
// and the integration-fed metrics (source external) with their provenance.
import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const seeded = vi.hoisted(() => ({ state: undefined as unknown }))

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()
  const useState = ((init: unknown) => actual.useState(seeded.state !== undefined ? seeded.state : init)) as typeof actual.useState
  return { ...actual, default: { ...actual, useState }, useState }
})
vi.mock('@/lib/supabase/client', () => ({ createClient: () => { throw new Error('no Supabase in unit tests') } }))

const { default: DashboardEcommercePage } = await import('@/app/client/dashboard-ecommerce/page')

function render(state: unknown): string {
  seeded.state = state
  try {
    return renderToStaticMarkup(createElement(DashboardEcommercePage))
  } finally {
    seeded.state = undefined
  }
}

const base = { status: 'ready', answers: { ec_aov: 9000 }, companyName: 'ТОО Сумкин', companyIndustry: null }

describe('dashboard-ecommerce integration blocks', () => {
  it('no connection: honest «нет подключения» with a link to Settings › Интеграции', () => {
    const html = render({ ...base, integrations: { connections: [], providers: [], metrics: {}, generatedAt: '2026-10-06T10:00:00Z' } })
    expect(html).toContain('Интеграция пока не подключена')
    expect(html).toContain('href="/settings?tab=integrations"')
    expect(html).not.toContain('из подключения')
    expect(html).toContain('из анкеты') // the survey AOV stays
  })

  it('connected: per-provider numbers and the metric value with provenance', () => {
    const html = render({
      ...base,
      integrations: {
        connections: [{ provider: 'kaspi', status: 'connected', authKind: 'token', accountLabel: 'Kaspi Магазин', lastSyncAt: '2026-10-06T09:00:00Z', lastError: null }],
        providers: [{
          provider: 'kaspi', periodStart: '2026-09-06', periodEnd: '2026-10-05', fetchedAt: '2026-10-06T09:00:00Z',
          totals: { orders_count: { value: 120, unit: 'count' }, revenue: { value: 1_200_000, unit: 'KZT' }, sales_count: { value: 100, unit: 'count' } },
          snapshots: {}, returnsRatePct: 4, averageOrder: { value: 12_000, unit: 'KZT' }, filling: false,
        }],
        metrics: {
          'biz.prodazhi.ecommerce_sredniy_chek': {
            metricId: 'biz.prodazhi.ecommerce_sredniy_chek', value: 12_000, unit: '₸', source: 'external', computedAt: '2026-10-06T09:05:00Z',
            provenance: { external: { provider: 'kaspi', period_start: '2026-09-06', period_end: '2026-10-05' } },
          },
        },
        generatedAt: '2026-10-06T10:00:00Z',
      },
    })
    expect(html).toContain('Kaspi Магазин')
    expect(html).toContain('30 дней · 06.09 — 05.10')
    expect(html).toContain('из подключения · Kaspi Магазин · 06.09 — 05.10')
    expect(html).toContain('₸1,2 млн')
    expect(html).toContain('4%')
    expect(html).not.toContain('Интеграция пока не подключена. Подключите маркетплейсы')
  })
})
