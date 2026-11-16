/**
 * R4 (N4B-10, решение PO 2026-11-16): платный доступ не кончается молча.
 * За 7 дней и за сутки — предупреждение клиенту (лента + письмо), когда срок
 * прошёл и крон перевёл кабинет на бесплатный — «Доступ закончился». Всё
 * идемпотентно по ключу (этап + подписка + дата окончания): повторный прогон
 * крона ничего не повторяет, продление (новая дата) предупредит заново.
 * Отправка подменена журналом с дедупликацией, как у notifyClient.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { fakeClient, fakeDb, sqlModel, type FakeDb } from './_fake-supabase'

const state = vi.hoisted(() => ({
  client: null as unknown,
  journal: new Set<string>(),
  sent: [] as Array<{ userId: string; stage: string; endsAt: string; dedupeKey: string; daysLeft?: number | null; trial?: boolean }>,
}))
vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => state.client }))
vi.mock('@/lib/notifications/product', () => ({
  notifyProExpiry: async (userId: string, input: { stage: string; endsAt: string; dedupeKey: string; daysLeft?: number | null; trial?: boolean }) => {
    if (state.journal.has(input.dedupeKey)) return { ok: true, skipped: 'duplicate', delivered: { inApp: false, email: false, telegram: false } }
    state.journal.add(input.dedupeKey)
    state.sent.push({ userId, ...input })
    return { ok: true, delivered: { inApp: true, email: true, telegram: false } }
  },
}))

const notices = await import('@/lib/payments/expiry-notices')
const billing = await import('@/lib/payments/billing')
const { GET } = await import('@/app/api/cron/billing-expiry/route')

const NOW = new Date('2026-12-03T00:15:00Z')
const H = 3_600_000
const at = (ms: number) => new Date(NOW.getTime() + ms).toISOString().replace('Z', '')
const U1 = '11111111-1111-4111-8111-111111111111'
const U2 = '22222222-2222-4222-8222-222222222222'
const U3 = '33333333-3333-4333-8333-333333333333'
const U4 = '44444444-4444-4444-8444-444444444444'
const U5 = '55555555-5555-4555-8555-555555555555'
let db: FakeDb

beforeEach(() => {
  state.journal = new Set()
  state.sent = []
  db = fakeDb({
    profiles: [U1, U2, U3, U4, U5].map((id) => ({ id, tier: 'pro' })),
    companies: [{ id: 'company-1', user_id: U1 }],
    subscriptions: [
      // company key, ends in 6 days → 'd7'
      { orgId: 'company-1', tier: 'pro', status: 'active', currentPeriodEnd: at(6 * 24 * H), source: 'admin', updatedAt: at(-H) },
      // user key, ends in 20 hours → 'd1'
      { orgId: U2, tier: 'pro', status: 'active', currentPeriodEnd: at(20 * H), source: 'admin', updatedAt: at(-H) },
      // a trial: trialEndsAt counts, ends in 3 days → 'd7' (trial wording)
      { orgId: U3, tier: 'pilot', status: 'trialing', trialEndsAt: at(3 * 24 * H), currentPeriodEnd: null, source: 'trial', updatedAt: at(-H) },
      // ends in 10 days → nothing yet
      { orgId: U4, tier: 'pro', status: 'active', currentPeriodEnd: at(10 * 24 * H), source: 'admin', updatedAt: at(-H) },
      // open-ended Pro → never warned
      { orgId: U5, tier: 'pro', status: 'active', currentPeriodEnd: null, source: 'admin', updatedAt: at(-H) },
    ],
  })
  state.client = fakeClient(db, sqlModel)
})

describe('expiryStage', () => {
  it('7 days … 1 day → d7; ≤ 1 day → d1; past or > 7 days → nothing', () => {
    expect(notices.expiryStage(new Date(NOW.getTime() + 7 * 24 * H), NOW)).toBe('d7')
    expect(notices.expiryStage(new Date(NOW.getTime() + 7 * 24 * H + 1), NOW)).toBeNull()
    expect(notices.expiryStage(new Date(NOW.getTime() + 24 * H + 1), NOW)).toBe('d7')
    expect(notices.expiryStage(new Date(NOW.getTime() + 24 * H), NOW)).toBe('d1')
    expect(notices.expiryStage(new Date(NOW.getTime() + 1), NOW)).toBe('d1')
    expect(notices.expiryStage(new Date(NOW.getTime()), NOW)).toBeNull()
    expect(notices.daysLeft(new Date(NOW.getTime() + 6 * 24 * H + 23 * H).toISOString(), NOW)).toBe(7)
  })
})

describe('sendExpiryWarnings', () => {
  it('warns each person once per stage: 6 days → d7, 20 hours → d1, a trial → d7 with the trial flag; 10 days and open-ended → nothing', async () => {
    const r = await notices.sendExpiryWarnings({ now: NOW }, state.client as never)
    expect(r).toEqual({ due: 3, sent: 3, duplicate: 0, failed: 0 })
    const by = new Map(state.sent.map((x) => [x.userId, x]))
    expect(by.get(U1)).toMatchObject({ stage: 'd7', daysLeft: 6, trial: false })
    expect(by.get(U2)).toMatchObject({ stage: 'd1', trial: false })
    expect(by.get(U3)).toMatchObject({ stage: 'd7', daysLeft: 3, trial: true })
    expect(by.has(U4)).toBe(false)
    expect(by.has(U5)).toBe(false)
    expect(by.get(U1)!.dedupeKey).toBe(`pro_expiry:d7:company-1:${by.get(U1)!.endsAt}`)
  })

  it('idempotent: a second run the same day sends nothing; the next stage is a new notice; an extension warns again', async () => {
    await notices.sendExpiryWarnings({ now: NOW }, state.client as never)
    const again = await notices.sendExpiryWarnings({ now: NOW }, state.client as never)
    expect(again).toEqual({ due: 3, sent: 0, duplicate: 3, failed: 0 })
    // Five days later U1 is inside the last day → d1, once.
    const later = new Date(NOW.getTime() + 5 * 24 * H + 2 * H)
    await notices.sendExpiryWarnings({ now: later }, state.client as never)
    expect(state.sent.filter((x) => x.userId === U1).map((x) => x.stage)).toEqual(['d7', 'd1'])
    // Extended by a month: the new end date is warned again in its time.
    db.tables.subscriptions[0].currentPeriodEnd = at(36 * 24 * H)
    await notices.sendExpiryWarnings({ now: new Date(NOW.getTime() + 30 * 24 * H) }, state.client as never)
    expect(state.sent.filter((x) => x.userId === U1).map((x) => x.stage)).toEqual(['d7', 'd1', 'd7'])
  })
})

describe('the day it ends: the expiry job downgrades and tells the client once', () => {
  it('expireDuePlans → «закончился» to the person of the downgraded subscription; a second run is silent', async () => {
    // The SQL model of migration 106 checks «expired» against the real clock.
    const ago = (h: number) => new Date(Date.now() - h * H).toISOString().replace('Z', '')
    db.tables.subscriptions = [
      { orgId: 'company-1', tier: 'pro', status: 'active', currentPeriodEnd: ago(2), source: 'admin', updatedAt: ago(1) },
      { orgId: U3, tier: 'pilot', status: 'trialing', trialEndsAt: ago(1), currentPeriodEnd: null, source: 'trial', updatedAt: ago(1) },
    ]
    const r = await billing.expireDuePlans({ now: new Date() }, state.client as never)
    expect(r).toMatchObject({ due: 2, downgraded: 2, failed: 0 })
    expect(state.sent.map((x) => [x.userId, x.stage, x.trial]).sort()).toEqual([[U1, 'ended', false], [U3, 'ended', true]])
    const again = await billing.expireDuePlans({ now: new Date() }, state.client as never)
    expect(again.due).toBe(0)
    expect(state.sent).toHaveLength(2)
  })

  it('review WB-4: a second live paid subscription keeps the access → the downgrade of the first says nothing', async () => {
    const ago = (h: number) => new Date(Date.now() - h * H).toISOString().replace('Z', '')
    db.tables.subscriptions = [
      // company key: ended an hour ago → downgraded …
      { orgId: 'company-1', tier: 'pro', status: 'active', currentPeriodEnd: ago(1), source: 'admin', updatedAt: ago(2) },
      // … but the user key of the same client is open-ended Pro (data before migration 106)
      { orgId: U1, tier: 'pro', status: 'active', currentPeriodEnd: null, source: 'admin', updatedAt: ago(2) },
    ]
    // billing_set_plan keeps profiles.tier 'pro' when another live paid row remains (kept_access).
    const keptAccess: typeof sqlModel = (name, args, d) => {
      const res = sqlModel(name, args, d)
      if (name === 'billing_set_plan' && args.p_tier === 'free') {
        const other = (d.tables.subscriptions ?? []).some((x) => x.orgId !== args.p_org_id && x.status === 'active')
        const p = (d.tables.profiles ?? []).find((x) => x.id === args.p_user_id)
        if (other && p) {
          p.tier = 'pro'
          return { data: { ...(res.data as object), profile_tier: 'pro', kept_access: true } }
        }
      }
      return res
    }
    state.client = fakeClient(db, keptAccess)
    const r = await billing.expireDuePlans({ now: new Date() }, state.client as never)
    expect(r).toMatchObject({ due: 1, downgraded: 1 })
    expect(state.sent).toEqual([])
  })
})

describe('review WB-4: no warning while another live paid subscription carries the access further', () => {
  it('a company row ending in 3 days next to an open-ended or a later user row → nothing; alone → d7', async () => {
    db.tables.subscriptions = [
      { orgId: 'company-1', tier: 'pro', status: 'active', currentPeriodEnd: at(3 * 24 * H), source: 'admin', updatedAt: at(-H) },
      { orgId: U1, tier: 'pro', status: 'active', currentPeriodEnd: null, source: 'admin', updatedAt: at(-H) },
    ]
    expect(await notices.findPlansEnding(state.client as never, NOW, new Date(NOW.getTime() + 7 * 24 * H))).toEqual([])
    db.tables.subscriptions[1].currentPeriodEnd = at(40 * 24 * H)
    expect(await notices.findPlansEnding(state.client as never, NOW, new Date(NOW.getTime() + 7 * 24 * H))).toEqual([])
    // The later row ends inside the window → it is the one warned about (its own end date).
    db.tables.subscriptions[1].currentPeriodEnd = at(5 * 24 * H)
    const one = await notices.findPlansEnding(state.client as never, NOW, new Date(NOW.getTime() + 7 * 24 * H))
    expect(one).toEqual([expect.objectContaining({ userId: U1, orgId: U1, endsAt: new Date(NOW.getTime() + 5 * 24 * H).toISOString() })])
    db.tables.subscriptions = [db.tables.subscriptions[0]]
    expect((await notices.findPlansEnding(state.client as never, NOW, new Date(NOW.getTime() + 7 * 24 * H))).map((p) => p.orgId)).toEqual(['company-1'])
  })
})

describe('GET /api/cron/billing-expiry also sends the warnings', () => {
  it('downgrades first, then warns; the answer reports both', async () => {
    const saved = process.env.CRON_SECRET
    process.env.CRON_SECRET = 'cron-secret-for-tests'
    try {
      const realNow = new Date()
      const soon = new Date(realNow.getTime() + 3 * 24 * H).toISOString().replace('Z', '')
      db.tables.subscriptions = [
        { orgId: U1, tier: 'pro', status: 'active', currentPeriodEnd: new Date(realNow.getTime() - H).toISOString().replace('Z', ''), source: 'admin', updatedAt: soon },
        { orgId: U2, tier: 'pro', status: 'active', currentPeriodEnd: soon, source: 'admin', updatedAt: soon },
      ]
      const res = await GET(new NextRequest('http://localhost/api/cron/billing-expiry', { headers: { authorization: 'Bearer cron-secret-for-tests' } }))
      const body = await res.json()
      expect(body).toMatchObject({ ok: true, due: 1, downgraded: 1, warnings: { due: 1, sent: 1, duplicate: 0, failed: 0 } })
      expect(state.sent.map((x) => [x.userId, x.stage])).toEqual([[U1, 'ended'], [U2, 'd7']])
    } finally {
      if (saved === undefined) delete process.env.CRON_SECRET
      else process.env.CRON_SECRET = saved
    }
  })
})
