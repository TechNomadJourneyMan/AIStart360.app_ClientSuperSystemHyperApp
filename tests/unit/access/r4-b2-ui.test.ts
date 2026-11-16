/**
 * R4 B2 «Заявка → Pro → клиент знает» — что меняется на экране (react-dom/server):
 *   N4B-1  карточка заявки на оплату показывает срок ответа (4 ч), просрочка подсвечена;
 *   N4B-9  в карточке — ссылки на клиента (User 360) и на его «Сообщения»;
 *   N4B-4  «Настройки → Биллинг»: заявка менеджеру (как в пейволле), не мини-GRI,
 *          без обещания «сравнения и стоимости»;
 *   N4B-7  «Метрики» без замка (страница открыта всем); замок меню открывает ТОТ ЖЕ
 *          пейволл раздела, а не свою модалку «Pro тариф».
 */
import { describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next/navigation', () => ({ usePathname: () => '/admin-giga-panel/requests', useRouter: () => ({ push: () => {} }) }))

const html = (el: React.ReactElement) => renderToStaticMarkup(el)
const CLIENT = '00000000-0000-4000-8000-0000000000bb'
const noop = () => {}
const H = 3_600_000

describe('N4B-1 / N4B-9: the card of a request for paid access', () => {
  const base = {
    id: 'r1', category: 'access' as const, source: 'paywall', status: 'pending' as const, userName: 'Иван Петров', userEmail: 'ivan@corp.kz',
    subject: 'Платный доступ: Точка А', description: '…', createdAt: new Date(Date.now() - 6 * H).toISOString(), userId: CLIENT,
  }

  it('past the deadline: «Срок ответа прошёл … — просрочено», highlighted; links to User 360 and «Сообщения»', async () => {
    const { RequestCard } = await import('@/components/giga-panel/RequestsModule')
    const out = html(React.createElement(RequestCard, {
      request: { ...base, slaDueAt: new Date(Date.now() - 2 * H).toISOString() },
      onApprove: noop, onReject: noop, onArchive: noop, onAssignPro: noop, canAssignPro: true,
    }))
    expect(out).toContain('data-request-sla="overdue"')
    expect(out).toContain('Срок ответа прошёл')
    expect(out).toContain('просрочено на 2 ч')
    expect(out).toContain(`href="/admin-giga-panel/users/${CLIENT}"`)
    expect(out).toContain(`href="/admin-giga-panel/messages?user=${CLIENT}"`)
    expect(out).toContain('Открыть клиента (User 360)')
    expect(out).toContain('Написать в «Сообщения»')
  })

  it('before the deadline: «Ответить до …», not highlighted', async () => {
    const { RequestCard } = await import('@/components/giga-panel/RequestsModule')
    const out = html(React.createElement(RequestCard, {
      request: { ...base, slaDueAt: new Date(Date.now() + 3 * H).toISOString() },
      onApprove: noop, onReject: noop, onArchive: noop, onAssignPro: noop, canAssignPro: true,
    }))
    expect(out).toContain('data-request-sla="due"')
    expect(out).toContain('Ответить до')
    expect(out).not.toContain('просрочено')
  })

  it('a decided request has no deadline; a registration card has none of it', async () => {
    const { RequestCard } = await import('@/components/giga-panel/RequestsModule')
    const done = html(React.createElement(RequestCard, { request: { ...base, status: 'approved', slaDueAt: null }, onApprove: noop, onReject: noop, onArchive: noop }))
    expect(done).not.toContain('data-request-sla')
    expect(done).toContain('data-request-links') // the client is still reachable from a decided request
    const reg = html(React.createElement(RequestCard, { request: { ...base, category: 'registration', source: 'supabase_profile', slaDueAt: new Date().toISOString() }, onApprove: noop, onReject: noop, onArchive: noop }))
    expect(reg).not.toContain('data-request-sla')
    expect(reg).not.toContain('data-request-links')
  })

  it('the model: no links without a valid client id; the dialog promises the channels the client really gets', async () => {
    const m = await import('@/components/giga-panel/assign-pro-model')
    expect(m.requestClientLinks(null)).toBeNull()
    expect(m.requestClientLinks('../../etc')).toBeNull()
    expect(m.requestSlaView({ status: 'pending', slaDueAt: 'garbage' })).toBeNull()
    const src = readFileSync('components/giga-panel/RequestsModule.tsx', 'utf8')
    expect(src).toContain('в ленте кабинета, на почту и в Telegram, если он его привязал')
  })
})

describe('N4B-4: «Настройки → Биллинг» — a request to the manager, not the free mini-GRI', () => {
  it('Free: «Подключить платный доступ», the request button, the payment stub; no /gri-free, no «сравнение и стоимость»', async () => {
    const { BillingRequestView, billingRequestMode } = await import('@/components/settings/BillingPanel')
    const mode = billingRequestMode({ tier: 'free', status: 'free', periodEnd: null })
    expect(mode).toBe('connect')
    const out = html(React.createElement(BillingRequestView, { mode: mode!, state: 'idle' }))
    expect(out).toContain('Подключить платный доступ')
    expect(out).toContain('Оставить заявку на доступ')
    expect(out).toContain('Онлайн-оплата пока не подключена')
    expect(out).toContain('data-feature="pro"')
    expect(out).not.toContain('/gri-free')
    expect(out).not.toMatch(/сравнение и стоимость|Выбрать тариф/)
    expect(out).not.toMatch(/<button[^>]*disabled=""/)
  })

  it('Pro with an end date or expired → «Продлить доступ»; open-ended Pro → no block', async () => {
    const { BillingRequestView, billingRequestMode } = await import('@/components/settings/BillingPanel')
    expect(billingRequestMode({ tier: 'pro', status: 'active', periodEnd: '2099-01-01T00:00:00.000Z' })).toBe('renew')
    expect(billingRequestMode({ tier: 'pro', status: 'expired', periodEnd: '2020-01-01T00:00:00.000Z' })).toBe('renew')
    expect(billingRequestMode({ tier: 'pilot', status: 'trialing', periodEnd: '2099-01-01T00:00:00.000Z' })).toBe('renew')
    expect(billingRequestMode({ tier: 'pro', status: 'active', periodEnd: null })).toBeNull()
    const out = html(React.createElement(BillingRequestView, { mode: 'renew', state: 'sent' }))
    expect(out).toContain('Продлить доступ')
    expect(out).toContain('Заявка у менеджера')
    expect(out).toMatch(/<button[^>]*disabled=""/)
  })

  it('the panel source no longer links the tariff choice to /gri-free; «pro» is a known request section', async () => {
    const src = readFileSync('components/settings/BillingPanel.tsx', 'utf8')
    expect(src).not.toContain('href="/gri-free"')
    expect(src).not.toContain('сравнение и стоимость')
    expect(src).toContain("sendAccessRequest(fetch, 'pro')")
    const { isKnownRequestFeature, featureLabel } = await import('@/lib/access/upgrade-requests')
    expect(isKnownRequestFeature('pro')).toBe(true)
    expect(featureLabel('pro')).toContain('Тариф Pro')
  })
})

describe('N4B-7: «Метрики» — the lock matches the real access; one paywall', () => {
  it('the old menu locks only the paid sections, and a lock leads to the paywall of that section', async () => {
    const { PREMIUM_SECTIONS, paywallFeatureOf } = await import('@/hooks/useEntitlements')
    expect(PREMIUM_SECTIONS).not.toContain('/metrics')
    expect(paywallFeatureOf('/metrics')).toBeNull()
    expect(paywallFeatureOf('/point-a/insights')).toBe('point_a')
    expect(paywallFeatureOf('/point-b')).toBe('point_b')
    expect(paywallFeatureOf('/market')).toBe('market')
    expect(paywallFeatureOf('/gri')).toBe('gri_full')
  })

  it('the Sidebar opens THE paywall (components/access/Paywall) instead of its own «Pro тариф» window', () => {
    const src = readFileSync('components/layout/Sidebar.tsx', 'utf8')
    expect(src).toContain("import Paywall from '@/components/access/Paywall'")
    expect(src).toContain('<Paywall feature={premiumFeature} variant="compact" />')
    expect(src).not.toContain('Раздел входит в тариф')
    expect(src).not.toContain('Pro тариф')
    expect(src).not.toContain("'/metrics': 'Метрики'")
  })
})
