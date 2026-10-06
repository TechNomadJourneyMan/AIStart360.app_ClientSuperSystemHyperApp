// Renders /client/dashboard-ecommerce to static markup with an injected load
// state (react-dom/server runs no effects, so the data hook's useState is
// seeded instead). Guards the client-facing copy: no demo shop, honest empty
// states, provenance captions, ROAS never shown as LTV/CAC.
import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const seeded = vi.hoisted(() => ({ state: undefined as unknown }))

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()
  const useState = ((init: unknown) =>
    actual.useState(seeded.state !== undefined ? seeded.state : init)) as typeof actual.useState
  return { ...actual, default: { ...actual, useState }, useState }
})

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => {
    throw new Error('no Supabase in unit tests')
  },
}))

const { default: DashboardEcommercePage } = await import('@/app/client/dashboard-ecommerce/page')

function render(state: unknown): string {
  seeded.state = state
  try {
    return renderToStaticMarkup(createElement(DashboardEcommercePage))
  } finally {
    seeded.state = undefined
  }
}

const DEMO_STRINGS = ['Demo Shop', 'iPhone', 'AirPods', 'Wildberries', 'Uzum', 'Trendyol', 'Yandex Direct', 'TikTok Ads', '84.2', '84,2', 'демо']

describe('dashboard-ecommerce page markup', () => {
  it('without survey answers shows empty states and no demo data', () => {
    const html = render({ status: 'ready', answers: {}, companyName: null, companyIndustry: null })
    for (const s of DEMO_STRINGS) expect(html).not.toContain(s)
    expect(html).toContain('Ваш магазин')
    expect(html).toContain('анкета не заполнена')
    expect(html).toContain('Заполнить анкету')
    expect(html).toContain('Нет данных. Заполните шаг «Воронка» анкеты')
    expect(html).toContain('Нет данных. Заполните шаг «Трафик» анкеты')
    expect(html).toContain('Интеграция пока не подключена')
    expect(html).toContain('href="/client/onboarding-ecommerce"')
    expect(html).toContain('Цель не задана')
    expect(html).not.toContain('>LTV/CAC<') // the KPI tile label; the goal hint text may mention LTV/CAC
    expect(html).toContain('Типовые цели для e-commerce')
    expect(html).not.toContain('11 ЦЕЛЕЙ')
  })

  it('with survey answers shows the client values with provenance captions', () => {
    const html = render({
      status: 'ready',
      companyName: 'ТОО Сумкин',
      companyIndustry: null,
      answers: {
        ec_platforms: ['Shopify'],
        ec_revenue_2024: 60_000_000,
        ec_aov: 9_000,
        ec_visitors_per_month: 50_000,
        ec_cr_visit_to_cart: 8,
        ec_cr_cart_to_pay: 25,
        ec_roas: 4.5,
      },
    })
    for (const s of DEMO_STRINGS) expect(html).not.toContain(s)
    expect(html).toContain('ТОО Сумкин')
    expect(html).toContain('данные из анкеты')
    expect(html).toContain('₸60 млн')
    expect(html).toContain('расчёт по анкете: посетители × конверсии')
    expect(html).toContain('>ROAS<')
    expect(html).toContain('4,5x')
    expect(html).not.toContain('>LTV/CAC<') // the KPI tile label; the goal hint text may mention LTV/CAC
    expect(html).toContain('Цель не задана')
  })

  it('shows an error instead of claiming «no data» when loading fails', () => {
    const html = render({ status: 'error' })
    expect(html).toContain('Не удалось загрузить данные')
    expect(html).not.toContain('Нет данных. Заполните')
  })
})
