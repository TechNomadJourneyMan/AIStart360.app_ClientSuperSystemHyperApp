/**
 * Settings › Биллинг shows the effective plan from the unified source (W8):
 * a plan assigned in GIGA is visible to the client with its source, period and
 * honest status; the administrator's internal note never reaches the client.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { fakeClient, fakeDb, sqlModel, type FakeDb } from './_fake-supabase'

const USER = '11111111-2222-3333-4444-555555555555'
const state = vi.hoisted(() => ({ client: null as unknown, user: { id: '11111111-2222-3333-4444-555555555555' } as { id: string } | null }))
vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => state.client }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user } }) } }),
}))

import { GET } from '@/app/api/v1/settings/billing/route'
import { BillingPlanView, type BillingPlan } from '@/components/settings/BillingPanel'

let db: FakeDb
const iso = (d: Date) => d.toISOString().replace('Z', '')
const render = (plan: BillingPlan) => renderToStaticMarkup(createElement(BillingPlanView, { plan }))

describe('GET /api/v1/settings/billing', () => {
  beforeEach(() => {
    state.user = { id: USER }
    db = fakeDb({ profiles: [{ id: USER, tier: 'free' }], companies: [{ id: 'company-1', user_id: USER }], subscriptions: [] })
    state.client = fakeClient(db, sqlModel)
  })

  it('a plan assigned in GIGA (company tenant key) is the client\'s plan, without the internal note', async () => {
    db.tables.subscriptions.push({
      orgId: 'company-1', tier: 'enterprise', status: 'active', currentPeriodEnd: '2099-03-01T00:00:00',
      source: 'admin', note: 'скидка по договору', updatedAt: iso(new Date()),
    })
    db.tables.profiles[0].tier = 'pro'
    const body = await (await GET()).json()
    expect(body).toEqual({
      ok: true,
      data: { tier: 'enterprise', status: 'active', periodEnd: '2099-03-01T00:00:00.000Z', source: 'admin', provider: null, accessTier: 'pro' },
    })
    expect(JSON.stringify(body)).not.toContain('скидка')
  })

  it('Pro granted in GIGA before migration 106 (profiles.tier only) is no longer «no subscription»', async () => {
    db.tables.profiles[0].tier = 'pro'
    const body = await (await GET()).json()
    expect(body.data).toMatchObject({ tier: 'pro', status: 'active', source: 'admin', periodEnd: null })
  })

  it('a free client reads as free; anonymous is 401', async () => {
    expect((await (await GET()).json()).data).toMatchObject({ tier: 'free', status: 'free', source: null })
    state.user = null
    expect((await GET()).status).toBe(401)
  })
})

describe('BillingPlanView', () => {
  const base: BillingPlan = { tier: 'pro', status: 'active', periodEnd: null, source: 'admin', provider: null, accessTier: 'pro' }

  it('admin-assigned plan: tier, source «назначен администратором», end date, no payment claimed', () => {
    const html = render({ ...base, tier: 'enterprise', periodEnd: '2099-03-01T00:00:00.000Z' })
    expect(html).toContain('Enterprise')
    expect(html).toContain('Назначен администратором')
    expect(html).toContain('Действует до')
    expect(html).toContain('1 марта 2099')
    expect(html).toContain('оплата через сайт не проводилась')
    expect(html).not.toContain('Способ оплаты')
  })

  it('open-ended plan says «Бессрочно»', () => {
    expect(render(base)).toContain('Бессрочно')
  })

  it('paid via Kaspi: «Оплачен» and the provider', () => {
    const html = render({ ...base, source: 'kaspi', provider: 'kaspi', periodEnd: '2099-01-01T00:00:00.000Z' })
    expect(html).toContain('Оплачен')
    expect(html).toContain('Kaspi.kz')
  })

  it('trial: «Пробный период» and «Пробный до»', () => {
    const html = render({ ...base, tier: 'pilot', status: 'trialing', source: 'trial', periodEnd: '2099-01-01T00:00:00.000Z' })
    expect(html).toContain('Пилот')
    expect(html).toContain('Пробный до')
    expect(html).toContain('Пробный')
  })

  it('expired plan is shown as ended, not as active', () => {
    const html = render({ ...base, status: 'expired', periodEnd: '2020-01-01T00:00:00.000Z' })
    expect(html).toContain('Срок истёк')
    expect(html).toContain('будет переведён на бесплатный')
  })

  it('free after the expiry job says so honestly', () => {
    const html = render({ tier: 'free', status: 'canceled', periodEnd: null, source: 'system', provider: null, accessTier: 'free' })
    expect(html).toContain('Бесплатный доступ')
    expect(html).toContain('Срок прошлого тарифа закончился')
  })
})
