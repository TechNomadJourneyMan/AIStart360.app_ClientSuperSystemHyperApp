/**
 * R2-A: the ONE paywall (components/access/Paywall.tsx), its model, the page
 * gate (components/access/FeatureGate.tsx) and the menus that mark paid
 * sections. Honest: what is inside, what stays free, payment is not connected,
 * one action — «Оставить заявку на доступ».
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const s = vi.hoisted(() => ({
  user: { id: 'u-1' } as { id: string } | null,
  sections: { point_a: false, point_b: false, market: false, gri_full: false } as Record<string, boolean>,
  open: null as null | { id: string; features: string[]; payload: Record<string, unknown> },
  accessThrows: false,
}))

vi.mock('@/lib/request-user', () => ({ getRequestUser: async () => s.user }))
vi.mock('@/lib/access/request-access', () => ({
  getRequestAccess: async () => {
    if (s.accessThrows) throw new Error('db down')
    return { gatesEnabled: true, staff: false, ent: {}, sections: s.sections }
  },
}))
vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => ({}) }))
vi.mock('@/lib/access/upgrade-requests', () => ({ findOpenAccessRequest: async () => s.open }))

const { default: Paywall } = await import('@/components/access/Paywall')
const { UpgradeGate } = await import('@/components/access/UpgradeGate')
const { default: FeatureGate } = await import('@/components/access/FeatureGate')
const model = await import('@/components/access/paywall-model')
const { buildClientNav } = await import('@/lib/client-shell/nav')

const html = (el: React.ReactElement) => renderToStaticMarkup(el)

beforeEach(() => {
  s.user = { id: 'u-1' }
  s.sections = { point_a: false, point_b: false, market: false, gri_full: false }
  s.open = null
  s.accessThrows = false
})

describe('Paywall — one component for every paid section', () => {
  for (const feature of ['point_a', 'point_b', 'market', 'gri_full'] as const) {
    it(`${feature}: says it is paid, what is inside, the payment stub and offers the request`, () => {
      const out = html(React.createElement(Paywall, { feature, initialRequested: false }))
      const copy = model.PAYWALL_COPY[feature]
      expect(out).toContain(copy.title)
      expect(out).toContain('Платный доступ')
      for (const item of copy.includes) expect(out).toContain(item.text.replace(/«/g, '«'))
      expect(out).toContain('Оставить заявку на доступ')
      expect(out).toContain(model.PAYMENT_NOTE)
      expect(out).toContain(`data-paywall="${feature}"`)
      // the button is active, nothing pretends a payment
      expect(out).not.toMatch(/<button[^>]*disabled=""/)
      expect(out).not.toMatch(/Оплатить|оплачено|Купить/)
    })
  }

  it('what stays free is linked (full GRI → the express assessment and the mini-GRI)', () => {
    const out = html(React.createElement(Paywall, { feature: 'gri_full', initialRequested: false }))
    expect(out).toContain('href="/client/onboarding"')
    expect(out).toContain('href="/gri-free"')
  })

  it('an open request: «Заявка отправлена, с вами свяжутся», the button cannot send again', () => {
    const out = html(React.createElement(Paywall, { feature: 'market', initialRequested: true }))
    expect(out).toContain('Заявка отправлена')
    expect(out).toContain(model.SENT_TEXT)
    expect(out).toMatch(/<button[^>]*disabled=""/)
  })

  it('unknown request state (no server answer yet) → the button waits instead of double-sending', () => {
    expect(html(React.createElement(Paywall, { feature: 'point_a' }))).toMatch(/<button[^>]*disabled=""/)
  })

  it('compact variant (home / dashboard cards): title, lead, request and the note — no list', () => {
    const out = html(React.createElement(Paywall, { feature: 'point_a', variant: 'compact', initialRequested: false }))
    expect(out).toContain(model.PAYWALL_COPY.point_a.title)
    expect(out).toContain('Оставить заявку на доступ')
    expect(out).toContain(model.PAYMENT_NOTE)
    expect(out).not.toContain('Что входит')
  })

  it('UpgradeGate (kept for its callers) is the same paywall; no link to a billing page without payment', () => {
    const out = html(React.createElement(UpgradeGate, { feature: 'gri_full', compact: true }))
    expect(out).toContain(model.PAYWALL_COPY.gri_full.title)
    expect(out).not.toContain('/settings?tab=billing')
  })
})

describe('paywall-model', () => {
  it('sendAccessRequest posts the feature to the one endpoint; sent / error', async () => {
    const calls: Array<{ url: string; body: unknown }> = []
    const ok = (async (url: string, init: RequestInit) => { calls.push({ url, body: JSON.parse(String(init.body)) }); return { ok: true } }) as unknown as typeof fetch
    expect(await model.sendAccessRequest(ok, 'market')).toBe('sent')
    expect(calls[0]).toEqual({ url: '/api/v1/upgrade-request', body: { featureKey: 'market' } })
    expect(await model.sendAccessRequest((async () => ({ ok: false })) as unknown as typeof fetch, 'market')).toBe('error')
    expect(await model.sendAccessRequest((async () => { throw new Error('offline') }) as unknown as typeof fetch, 'market')).toBe('error')
  })

  it('readAccessRequest: true / false / unknown', async () => {
    const reply = (status: number, body: unknown) => (async () => ({ ok: status < 400, json: async () => body })) as unknown as typeof fetch
    expect(await model.readAccessRequest(reply(200, { ok: true, requested: true }))).toBe(true)
    expect(await model.readAccessRequest(reply(200, { ok: true, requested: false }))).toBe(false)
    expect(await model.readAccessRequest(reply(500, { ok: false }))).toBeNull()
    expect(await model.readAccessRequest((async () => { throw new Error('x') }) as unknown as typeof fetch)).toBeNull()
  })

  it('isUpgradeRequired: 402 or the error code', () => {
    expect(model.isUpgradeRequired(402, null)).toBe(true)
    expect(model.isUpgradeRequired(200, { error: 'upgrade_required' })).toBe(true)
    expect(model.isUpgradeRequired(500, { error: 'x' })).toBe(false)
  })

  it('unknown feature → a generic, still honest copy', () => {
    expect(model.paywallCopy('nope').title).toBe('Функция в платном доступе')
  })
})

describe('FeatureGate — the server gate of a paid page', () => {
  const child = React.createElement('div', { id: 'section-content' }, 'данные раздела')
  const render = async (feature: 'point_a' | 'point_b' | 'market' | 'gri_full') => html(await FeatureGate({ feature, children: child }))

  it('closed → the paywall, the section is not rendered (no data request)', async () => {
    const out = await render('point_a')
    expect(out).toContain('data-paywall="point_a"')
    expect(out).not.toContain('section-content')
  })

  it('an open request known on the server → «Заявка отправлена» at once', async () => {
    s.open = { id: 'r1', features: ['market'], payload: {} }
    expect(await render('market')).toContain(model.SENT_TEXT)
  })

  it('open (Pro / staff / gates off — the decision says so) → the section', async () => {
    s.sections = { ...s.sections, gri_full: true }
    const out = await render('gri_full')
    expect(out).toContain('section-content')
    expect(out).not.toContain('data-paywall')
  })

  it('no session → the section (middleware / API handle anonymous callers)', async () => {
    s.user = null
    expect(await render('point_b')).toContain('section-content')
  })

  it('a failed decision does not break the page (the API still answers 402)', async () => {
    s.accessThrows = true
    expect(await render('point_b')).toContain('section-content')
  })
})

describe('client menu: paid sections closed for the account carry a lock', () => {
  it('locked keys are marked, the items stay (they open the paywall)', () => {
    const items = buildClientNav({ approved: true, hiddenPaths: [], lockedKeys: ['point_a', 'point_b', 'gri'] })
    const byKey = Object.fromEntries(items.map((i) => [i.key, i]))
    expect(byKey.point_a.locked).toBe(true)
    expect(byKey.point_b.locked).toBe(true)
    expect(byKey.gri.locked).toBe(true)
    expect(byKey.survey.locked).toBeUndefined()
    expect(byKey.messages.locked).toBeUndefined()
    expect(byKey.documents.locked).toBeUndefined()
  })

  it('nothing locked by default', () => {
    expect(buildClientNav({ approved: true, hiddenPaths: [] }).some((i) => i.locked)).toBe(false)
  })
})
